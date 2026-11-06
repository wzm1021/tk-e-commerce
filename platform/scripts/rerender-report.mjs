import { loadAmazonDailySupplements } from "../src/reports/amazon-supplements.mjs";
import { amazonPresentation } from "../src/reports/amazon-presentation.mjs";
import { assessAmazonScouting } from "../src/reports/amazon-scouting.mjs";
import { loadPolicySources } from "../src/data/policy-web.mjs";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDatabase } from "../src/infra/db.mjs";
import { LocalStore } from "../src/infra/storage.mjs";
import { saveArtifact } from "../src/files/artifacts.mjs";
import { pointer } from "../src/reports/reports.mjs";
import { scoutingPresentation } from "../src/reports/scouting-presentation.mjs";
import { SCOUTING_REPORT_VERSION } from "../src/reports/scouting-report.mjs";
import { applyScoutingPolicy } from "../src/reports/scouting-policy.mjs";
import { digest, requireThat, uuid } from "../src/common/core.mjs";

export async function rerenderScoutingReport(db, store, workspaceId, reportId) {
  return db.tenant(workspaceId, async (c) => {
    const report = (
      await c.query(
        "SELECT * FROM records WHERE id=$1 AND kind='report' FOR UPDATE",
        [reportId],
      )
    ).rows[0];
    requireThat(report, "report_not_found", 404);
    requireThat(
      ["fastmoss_agent_research", "sellersprite_agent_research"].includes(
        report.data.source_kind,
      ),
      "report_not_rerenderable",
      409,
    );
    const job = (
      await c.query("SELECT * FROM jobs WHERE id=$1 AND kind='scouting'", [
        report.data.job_id,
      ])
    ).rows[0];
    requireThat(job?.result, "report_job_result_missing", 409);
    let result = job.result;
    requireThat(
      Array.isArray(result.candidates) &&
        Array.isArray(result.sections) &&
        Array.isArray(result.limitations),
      "report_job_result_invalid",
      409,
    );
    const invocations = (
      await c.query(
        "SELECT i.id,a.object_key,a.sha256 FROM invocations i JOIN artifacts a ON a.id=i.artifact_id WHERE i.job_id=$1 AND i.kind='data' AND i.state='succeeded'",
        [job.id],
      )
    ).rows;
    const sources = new Map();
    for (const invocation of invocations)
      sources.set(
        invocation.id,
        JSON.parse(
          (
            await store.read(invocation.object_key, invocation.sha256)
          ).toString(),
        ),
      );
    await loadPolicySources(c, store, job.id, sources);
    await loadAmazonDailySupplements(c, store, report, sources);
    for (const candidate of result.candidates)
      for (const evidence of candidate.evidence || [])
        requireThat(
          sources.has(evidence.invocation_id) &&
            pointer(sources.get(evidence.invocation_id), evidence.pointer) !==
              undefined &&
            digest(
              pointer(sources.get(evidence.invocation_id), evidence.pointer),
            ) === digest(evidence.value),
          "evidence_value_mismatch",
          409,
        );
    result =
      job.request.platform === "amazon"
        ? assessAmazonScouting(result, job.request, sources)
        : applyScoutingPolicy(
            result,
            job.request,
            sources,
            job.snapshot.created_at,
          );
    // Preserve collection gaps alongside refreshed deterministic field checks.
    result.limitations = [
      ...new Set([...job.result.limitations, ...result.limitations]),
    ];
    const renderedAt = new Date().toISOString();
    const reportMeta = {
      title: job.title,
      kind: job.kind,
      created_at: renderedAt,
      skill_version: job.snapshot.skill.version,
      request: job.request,
      as_of: job.snapshot.created_at,
      sources,
      notice: report.data.daily_supplement_job_ids?.length
        ? "商品结论保留原研究快照；每日销量单独补查，日期及费用见补查任务。未重新运行模型分析。"
        : "已按原研究快照更新报告展示，未新增数据或模型费用。",
    };
    const presentation =
      job.request.platform === "amazon"
        ? await amazonPresentation(result, reportMeta)
        : await scoutingPresentation(result, reportMeta);
    const html = await saveArtifact(
      c,
      store,
      workspaceId,
      Buffer.from(presentation.html),
      {
        name: `${job.title} · 报告修订.html`,
        mime: "text/html; charset=utf-8",
        kind: "report",
      },
    );
    const candidates = await saveArtifact(
      c,
      store,
      workspaceId,
      Buffer.from(JSON.stringify(presentation.candidates ?? result.candidates)),
      { name: `${job.id}-revised-candidates.json`, kind: "candidates" },
    );
    const previous = [
      ...(Array.isArray(report.data.previous_artifact_ids)
        ? report.data.previous_artifact_ids
        : []),
      report.data.artifact_id,
    ];
    const data = {
      ...report.data,
      artifact_id: html.id,
      candidates_artifact_id: candidates.id,
      previous_candidates_artifact_ids: [
        ...new Set(
          [
            ...(report.data.previous_candidates_artifact_ids || []),
            report.data.candidates_artifact_id,
          ].filter(Boolean),
        ),
      ],
      summary: result.summary,
      limitations: result.limitations,
      ...presentation.metadata,
      revised_at: renderedAt,
      previous_artifact_ids: [...new Set(previous)],
    };
    await c.query(
      "UPDATE records SET data=$2,version=version+1,updated_at=now() WHERE id=$1",
      [report.id, data],
    );
    await c.query(
      "INSERT INTO tenant_audit(workspace_id,actor_id,action,target_id,summary) VALUES($1,$2,'report.rerender',$3,$4)",
      [
        workspaceId,
        report.created_by,
        report.id,
        {
          previous_artifact_id: report.data.artifact_id,
          artifact_id: html.id,
          previous_candidates_artifact_id: report.data.candidates_artifact_id,
          candidates_artifact_id: candidates.id,
          billing_changed: false,
          template_version:
            presentation.metadata.template_version || SCOUTING_REPORT_VERSION,
          image_archive: data.image_archive,
        },
      ],
    );
    return {
      report_id: report.id,
      artifact_id: html.id,
      previous_artifact_id: report.data.artifact_id,
      template_version:
        presentation.metadata.template_version || SCOUTING_REPORT_VERSION,
      image_archive: data.image_archive,
    };
  });
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  requireThat(process.env.DATABASE_URL, "DATABASE_URL_required", 500);
  requireThat(process.env.DATA_ROOT, "DATA_ROOT_required", 500);
  const workspaceId = uuid.parse(process.env.WORKSPACE_ID);
  const reportId = uuid.parse(process.env.REPORT_ID);
  const db = createDatabase(process.env.DATABASE_URL);
  try {
    const result = await rerenderScoutingReport(
      db,
      new LocalStore(process.env.DATA_ROOT),
      workspaceId,
      reportId,
    );
    process.stdout.write(JSON.stringify(result) + "\n");
  } finally {
    await db.close();
  }
}
