import { readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createDatabase } from "../src/infra/db.mjs";
import { LocalStore } from "../src/infra/storage.mjs";
import { id, uuid, requireThat } from "../src/common/core.mjs";
import { assertWorkspaceAccess } from "../src/accounts/account-policy.mjs";
import {
  freezeTask,
  finalizeJob,
  jobEvent,
  signJob,
} from "../src/research/jobs.mjs";
import { amazonDailySales } from "../src/reports/amazon-daily.mjs";
import { rerenderScoutingReport } from "./rerender-report.mjs";

export async function supplementAmazonDaily(
  db,
  store,
  { workspace, reportId, asin, operationKey, workerKey, callData },
) {
  uuid.parse(workspace);
  uuid.parse(reportId);
  requireThat(
    /^[A-Z0-9]{10}$/.test(asin) &&
      typeof operationKey === "string" &&
      operationKey.length > 0 &&
      operationKey.length <= 100,
    "daily_supplement_input_invalid",
  );
  const job = await db.tenant(workspace, async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      workspace + operationKey,
    ]);
    const report = (
      await c.query("SELECT * FROM records WHERE id=$1 AND kind='report'", [
        reportId,
      ])
    ).rows[0];
    requireThat(report?.data.platform === "amazon", "amazon_report_required");
    await assertWorkspaceAccess(c, workspace, report.created_by);
    const original = (
      await c.query("SELECT * FROM jobs WHERE id=$1", [report.data.job_id])
    ).rows[0];
    requireThat(
      original?.result?.candidates?.some((c) => c.product_id === asin),
      "daily_candidate_not_in_report",
    );
    const previous = (
      await c.query("SELECT * FROM jobs WHERE idempotency_key=$1", [
        operationKey,
      ])
    ).rows[0];
    if (previous) {
      requireThat(
        previous.checkpoint?.source_report_id === reportId &&
          previous.checkpoint?.asin === asin,
        "daily_idempotency_conflict",
      );
      requireThat(
        ["succeeded", "partial"].includes(previous.status),
        "daily_previous_run_needs_review",
        409,
      );
      return previous;
    }
    const request = {
      ...original.request,
      candidate_count: 1,
      notes: `补充每日销量对比：${asin}。仅调用一次 asin_prediction；原报告 ${reportId}。不调用模型。`,
    };
    const frozen = await freezeTask(c, workspace, {
      kind: "scouting",
      request,
    });
    requireThat(
      !frozen.missing &&
        frozen.snapshot.data.tools.some((t) => t.name === "asin_prediction"),
      "daily_connection_validation_required",
      409,
    );
    const jid = id(),
      scope = {
        workspace_id: workspace,
        job_id: jid,
        worker_id: "amazon-daily-supplement",
        fence: 1,
      };
    const created = (
      await c.query(
        `INSERT INTO jobs(id,workspace_id,created_by,kind,title,request,snapshot,digest,status,idempotency_key,billing_mode,auto_budget,worker_id,fence,lease_expires_at,checkpoint) VALUES($1,$2,$3,'scouting',$4,$5,$6,$7,'running',$8,'wallet_per_call',true,$9,1,now()+interval '10 minutes',$10) RETURNING *`,
        [
          jid,
          workspace,
          report.created_by,
          `每日销量补查 · ${asin}`,
          request,
          frozen.snapshot,
          frozen.digest,
          operationKey,
          scope.worker_id,
          { supplement_kind: "amazon_daily", source_report_id: reportId, asin },
        ],
      )
    ).rows[0];
    await jobEvent(
      c,
      workspace,
      jid,
      "running",
      "补查一次每日销量，通过正式网关计费归档；不调用模型",
      { source_report_id: reportId, asin },
    );
    return created;
  });
  if (job.status === "running") {
    try {
      const scope = {
        workspace_id: workspace,
        job_id: job.id,
        worker_id: job.worker_id,
        fence: job.fence,
        lease_bound: true,
      };
      const data = await callData(signJob(workerKey, scope), {
        name: "asin_prediction",
        arguments: {
          marketplace: job.request.market === "GB" ? "UK" : job.request.market,
          asin,
        },
      });
      const daily = amazonDailySales(
        { product_id: asin, market: job.request.market },
        new Map([[data.invocation_id, data]]),
        job.request.lookback_days,
      );
      await db.tenant(workspace, async (c) => {
        const locked = (
          await c.query("SELECT * FROM jobs WHERE id=$1 FOR UPDATE", [job.id])
        ).rows[0];
        requireThat(
          locked.status === "running" && locked.worker_id === job.worker_id,
          "daily_lease_changed",
        );
        const complete = Boolean(daily?.coverage);
        await finalizeJob(
          c,
          workspace,
          locked,
          complete ? "succeeded" : "partial",
          {
            supplement_kind: "amazon_daily",
            source_report_id: reportId,
            asin,
            invocation_id: data.invocation_id,
            coverage: daily?.coverage || 0,
            summary: complete
              ? "每日销量估算已归档"
              : "接口未返回可用每日销量，保留缺口",
          },
        );
      });
    } catch (error) {
      await db.tenant(workspace, async (c) => {
        const locked = (
          await c.query("SELECT * FROM jobs WHERE id=$1 FOR UPDATE", [job.id])
        ).rows[0];
        if (locked.status !== "running") return;
        if (BigInt(locked.data_inflight) > 0n) {
          await c.query(
            "UPDATE jobs SET status='reconciling',lease_expires_at=NULL,error_code='daily_supplement_uncertain',updated_at=now() WHERE id=$1",
            [job.id],
          );
          await jobEvent(
            c,
            workspace,
            job.id,
            "reconciling",
            "每日补查结果待核对，不自动重复采购",
          );
        } else
          await finalizeJob(
            c,
            workspace,
            locked,
            "failed",
            null,
            error.code || "daily_supplement_failed",
          );
      });
      throw error;
    }
  }
  await db.tenant(workspace, async (c) => {
    const report = (
      await c.query(
        "SELECT * FROM records WHERE id=$1 AND kind='report' FOR UPDATE",
        [reportId],
      )
    ).rows[0];
    const ids = [
      ...new Set([...(report.data.daily_supplement_job_ids || []), job.id]),
    ];
    requireThat(ids.length <= 100, "daily_supplement_limit");
    await c.query(
      "UPDATE records SET data=data||$2::jsonb,version=version+1,updated_at=now() WHERE id=$1",
      [reportId, { daily_supplement_job_ids: ids }],
    );
    await c.query(
      "INSERT INTO tenant_audit(workspace_id,actor_id,action,target_id,summary) VALUES($1,$2,'report.daily_supplement',$3,$4)",
      [workspace, report.created_by, reportId, { job_id: job.id, asin }],
    );
  });
  const presentation = await rerenderScoutingReport(
    db,
    store,
    workspace,
    reportId,
  );
  const outcome = await db.tenant(
    workspace,
    async (c) =>
      (
        await c.query(
          "SELECT id,status,model_spent,data_spent,result FROM jobs WHERE id=$1",
          [job.id],
        )
      ).rows[0],
  );
  return { ...presentation, supplement: outcome };
}
if (
  process.argv[1] &&
  (await realpath(process.argv[1])) === fileURLToPath(import.meta.url)
) {
  const db = createDatabase(process.env.DATABASE_URL);
  try {
    const result = await supplementAmazonDaily(
      db,
      new LocalStore(process.env.DATA_ROOT),
      {
        workspace: process.env.WORKSPACE_ID,
        reportId: process.env.REPORT_ID,
        asin: process.env.ASIN,
        operationKey: process.env.OPERATION_KEY,
        workerKey: await readFile(process.env.WORKER_TOKEN_FILE),
        callData: async (token, body) => {
          const r = await fetch("http://127.0.0.1:9080/internal/job/data", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(240000),
          });
          const data = await r.json();
          requireThat(r.ok, data.error || "daily_gateway_error", r.status);
          return data;
        },
      },
    );
    console.log(JSON.stringify(result));
  } finally {
    await db.close();
  }
}
