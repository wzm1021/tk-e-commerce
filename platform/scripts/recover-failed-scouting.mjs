import { amazonPresentation } from "../src/reports/amazon-presentation.mjs";
import {
  assessAmazonScouting,
  recoverAmazonDraft,
} from "../src/reports/amazon-scouting.mjs";
import { platformSpec, platformOf } from "../src/common/platforms.mjs";
import { loadPolicySources } from "../src/data/policy-web.mjs";
import { saveArtifact } from "../src/files/artifacts.mjs";
import { recoverScoutingDraft } from "../src/reports/scouting-recovery.mjs";
import { applyScoutingPolicy } from "../src/reports/scouting-policy.mjs";
import { scoutingPresentation } from "../src/reports/scouting-presentation.mjs";
import { scoutingReportSections } from "../src/reports/scouting-report.mjs";
import { jobEvent } from "../src/research/jobs.mjs";
import { id, requireThat } from "../src/common/core.mjs";
import { finishJobResult } from "../src/reports/reports.mjs";

// Administrative repair from already charged, immutable evidence only. Never
// re-reserve funds, settle invocations or repeat a provider operation.
export async function recoverFailedScouting(
  db,
  store,
  workspace,
  jobId,
  { reason } = {},
) {
  return db.tenant(workspace, async (c) => {
    const job = (
      await c.query("SELECT * FROM jobs WHERE id=$1 FOR UPDATE", [jobId])
    ).rows[0];
    requireThat(job?.kind === "scouting", "scouting_job_required", 409);
    if (job.result?.recovery && job.result.report_id)
      return { report_id: job.result.report_id, already_recovered: true };
    requireThat(
      job.status === "failed" &&
        [
          "agent_execution_failed",
          "worker_execution_failed",
          "agent_deadline_exceeded",
          "model_output_limit_reached",
          "late_usage_settled",
        ].includes(job.error_code),
      "job_not_recoverable",
      409,
    );
    requireThat(
      !job.cancel_requested &&
        BigInt(job.model_inflight) === 0n &&
        BigInt(job.data_inflight) === 0n,
      "job_not_settled",
      409,
    );
    requireThat(
      !(
        await c.query(
          "SELECT 1 FROM invocations WHERE job_id=$1 AND state IN ('started','reconciling') LIMIT 1",
          [job.id],
        )
      ).rowCount,
      "job_not_settled",
      409,
    );
    if (job.checkpoint?.unverified_result) {
      requireThat(
        !reason ||
          [
            "agent_deadline_exceeded",
            "agent_execution_failed",
            "worker_lease_expired",
          ].includes(reason),
        "invalid_recovery_reason",
      );
      requireThat(
        !(
          await c.query(
            "SELECT 1 FROM records WHERE kind='report' AND data->>'job_id'=$1",
            [job.id],
          )
        ).rowCount,
        "report_already_exists",
        409,
      );
      // Preserve the model's saved work; do not replace it with raw search rows.
      // A temporary in-memory state lets the normal finalizer repair this
      // terminal job atomically, without requeueing or reserving any funds.
      const recovered = await finishJobResult(
        c,
        store,
        { ...job, status: "reconciling" },
        {
          result: job.checkpoint.unverified_result,
          error_code:
            reason || job.checkpoint.pending_error_code || job.error_code,
        },
      );
      requireThat(recovered.result?.report_id, "no_recoverable_report", 409);
      const recovery = {
        original_status: job.status,
        original_error_code: job.error_code,
        reason: recovered.error_code,
        from_saved_analysis: true,
        billing_changed: false,
      };
      await c.query(
        "UPDATE jobs SET result=result||$2,checkpoint=(checkpoint-'pending_result_warning')||$3 WHERE id=$1",
        [
          job.id,
          { recovery },
          { recovery, pending_finish: false, pending_result_delivered: true },
        ],
      );
      await c.query("UPDATE records SET data=data||$2 WHERE id=$1", [
        recovered.result.report_id,
        { recovery },
      ]);
      await jobEvent(
        c,
        workspace,
        job.id,
        "recovered",
        "已校验并恢复模型保存的阶段分析与候选报告；原费用不变",
        {
          report_id: recovered.result.report_id,
          candidate_count: recovered.result.candidates.length,
          ...recovery,
        },
      );
      await c.query(
        "INSERT INTO tenant_audit(workspace_id,actor_id,action,target_id,summary) VALUES($1,$2,'job.recover_report',$3,$4)",
        [
          workspace,
          job.created_by,
          job.id,
          { report_id: recovered.result.report_id, ...recovery },
        ],
      );
      return {
        report_id: recovered.result.report_id,
        candidate_count: recovered.result.candidates.length,
        billing_changed: false,
        from_saved_analysis: true,
      };
    }
    const sources = new Map();
    for (const r of (
      await c.query(
        "SELECT i.id,a.object_key,a.sha256 FROM invocations i JOIN artifacts a ON a.id=i.artifact_id WHERE i.job_id=$1 AND i.kind='data' AND i.state='succeeded'",
        [job.id],
      )
    ).rows)
      sources.set(
        r.id,
        JSON.parse((await store.read(r.object_key, r.sha256)).toString()),
      );
    await loadPolicySources(c, store, job.id, sources);
    const draft =
      job.request.platform === "amazon"
        ? recoverAmazonDraft(job.request, sources)
        : recoverScoutingDraft(job.request, sources, job.error_code);
    requireThat(draft, "no_recoverable_candidates", 409);
    const result =
      job.request.platform === "amazon"
        ? assessAmazonScouting(draft, job.request, sources)
        : applyScoutingPolicy(
            draft,
            job.request,
            sources,
            job.snapshot.created_at,
          );
    result.limitations = [...draft.limitations, ...result.limitations];
    const meta = {
      title: job.title,
      kind: job.kind,
      created_at: new Date().toISOString(),
      skill_version: job.snapshot.skill.version,
      request: job.request,
      as_of: job.snapshot.created_at,
      sources,
      notice:
        "研究执行中断；本报告从该任务已成功归档的数据恢复，没有新增数据或模型费用。未完成的分析保留待核验。",
    };
    if (job.request.platform === "amazon")
      result.recovery = {
        original_error_code: job.error_code,
        billing_changed: false,
      };
    const p =
      job.request.platform === "amazon"
        ? await amazonPresentation(result, meta)
        : await scoutingPresentation(result, meta);
    const html = await saveArtifact(c, store, workspace, Buffer.from(p.html), {
      name: job.title + " · 恢复报告.html",
      mime: "text/html; charset=utf-8",
      kind: "report",
    });
    const candidates = await saveArtifact(
      c,
      store,
      workspace,
      Buffer.from(JSON.stringify(p.candidates ?? result.candidates)),
      { name: job.id + "-recovered-candidates.json", kind: "candidates" },
    );
    const reportId = id();
    const data = {
      title: job.title,
      job_id: job.id,
      platform: platformOf(job.request),
      market: job.request.market,
      research_kind: job.kind,
      source_kind: `${platformSpec(job.request).provider}_agent_research`,
      captured_at: meta.created_at,
      artifact_id: html.id,
      candidates_artifact_id: candidates.id,
      candidate_count: result.candidates.length,
      sections: (job.request.platform === "amazon"
        ? result.sections
        : scoutingReportSections(result)
      ).map((s) => s.title),
      summary: result.summary,
      limitations: result.limitations,
      recovery: result.recovery,
      ...p.metadata,
    };
    await c.query(
      "INSERT INTO records(id,workspace_id,kind,data,created_by) VALUES($1,$2,'report',$3,$4)",
      [reportId, workspace, data, job.created_by],
    );
    await c.query(
      "UPDATE jobs SET status='partial',result=$2,error_code=NULL,checkpoint=checkpoint||$3,updated_at=now() WHERE id=$1",
      [
        job.id,
        { ...result, report_id: reportId },
        {
          recovery: {
            original_status: job.status,
            original_error_code: job.error_code,
          },
        },
      ],
    );
    await jobEvent(
      c,
      workspace,
      job.id,
      "recovered",
      "已从本任务归档证据恢复阶段报告；原费用不变",
      {
        report_id: reportId,
        candidate_count: result.candidates.length,
        original_error_code: job.error_code,
      },
    );
    await c.query(
      "INSERT INTO tenant_audit(workspace_id,actor_id,action,target_id,summary) VALUES($1,$2,'job.recover_report',$3,$4)",
      [
        workspace,
        job.created_by,
        job.id,
        { report_id: reportId, billing_changed: false },
      ],
    );
    return {
      report_id: reportId,
      candidate_count: result.candidates.length,
      quality: p.metadata.report_quality,
      billing_changed: false,
    };
  });
}
