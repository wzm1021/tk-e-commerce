import { amazonPresentation } from "./amazon-presentation.mjs";
import {
  assessAmazonScouting,
  recoverAmazonDraft,
  renderAmazonReport,
} from "./amazon-scouting.mjs";
import { platformSpec, platformOf } from "../common/platforms.mjs";
import { reportMonitorCandidates } from "../monitoring/candidate-shop.mjs";
import { renderSpecialistReport } from "./specialist-report.mjs";
import { loadPolicySources } from "../data/policy-web.mjs";
import { canonicalEvidencePointer } from "../data/evidence.mjs";
import { persistInspection } from "../monitoring/monitoring.mjs";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { id, uuid, requireThat, hash, digest } from "../common/core.mjs";
import { saveArtifact } from "../files/artifacts.mjs";
import {
  applyScoutingPolicy,
  ensureScoutingCandidates,
} from "./scouting-policy.mjs";
import {
  renderScoutingReport,
  scoutingReportSections,
} from "./scouting-report.mjs";
import { scoutingPresentation } from "./scouting-presentation.mjs";
import { recoverScoutingDraft } from "./scouting-recovery.mjs";
import { assessPolicyChecks } from "./policy-assessment.mjs";
import {
  AssistantStoredResult,
  validateAssistantCitations,
} from "../assistant/assistant-contract.mjs";
import {
  contextDigest,
  reusableHistoryMemory,
} from "../assistant/assistant-context.mjs";
import {
  lockedLease,
  finalizeJob,
  jobEvent,
  releaseDispatch,
} from "../research/jobs.mjs";
const esc = (x) =>
  String(x ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const str = z.string().max(12000);
const label = z.string().min(1).max(300);
const Evidence = z
  .object({
    invocation_id: uuid,
    pointer: z.string().max(2000),
    value: z.unknown(),
    metric: label,
    unit: z.string().max(60),
    period_start: z.string().nullable(),
    period_end: z.string().nullable(),
    timezone: z.string().nullable(),
  })
  .strict();
const Analysis = z
  .object({
    summary: str,
    evidence_ids: z.array(uuid).max(30),
    limitations: z.array(str).max(10),
  })
  .strict();
const TestPlan = z
  .object({
    summary: str,
    rationale: str,
    evidence_ids: z.array(uuid).min(1).max(30),
    assumptions: z.array(str).max(10),
  })
  .strict();
const Candidate = z
  .object({
    product_id: label,
    research: z
      .object({
        growth: Analysis,
        competition: Analysis,
        reputation: Analysis.optional(),
        test_plan: TestPlan,
        links: z
          .array(
            z
              .object({
                label: label,
                url: z.string().url(),
                invocation_id: uuid,
                pointer: z.string().max(2000),
              })
              .strict(),
          )
          .max(5),
      })
      .strict()
      .optional(),
    title: label,
    tk_url: z.string().url().nullable(),
    product_url: z.string().url().nullable().optional(),
    image: z.string().max(300000).nullable(),
    strategy_a: z.enum(["passed", "failed", "unverified"]).optional(),
    strategy_b: z.enum(["passed", "failed", "unverified"]).optional(),
    decision: z.enum(["shortlist", "watch", "reject"]),
    reason: str,
    evidence: z.array(Evidence).max(100),
    limitations: z.array(str).max(30),
  })
  .strict();
export const ResultSchema = z
  .object({
    status: z.enum(["complete", "partial", "waiting_input"]),
    summary: str,
    sections: z
      .array(
        z
          .object({
            title: label,
            body: str,
            kind: z.enum(["observed", "inferred", "pending"]),
            evidence_ids: z.array(uuid).max(100),
          })
          .strict(),
      )
      .max(30),
    candidates: z.array(Candidate).max(200),
    policy_checks: z
      .array(
        z
          .object({
            scope: label,
            summary: str,
            action: str,
            status: z.enum(["reviewed", "pending"]),
            evidence_ids: z.array(uuid).max(10),
          })
          .strict(),
      )
      .max(20)
      .optional(),
    questions: z.array(str).max(20),
    limitations: z.array(str).max(50),
    next_actions: z.array(z.object({ title: label, reason: str })).max(30),
  })
  .strict();
export const RESULT_JSON_SCHEMA = z.toJSONSchema(ResultSchema);
export function pointer(object, path) {
  if (path === "") return object;
  requireThat(path.startsWith("/"), "invalid_evidence_pointer");
  return path
    .slice(1)
    .split("/")
    .reduce((v, k) => {
      const key = k.replaceAll("~1", "/").replaceAll("~0", "~");
      return v !== null && typeof v === "object" && Object.hasOwn(v, key)
        ? v[key]
        : undefined;
    }, object);
}
export function renderReport(result, meta) {
  if (meta.request?.platform === "amazon")
    return renderAmazonReport(result, meta);
  return meta.kind === "scouting"
    ? renderScoutingReport(result, meta)
    : renderSpecialistReport(result, meta);
}
export async function importHistorical(
  db,
  store,
  projectRoot,
  workspace,
  actor,
) {
  return db.tenant(workspace, async (c) => {
    const original = await readFile(
      `${projectRoot}/output/report/tiktok-us-home-storage-bathroom-60-report.html`,
    );
    const sha = hash(original);
    requireThat(
      sha ===
        "85247d7465ba9a0602ae5ec5f4a12286c81c99cb0d276d690dc18e5d06fc29dc",
      "historical_report_changed",
      409,
    );
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      workspace + sha,
    ]);
    const old = (
      await c.query(
        "SELECT * FROM records WHERE kind='report' AND data->>'source_sha256'=$1",
        [sha],
      )
    ).rows[0];
    if (old) return old;
    const manifest = JSON.parse(
      await readFile(
        `${projectRoot}/product/prototype/public/reports/manifest.json`,
        "utf8",
      ),
    );
    const raw = JSON.parse(
      await readFile(
        `${projectRoot}/product/prototype/public/reports/candidates.json`,
        "utf8",
      ),
    );
    requireThat(raw.length === 60, "historical_candidate_mismatch");
    const candidates = raw.map(({ owner, stage, color, image, ...x }) => ({
      ...x,
      image,
      product_id: x.tkProductId,
      title: x.name,
      tk_url: x.tkUrl,
      decision: "watch",
      strategy_a: "unverified",
      strategy_b: "unverified",
      source_kind: "historical_report",
      limitations: [
        "历史报告导入，未按当前条件重新验真",
        "原报告销量与当前订单条件不可等同",
        "原利润口径含 8% 平台费，当前测算另用约定 6%",
      ],
      ...(x.rank === 1
        ? { discrepancies: ["目录 7 日销量 666，深度卡 707；保留差异"] }
        : {}),
      ...([4, 5].includes(x.rank)
        ? { discrepancies: ["目录与深度卡评分 4.4 / 4.3 存在差异"] }
        : {}),
    }));
    const html = await saveArtifact(c, store, workspace, original, {
      name: "原始选品报告-60品.html",
      mime: "text/html; charset=utf-8",
      kind: "report",
    });
    const json = await saveArtifact(
      c,
      store,
      workspace,
      Buffer.from(JSON.stringify(candidates)),
      { name: "历史候选-60品.json", kind: "candidates" },
    );
    const data = {
      title: "美区家居收纳 / 浴室用品 · 60 品历史报告",
      source_kind: "user_provided_historical_report",
      source_sha256: sha,
      captured_at: manifest.captured_at,
      sections: manifest.sections,
      candidate_count: 60,
      artifact_id: html.id,
      candidates_artifact_id: json.id,
      notice:
        "历史资料；未发生新的数据或模型调用。原报告方法、费用与当前任务条件分别保留。",
    };
    const row = (
      await c.query(
        "INSERT INTO records(id,workspace_id,kind,data,created_by) VALUES($1,$2,'report',$3,$4) RETURNING *",
        [id(), workspace, data, actor],
      )
    ).rows[0];
    await c.query(
      "INSERT INTO tenant_audit(workspace_id,actor_id,action,target_id) VALUES($1,$2,'report.import',$3)",
      [workspace, actor, row.id],
    );
    return row;
  });
}
function finishPayload(job, payload) {
  return z
    .object({
      result: (job.kind === "assistant"
        ? AssistantStoredResult
        : ResultSchema
      ).optional(),
      error_code: z.string().max(100).optional(),
    })
    .strict()
    .parse(payload);
}

// Shared by normal submission and late settlement. Revalidate archived evidence
// before publishing; an interrupted draft can never become a complete report.
export async function finishJobResult(c, store, j, payload) {
  const v = finishPayload(j, payload);
  if (v.error_code && v.result) v.result.status = "partial";
  if (j.cancel_requested) return finalizeJob(c, j.workspace_id, j, "cancelled");
  if (!v.result && !["scouting", "monitoring"].includes(j.kind))
    return finalizeJob(
      c,
      j.workspace_id,
      j,
      "failed",
      null,
      v.error_code || "worker_failed",
    );
  let result = v.result;
  if (j.kind === "assistant") {
    if (result.compaction?.history_memory)
      requireThat(
        reusableHistoryMemory(
          result.compaction.history_memory,
          j.request.history,
        ),
        "assistant_memory_mismatch",
        409,
      );
    if (result.compaction?.context_memory)
      requireThat(
        result.compaction.context_memory.digest ===
          contextDigest(j.request.contexts),
        "assistant_memory_mismatch",
        409,
      );
    const sources = new Map();
    const ids = result.citations
      .filter((x) => x.source_type === "data")
      .map((x) => x.source_id);
    if (ids.length) {
      const allowedJobs = [j.id, ...j.request.history.map((x) => x.job_id)];
      const rows = (
        await c.query(
          "SELECT i.id,i.artifact_id,a.object_key,a.sha256 FROM invocations i JOIN jobs parent ON parent.id=i.job_id JOIN artifacts a ON a.id=i.artifact_id WHERE i.id=ANY($1::uuid[]) AND i.job_id=ANY($2::uuid[]) AND parent.kind='assistant' AND parent.request->>'conversation_id'=$3 AND i.kind='data' AND i.state='succeeded'",
          [ids, allowedJobs, j.request.conversation_id],
        )
      ).rows;
      for (const row of rows)
        sources.set(row.id, {
          artifact_id: row.artifact_id,
          envelope: JSON.parse(
            (await store.read(row.object_key, row.sha256)).toString(),
          ),
        });
    }
    const citations = validateAssistantCitations(
      result,
      j.request.contexts,
      sources,
    );
    return finalizeJob(
      c,
      j.workspace_id,
      j,
      result.status === "complete" ? "succeeded" : "partial",
      { ...result, citations },
    );
  }
  const invocations = (
    await c.query(
      "SELECT i.id,a.object_key,a.sha256 FROM invocations i JOIN artifacts a ON a.id=i.artifact_id WHERE i.job_id=$1 AND i.kind='data' AND i.state='succeeded'",
      [j.id],
    )
  ).rows;
  const sources = new Map();
  for (const inv of invocations)
    sources.set(
      inv.id,
      JSON.parse((await store.read(inv.object_key, inv.sha256)).toString()),
    );
  await loadPolicySources(c, store, j.id, sources);
  if (j.kind === "monitoring") {
    result = await persistInspection(c, j, sources, result);
    if (v.error_code) result.status = "partial";
  }
  const interrupted =
    j.kind === "scouting" &&
    (!result || (v.error_code && !result.candidates.length));
  if (interrupted) {
    result =
      j.request.platform === "amazon"
        ? recoverAmazonDraft(j.request, sources)
        : recoverScoutingDraft(j.request, sources, v.error_code);
    if (!result)
      return finalizeJob(
        c,
        j.workspace_id,
        j,
        "failed",
        null,
        v.error_code || "worker_failed",
      );
    await jobEvent(
      c,
      j.workspace_id,
      j.id,
      "recovered",
      "研究中断，已从归档数据恢复候选资料，将生成阶段报告",
      result.recovery,
    );
  }
  const recovery = result.recovery;
  if (j.kind === "scouting" && j.request.platform !== "amazon")
    result = ensureScoutingCandidates(result, j.request, sources);
  for (const section of result.sections)
    for (const key of section.evidence_ids)
      requireThat(sources.has(key), "unrecognized_evidence", 409);
  for (const candidate of result.candidates) {
    for (const ev of candidate.evidence) {
      ev.pointer = canonicalEvidencePointer(
        sources.get(ev.invocation_id),
        ev.pointer,
        ev.value,
      );
      requireThat(sources.has(ev.invocation_id), "unrecognized_evidence", 409);
      requireThat(
        pointer(sources.get(ev.invocation_id), ev.pointer) !== undefined &&
          digest(pointer(sources.get(ev.invocation_id), ev.pointer)) ===
            digest(ev.value),
        "evidence_value_mismatch",
        409,
      );
    }
  }
  if (j.kind === "scouting") {
    for (const candidate of result.candidates) {
      if (!candidate.research) continue;
      for (const section of [
        candidate.research.growth,
        candidate.research.competition,
        ...(candidate.research.reputation
          ? [candidate.research.reputation]
          : []),
        candidate.research.test_plan,
      ])
        for (const key of section.evidence_ids)
          requireThat(
            sources.has(key) &&
              sources.get(key).source === platformSpec(j.request).source,
            "unrecognized_evidence",
            409,
          );
      for (const link of candidate.research.links) {
        link.pointer = canonicalEvidencePointer(
          sources.get(link.invocation_id),
          link.pointer,
          link.url,
        );
        requireThat(
          sources.has(link.invocation_id) &&
            pointer(sources.get(link.invocation_id), link.pointer) === link.url,
          "evidence_value_mismatch",
          409,
        );
      }
    }
    const policy = assessPolicyChecks(result.policy_checks || [], sources);
    result.policy_checks = policy.policy_checks;
    result.limitations.push(...policy.limitations);
    const gaps = result.candidates.filter(
      (x) =>
        !x.research ||
        !x.research.growth.evidence_ids.length ||
        !x.research.competition.evidence_ids.length ||
        !x.research.reputation?.evidence_ids.length,
    );
    if (gaps.length || !result.policy_checks?.length) {
      result.status = "partial";
      result.limitations.push(
        `逐品分析尚缺 ${gaps.length} 件；政策检查${result.policy_checks?.length ? "已记录" : "尚缺网页证据"}。`,
      );
    }
  }
  if (j.kind === "scouting" && j.request.platform === "amazon")
    result = assessAmazonScouting(result, j.request, sources);
  if (j.kind === "scouting" && j.request.platform !== "amazon")
    result = applyScoutingPolicy(
      result,
      j.request,
      sources,
      j.snapshot.created_at,
    );
  if (recovery) {
    result.recovery = recovery;
    result.limitations.push(
      "研究执行中断，已恢复成功归档的候选资料；未完成部分仍需继续核验。",
    );
  }
  if (
    j.kind === "scouting" &&
    result.candidates.length < Number(j.request.candidate_count || 5)
  ) {
    result.status = "partial";
    result.limitations.push(
      `实际得到 ${result.candidates.length} 个候选，目标 ${j.request.candidate_count || 5} 个；未凑数。`,
    );
  }
  if (result.status === "waiting_input") {
    await c.query(
      "UPDATE jobs SET status='waiting_input',result=$2,checkpoint=checkpoint||$3,lease_expires_at=NULL,updated_at=now() WHERE id=$1",
      [j.id, result, { questions: result.questions }],
    );
    await releaseDispatch(c, j.id);
    await jobEvent(
      c,
      j.workspace_id,
      j.id,
      "waiting_input",
      "需要补充资料后继续",
    );
    return { status: "waiting_input" };
  }
  const reportMeta = {
    title: j.title,
    kind: j.kind,
    created_at: new Date().toISOString(),
    skill_version: j.snapshot.skill.version,
    request: j.request,
    as_of: j.snapshot.created_at,
    sources,
  };
  const scouting =
    j.kind === "scouting"
      ? j.request.platform === "amazon"
        ? await amazonPresentation(result, reportMeta)
        : await scoutingPresentation(result, reportMeta)
      : null;
  const html = await saveArtifact(
    c,
    store,
    j.workspace_id,
    Buffer.from(scouting?.html ?? renderReport(result, reportMeta)),
    {
      name: `${j.title}.html`,
      mime: "text/html; charset=utf-8",
      kind: "report",
    },
  );
  const candidates = await saveArtifact(
    c,
    store,
    j.workspace_id,
    Buffer.from(JSON.stringify(scouting?.candidates ?? result.candidates)),
    { name: `${j.id}-candidates.json`, kind: "candidates" },
  );
  const rid = id();
  const data = {
    title: j.title,
    job_id: j.id,
    research_kind: j.kind,
    platform: platformOf(j.request),
    market: j.request.market,
    source_kind: `${platformSpec(j.request).provider}_agent_research`,
    captured_at: new Date().toISOString(),
    artifact_id: html.id,
    candidates_artifact_id: candidates.id,
    candidate_count: result.candidates.length,
    sections:
      j.kind === "scouting" && j.request.platform !== "amazon"
        ? scoutingReportSections(result).map((s) => s.title)
        : result.sections.map((s) => s.title),
    ...(scouting?.metadata || {}),
    ...(recovery ? { recovery } : {}),
    summary: result.summary,
    limitations: result.limitations,
  };
  await c.query(
    "INSERT INTO records(id,workspace_id,kind,data,created_by) VALUES($1,$2,'report',$3,$4)",
    [rid, j.workspace_id, data, j.created_by],
  );
  return finalizeJob(
    c,
    j.workspace_id,
    j,
    result.status === "complete" ? "succeeded" : "partial",
    { ...result, report_id: rid },
    v.error_code || null,
  );
}

// Billing must remain settled even when a saved draft fails evidence validation.
// The caller holds the job lock; a savepoint isolates delivery from accounting.
export async function finishSettledJob(c, store, job) {
  if (
    job.status !== "reconciling" ||
    BigInt(job.model_inflight) ||
    BigInt(job.data_inflight)
  )
    return job;
  const pending = job.checkpoint || {};
  const errorCode = pending.pending_error_code || job.error_code || null;
  if (!pending.pending_finish && !pending.unverified_result)
    return finalizeJob(
      c,
      job.workspace_id,
      job,
      job.cancel_requested ? "cancelled" : "failed",
      job.result,
      errorCode || "late_usage_settled",
    );
  await c.query("SAVEPOINT pending_report_delivery");
  try {
    const result = await finishJobResult(c, store, job, {
      ...(pending.unverified_result
        ? { result: pending.unverified_result }
        : {}),
      ...(errorCode ? { error_code: errorCode } : {}),
    });
    await c.query(
      "UPDATE jobs SET checkpoint=(checkpoint-'pending_result_warning')||$2 WHERE id=$1",
      [job.id, { pending_finish: false, pending_result_delivered: true }],
    );
    await c.query("RELEASE SAVEPOINT pending_report_delivery");
    return result;
  } catch (error) {
    await c.query("ROLLBACK TO SAVEPOINT pending_report_delivery");
    await c.query("RELEASE SAVEPOINT pending_report_delivery");
    const code =
      error.name === "ZodError"
        ? "research_output_invalid"
        : error.code || "report_delivery_failed";
    await c.query("UPDATE jobs SET checkpoint=checkpoint||$2 WHERE id=$1", [
      job.id,
      { pending_delivery_error: code },
    ]);
    await jobEvent(
      c,
      job.workspace_id,
      job.id,
      "delivery_failed",
      "费用已结算，草稿未通过报告校验，已保留供修复",
      { error_code: code },
    );
    return finalizeJob(
      c,
      job.workspace_id,
      job,
      job.cancel_requested ? "cancelled" : "failed",
      job.result,
      errorCode || code,
    );
  }
}

export function installReports(app, db, store, projectRoot) {
  app.post("/api/reports/import-reference", { preHandler: app.user }, (req) =>
    importHistorical(db, store, projectRoot, req.workspace, req.identity.id),
  );
  app.get(
    "/api/reports/:id/candidates",
    { preHandler: app.user },
    async (req) =>
      db.tenant(req.workspace, async (c) => ({
        items: await reportMonitorCandidates(
          c,
          store,
          uuid.parse(req.params.id),
        ),
      })),
  );

  app.post("/api/reports/:id/promote", { preHandler: app.user }, async (req) =>
    db.tenant(req.workspace, async (c) => {
      const v = z
        .object({
          product_ids: z.array(z.string().min(1).max(200)).min(1).max(200),
        })
        .strict()
        .parse(req.body);
      const r = (
        await c.query("SELECT * FROM records WHERE id=$1 AND kind='report'", [
          uuid.parse(req.params.id),
        ])
      ).rows[0];
      requireThat(r, "report_not_found", 404);
      const a = (
        await c.query("SELECT * FROM artifacts WHERE id=$1", [
          r.data.candidates_artifact_id,
        ])
      ).rows[0];
      const candidates = JSON.parse(
        (await store.read(a.object_key, a.sha256)).toString(),
      );
      let created = 0;
      const items = [];
      for (const productId of new Set(v.product_ids)) {
        const item = candidates.find((x) => x.product_id === productId);
        requireThat(item, "candidate_not_found", 404);
        requireThat(
          item.product_url || item.tk_url,
          "candidate_url_missing",
          409,
        );
        const existing = (
          await c.query(
            "SELECT * FROM records WHERE kind='opportunity' AND data->>'product_id'=$1 AND COALESCE(data->>'platform','tiktok')=$2 AND ($2='tiktok' OR COALESCE(data->>'market','US')=$3)",
            [productId, r.data.platform || "tiktok", r.data.market || "US"],
          )
        ).rows[0];
        if (existing) {
          items.push(existing);
          continue;
        }
        const data = {
          product_id: productId,
          title: item.title,
          tk_url: item.tk_url,
          ...(r.data.platform === "amazon"
            ? {
                platform: "amazon",
                market: r.data.market,
                product_url: item.product_url,
              }
            : {}),
          stage: "watch",
          report_id: r.id,
          candidate_id: item.id || productId,
          notes: "",
          source: {
            kind:
              r.data.source_kind === "user_provided_historical_report"
                ? "historical_report"
                : r.data.platform === "amazon"
                  ? "sellersprite"
                  : "fastmoss",
            reference: r.id,
            captured_at: r.data.captured_at || r.created_at.toISOString(),
          },
        };
        const row = (
          await c.query(
            "INSERT INTO records(id,workspace_id,kind,data,created_by) VALUES($1,$2,'opportunity',$3,$4) ON CONFLICT DO NOTHING RETURNING *",
            [id(), req.workspace, data, req.identity.id],
          )
        ).rows[0];
        if (row) {
          created++;
          items.push(row);
        }
      }
      await c.query(
        "INSERT INTO tenant_audit(workspace_id,actor_id,action,target_id,summary) VALUES($1,$2,'report.promote',$3,$4)",
        [
          req.workspace,
          req.identity.id,
          r.id,
          { product_ids: v.product_ids, created },
        ],
      );
      return { created, items };
    }),
  );
  app.get("/internal/job/bundle", { preHandler: app.jobAuth }, async (req) =>
    db.tenant(req.jobScope.workspace_id, async (c) => {
      const j = await lockedLease(c, req.jobScope);
      const a = (
        await c.query("SELECT * FROM artifacts WHERE id=$1", [
          j.snapshot.skill.artifact_id,
        ])
      ).rows[0];
      const bundle = JSON.parse(
        (await store.read(a.object_key, a.sha256)).toString(),
      );
      requireThat(
        digest(bundle) === j.snapshot.skill.digest,
        "skill_integrity_failure",
        500,
      );
      return bundle;
    }),
  );
  app.post(
    "/internal/job/finish",
    { preHandler: app.jobAuth, bodyLimit: 4 * 1024 * 1024 },
    async (req) =>
      db.tenant(req.jobScope.workspace_id, async (c) => {
        const j = await lockedLease(c, req.jobScope, { allowCancel: true });
        const v = finishPayload(j, req.body);
        if (BigInt(j.model_inflight) > 0n || BigInt(j.data_inflight) > 0n) {
          await c.query(
            "UPDATE jobs SET status='reconciling',checkpoint=checkpoint||$2,error_code=$3,lease_expires_at=NULL,updated_at=now() WHERE id=$1",
            [
              j.id,
              {
                pending_finish: true,
                pending_error_code: v.error_code || j.error_code || null,
                ...(v.result ? { unverified_result: v.result } : {}),
                pending_result_warning:
                  "执行输出已保留，费用确认后将校验证据并生成报告。",
              },
              v.error_code || j.error_code || null,
            ],
          );
          await releaseDispatch(c, j.id);
          await jobEvent(
            c,
            j.workspace_id,
            j.id,
            "reconciling",
            "执行已结束，已保存草稿，等待最后的调用结算后生成报告",
            { error_code: v.error_code || j.error_code || null },
          );
          return { status: "reconciling" };
        }
        return finishJobResult(c, store, j, v);
      }),
  );
}
