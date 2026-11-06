import { MODEL_RESPONSE_TIMEOUT_MS } from "../common/model-timeout.mjs";
import { platformSpec } from "../common/platforms.mjs";
import { ensureDefaultSkill } from "../skills/skills.mjs";
import { pointUnits, points } from "../common/data-points.mjs";
import { createHmac } from "node:crypto";
import { z } from "zod";
import { normalizeRequest } from "./requests.mjs";
import { researchKinds, SPECIALIST_KINDS } from "./scope.mjs";
import { specialistResultPresentation } from "../common/research-language.mjs";
import {
  assertWorkspaceAccess,
  selectedModel,
} from "../accounts/account-policy.mjs";
import {
  id,
  uuid,
  token,
  hash,
  JobInput,
  KINDS,
  micro,
  digest,
  requireThat,
  AppError,
  equalToken,
  cny,
  publicPrice,
} from "../common/core.mjs";
export const terminal = new Set([
  "succeeded",
  "partial",
  "failed",
  "cancelled",
]);
export async function jobEvent(c, workspace, job, kind, summary, data = {}) {
  await c.query(
    "INSERT INTO job_events(workspace_id,job_id,kind,summary,data) VALUES($1,$2,$3,$4,$5)",
    [workspace, job, kind, summary, data],
  );
}
export async function freezeTask(c, workspace, job) {
  const skill = (
    await c.query(
      "SELECT r.id,r.skill_id,r.version,r.digest,r.artifact_id FROM skill_bindings b JOIN skill_releases r ON r.id=b.release_id WHERE b.skill_id=$1",
      [
        job.kind === "scouting"
          ? platformSpec(job.request).skill
          : KINDS[job.kind],
      ],
    )
  ).rows[0];
  const connections = (
    await c.query(
      "SELECT c.id,c.kind,v.id AS version_id,v.config,v.validation,p.id AS price_id,p.data AS price FROM workspace_connections w JOIN connections c ON c.id=w.connection_id JOIN connection_versions v ON v.id=c.active_version_id LEFT JOIN price_cards p ON p.connection_id=c.id AND p.active WHERE w.workspace_id=$1 AND w.enabled AND c.enabled AND v.verified ORDER BY c.created_at DESC",
      [workspace],
    )
  ).rows;
  const model = connections.find(
    (c) =>
      c.kind === "model" &&
      c.price &&
      (!job.requested_model_id || c.id === job.requested_model_id),
  );
  requireThat(!job.requested_model_id || model, "model_unavailable", 409);
  const provider = platformSpec(job.request).provider;
  const data = connections.find((c) => c.kind === provider);
  const needsData =
    !["economics", "supply"].includes(job.kind) &&
    !(job.kind === "assistant" && job.request.data_mode === "context_only");
  const missing = [
    !skill && "skill",
    !model && "model",
    needsData && !data && job.kind !== "assistant" && provider,
    job.kind === "supply" && "1688_documentation",
  ].filter(Boolean);
  if (missing.length) return { missing };
  const snapshot = {
    schema_version: 1,
    skill,
    model,
    data:
      needsData && data
        ? {
            ...data,
            ...(provider === "sellersprite"
              ? { tools: data.validation?.tools || [] }
              : {}),
          }
        : null,
    created_at: new Date().toISOString(),
    form: job.request,
  };
  return { snapshot, digest: digest(snapshot) };
}
export async function reserveJob(c, workspace, job) {
  requireThat(
    BigInt(job.model_budget) > 0n,
    "insufficient_model_micro_cny",
    409,
  );
  for (const [currency, budget] of [
    ["model_micro_cny", job.model_budget],
    ["data_points", job.data_budget],
  ]) {
    const amount = BigInt(budget);
    if (amount === 0n) continue;
    const r = await c.query(
      "UPDATE wallets SET available=available-$2,reserved=reserved+$2 WHERE workspace_id=$1 AND currency=$3 AND available>=$2",
      [workspace, amount.toString(), currency],
    );
    requireThat(r.rowCount, `insufficient_${currency}`, 409);
    await c.query(
      "INSERT INTO ledger(id,workspace_id,currency,operation,amount,reference) VALUES($1,$2,$3,'reserve',$4,$5)",
      [id(), workspace, currency, amount.toString(), job.id],
    );
  }
}
export async function releaseDispatch(c, jobId) {
  await c.query("DELETE FROM dispatch WHERE job_id=$1", [jobId]);
  await c.query("UPDATE worker_nodes SET active_job=NULL WHERE active_job=$1", [
    jobId,
  ]);
}
export async function finalizeJob(
  c,
  workspace,
  job,
  status,
  result = null,
  error = null,
) {
  requireThat(terminal.has(status), "invalid_terminal_status");
  if (terminal.has(job.status)) return job;
  requireThat(
    BigInt(job.model_inflight) === 0n && BigInt(job.data_inflight) === 0n,
    "unresolved_invocations",
    409,
  );
  if (job.snapshot && job.billing_mode !== "wallet_per_call")
    for (const [currency, budget, spent] of [
      ["model_micro_cny", job.model_budget, job.model_spent],
      ["data_points", job.data_budget, job.data_spent],
    ]) {
      const b = BigInt(budget),
        s = BigInt(spent);
      if (b === 0n) continue;
      requireThat(
        (
          await c.query(
            "UPDATE wallets SET reserved=reserved-$2,available=available+$3 WHERE workspace_id=$1 AND currency=$4 AND reserved>=$2",
            [workspace, b.toString(), (b - s).toString(), currency],
          )
        ).rowCount,
        "wallet_reservation_mismatch",
        500,
      );
      for (const [op, n] of [
        ["charge", s],
        ["release", b - s],
      ])
        await c.query(
          "INSERT INTO ledger(id,workspace_id,currency,operation,amount,reference) VALUES($1,$2,$3,$4,$5,$6)",
          [id(), workspace, currency, op, n.toString(), job.id],
        );
    }
  const r = (
    await c.query(
      "UPDATE jobs SET status=$2,result=$3,error_code=$4,lease_expires_at=NULL,updated_at=now() WHERE id=$1 RETURNING *",
      [job.id, status, result, error],
    )
  ).rows[0];
  await releaseDispatch(c, job.id);
  if (job.kind === "monitoring")
    await c.query(
      "UPDATE shop_monitors SET last_completed_at=now(),last_error=$2,updated_at=now() WHERE last_job_id=$1",
      [job.id, error || (status === "partial" ? "monitor_partial" : null)],
    );
  await jobEvent(c, workspace, job.id, status, `任务状态：${status}`, {
    error_code: error,
  });
  return r;
}
export function signJob(key, payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return (
    data + "." + createHmac("sha256", key).update(data).digest("base64url")
  );
}
export function verifyJob(key, bearer) {
  requireThat(
    typeof bearer === "string" && bearer.length < 2000,
    "job_token_invalid",
    401,
  );
  const [data, sig] = bearer.split(".");
  requireThat(
    data &&
      sig &&
      equalToken(
        sig,
        createHmac("sha256", key).update(data).digest("base64url"),
      ),
    "job_token_invalid",
    401,
  );
  let payload;
  try {
    payload = JSON.parse(Buffer.from(data, "base64url"));
  } catch {
    throw new AppError("job_token_invalid", 401);
  }
  uuid.parse(payload.job_id);
  uuid.parse(payload.workspace_id);
  requireThat(
    (payload.lease_bound === true && payload.exp === undefined) ||
      (Number.isSafeInteger(payload.exp) && payload.exp > Date.now()),
    "job_token_expired",
    401,
  );
  return payload;
}
export async function lockedLease(
  c,
  scope,
  { allowCancel = false, lock = true } = {},
) {
  const job = (
    await c.query(
      "SELECT *,lease_expires_at>clock_timestamp() AS lease_valid FROM jobs WHERE id=$1" +
        (lock ? " FOR UPDATE" : ""),
      [scope.job_id],
    )
  ).rows[0];
  requireThat(
    job &&
      job.status === "running" &&
      String(job.fence) === String(scope.fence) &&
      job.worker_id === scope.worker_id &&
      job.lease_valid,
    "lease_lost",
    409,
  );
  requireThat(allowCancel || !job.cancel_requested, "job_cancelled", 409);
  return job;
}
export function installJobs(app, db, key, skillOptions) {
  app.decorate("workerAuth", async (req) =>
    requireThat(
      equalToken(
        req.headers.authorization?.replace(/^Bearer /, ""),
        key.toString("base64url"),
      ),
      "worker_unauthorized",
      401,
    ),
  );
  app.decorate("jobAuth", async (req) => {
    req.jobScope = verifyJob(
      key,
      req.headers.authorization?.replace(/^Bearer /, ""),
    );
  });
  app.get("/api/jobs", { preHandler: app.user }, async (req) =>
    db.tenant(req.workspace, async (c) => ({
      items: (
        await c.query(
          "SELECT id,kind,title,request->>'platform' AS platform,status,stage,model_budget,data_budget,model_spent,data_spent,error_code,cancel_requested,created_at,updated_at FROM jobs WHERE ($1::text[] IS NULL OR kind=ANY($1)) AND ($2::text IS NULL OR COALESCE(request->>'platform','tiktok')=$2) ORDER BY created_at DESC LIMIT 100",
          [
            researchKinds(req.query.research_scope),
            z.enum(["tiktok", "amazon"]).optional().parse(req.query.platform) ||
              null,
          ],
        )
      ).rows,
    })),
  );
  app.get("/api/jobs/:id", { preHandler: app.user }, async (req) =>
    db.tenant(req.workspace, async (c) => {
      const j = (
        await c.query("SELECT * FROM jobs WHERE id=$1", [
          uuid.parse(req.params.id),
        ])
      ).rows[0];
      requireThat(j, "job_not_found", 404);
      if (SPECIALIST_KINDS.includes(j.kind) && j.result)
        j.result = specialistResultPresentation(j.result);
      delete j.worker_id;
      if (j.snapshot)
        j.snapshot = {
          skill: j.snapshot.skill,
          created_at: j.snapshot.created_at,
          model: {
            name: j.snapshot.model.config.model,
            response_timeout_seconds: MODEL_RESPONSE_TIMEOUT_MS / 1000,
            price: publicPrice(j.snapshot.model.price),
          },
        };
      const events = (
        await c.query(
          "SELECT id,kind,summary,data,created_at FROM job_events WHERE job_id=$1 ORDER BY id LIMIT 300",
          [j.id],
        )
      ).rows;
      return { ...j, events };
    }),
  );
  app.post("/api/jobs", { preHandler: app.user }, async (req) => {
    const v = JobInput.parse(req.body);
    requireThat(v.kind !== "assistant", "assistant_conversation_required");
    requireThat(v.kind !== "monitoring", "monitor_context_required");
    v.request = normalizeRequest(v.kind, v.request);
    return db.tenant(req.workspace, async (c) => {
      await assertWorkspaceAccess(c, req.workspace, req.identity.id);
      if (v.request.platform === "amazon" && skillOptions)
        await ensureDefaultSkill(
          c,
          skillOptions.store,
          skillOptions.projectRoot,
          req.workspace,
          "amazon-product-scouting",
        );
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        req.workspace + v.idempotency_key,
      ]);
      const old = (
        await c.query("SELECT * FROM jobs WHERE idempotency_key=$1", [
          v.idempotency_key,
        ])
      ).rows[0];
      if (old) {
        if (old.submission_hash) {
          requireThat(
            old.submission_hash === digest(v),
            "job_idempotency_conflict",
            409,
          );
          return { id: old.id, status: old.status };
        }
        requireThat(
          digest({
            kind: old.kind,
            title: old.title,
            request: old.request,
            model_budget: old.model_budget,
            data_budget: old.data_budget,
          }) ===
            digest({
              kind: v.kind,
              title: v.title,
              request: v.request,
              model_budget:
                v.model_budget === undefined
                  ? old.model_budget
                  : micro(v.model_budget).toString(),
              data_budget:
                v.data_budget === undefined
                  ? old.data_budget
                  : pointUnits(v.data_budget).toString(),
            }),
          "job_idempotency_conflict",
          409,
        );
        return { id: old.id, status: old.status };
      }
      const job = {
        id: id(),
        kind: v.kind,
        request: v.request,
        billing_mode: "wallet_per_call",
        model_budget: "0",
        data_budget: "0",
        requested_model_id: await selectedModel(
          c,
          req.workspace,
          req.identity.id,
          v.model_connection_id,
        ),
      };
      const frozen = await freezeTask(c, req.workspace, job);
      const status = frozen.missing ? "awaiting_connection" : "queued";
      await c.query(
        "INSERT INTO jobs(id,workspace_id,created_by,kind,title,request,snapshot,digest,status,idempotency_key,model_budget,data_budget,requested_model_id,submission_hash,auto_budget,billing_mode) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",
        [
          job.id,
          req.workspace,
          req.identity.id,
          v.kind,
          v.title,
          v.request,
          frozen.snapshot || null,
          frozen.digest || null,
          status,
          v.idempotency_key,
          job.model_budget,
          job.data_budget,
          job.requested_model_id,
          digest(v),
          true,
          job.billing_mode,
        ],
      );
      if (status === "queued") {
        await c.query(
          "INSERT INTO dispatch(job_id,workspace_id) VALUES($1,$2)",
          [job.id, req.workspace],
        );
      }
      await jobEvent(
        c,
        req.workspace,
        job.id,
        status,
        status === "queued"
          ? "任务已排队，技能和价格版本已固定"
          : "任务已保存，等待平台完成连接配置",
        { missing: frozen.missing || [] },
      );
      return { id: job.id, status, missing: frozen.missing || [] };
    });
  });
  app.post("/api/jobs/:id/resume", { preHandler: app.user }, async (req) =>
    db.tenant(req.workspace, async (c) => {
      await assertWorkspaceAccess(c, req.workspace, req.identity.id);
      const job = (
        await c.query(
          "SELECT *,lease_expires_at>clock_timestamp() AS lease_valid FROM jobs WHERE id=$1 FOR UPDATE",
          [uuid.parse(req.params.id)],
        )
      ).rows[0];
      requireThat(job, "job_not_found", 404);
      requireThat(
        ["awaiting_connection", "waiting_input"].includes(job.status),
        "job_not_resumable",
        409,
      );
      const v = z
        .object({ input: z.record(z.string(), z.unknown()).optional() })
        .strict()
        .parse(req.body || {});
      if (job.status === "waiting_input") {
        requireThat(v.input, "input_required");
        await c.query(
          "UPDATE jobs SET checkpoint=checkpoint||$2,status='queued',updated_at=now() WHERE id=$1",
          [job.id, { human_input: v.input }],
        );
      } else {
        const f = await freezeTask(c, req.workspace, job);
        requireThat(!f.missing, "connection_not_ready", 409);
        if (job.billing_mode !== "wallet_per_call")
          await reserveJob(c, req.workspace, job);
        await c.query(
          "UPDATE jobs SET snapshot=$2,digest=$3,status='queued',updated_at=now() WHERE id=$1",
          [job.id, f.snapshot, f.digest],
        );
      }
      await c.query(
        "INSERT INTO dispatch(job_id,workspace_id) VALUES($1,$2) ON CONFLICT(job_id) DO UPDATE SET available_at=now()",
        [job.id, req.workspace],
      );
      await jobEvent(c, req.workspace, job.id, "queued", "任务已恢复");
      return { ok: true };
    }),
  );
  app.post("/api/jobs/:id/cancel", { preHandler: app.user }, async (req) =>
    db.tenant(req.workspace, async (c) => {
      const job = (
        await c.query(
          "SELECT *,lease_expires_at>clock_timestamp() AS lease_valid FROM jobs WHERE id=$1 FOR UPDATE",
          [uuid.parse(req.params.id)],
        )
      ).rows[0];
      requireThat(job, "job_not_found", 404);
      if (terminal.has(job.status)) return { status: job.status };
      if (job.status === "running" || job.status === "reconciling") {
        await c.query(
          "UPDATE jobs SET cancel_requested=true,updated_at=now() WHERE id=$1",
          [job.id],
        );
        await jobEvent(
          c,
          req.workspace,
          job.id,
          "cancel_requested",
          "已请求停止；已发出的调用会先结算",
        );
        return { status: job.status, cancel_requested: true };
      }
      const cancelled = await finalizeJob(c, req.workspace, job, "cancelled");
      return { id: cancelled.id, status: cancelled.status };
    }),
  );
  app.get("/api/wallet/summary", { preHandler: app.user }, async (req) =>
    db.tenant(req.workspace, async (c) => ({
      wallets: (
        await c.query(
          "SELECT currency,available,reserved FROM wallets WHERE workspace_id=$1",
          [req.workspace],
        )
      ).rows,
    })),
  );
  app.get("/api/wallet", { preHandler: app.user }, async (req) =>
    db.tenant(req.workspace, async (c) => ({
      wallets: (await c.query("SELECT * FROM wallets")).rows,
      ledger: (
        await c.query("SELECT * FROM ledger ORDER BY created_at DESC LIMIT 100")
      ).rows,
    })),
  );
  app.post(
    "/internal/worker/claim",
    { preHandler: app.workerAuth },
    async (req) => {
      const { worker_id } = z
        .object({ worker_id: z.string().regex(/^[a-zA-Z0-9_-]{3,60}$/) })
        .strict()
        .parse(req.body);
      await app.monitorTick?.();
      return db.tx(null, async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(93419731)");
        await c.query(
          "INSERT INTO worker_nodes(id,version) VALUES($1,'0.1.0') ON CONFLICT(id) DO UPDATE SET last_seen=now()",
          [worker_id],
        );
        const candidates = (
          await c.query(
            "SELECT d.job_id,d.workspace_id FROM dispatch d LEFT JOIN worker_nodes w ON w.active_job=d.job_id WHERE d.available_at<=now() ORDER BY (w.active_job IS NOT NULL) DESC,d.created_at LIMIT 100",
          )
        ).rows;
        let active = 0;
        for (const candidate of candidates) {
          await c.query("SELECT set_config('app.workspace_id',$1,true)", [
            candidate.workspace_id,
          ]);
          const j = (
            await c.query(
              "SELECT *,lease_expires_at>clock_timestamp() AS lease_valid FROM jobs WHERE id=$1 FOR UPDATE",
              [candidate.job_id],
            )
          ).rows[0];
          if (!j) continue;
          if (!["running", "queued"].includes(j.status)) {
            await releaseDispatch(c, j.id);
            continue;
          }
          if (j.status === "running") {
            if (j.lease_valid) {
              active++;
              continue;
            }
            if (BigInt(j.model_inflight) > 0n || BigInt(j.data_inflight) > 0n) {
              // A crashed API cannot run its catch handler. Make the orphaned reservation reconcilable.
              await c.query(
                "UPDATE invocations SET state='reconciling' WHERE job_id=$1 AND state='started'",
                [j.id],
              );
              await c.query(
                "UPDATE jobs SET status='reconciling',error_code='worker_lease_expired',updated_at=now() WHERE id=$1",
                [j.id],
              );
              await releaseDispatch(c, j.id);
              await jobEvent(
                c,
                candidate.workspace_id,
                j.id,
                "reconciling",
                "执行租约过期，待核对在途费用",
              );
            } else
              await finalizeJob(
                c,
                candidate.workspace_id,
                j,
                "failed",
                null,
                "worker_lease_expired",
              );
          }
        }
        // Count all worker slots, not only the first page of queued jobs.
        active = Number(
          (
            await c.query(
              "SELECT count(*) AS n FROM worker_nodes WHERE active_job IS NOT NULL AND last_seen>now()-interval '90 seconds'",
            )
          ).rows[0].n,
        );
        const selfBusy = (
          await c.query("SELECT active_job FROM worker_nodes WHERE id=$1", [
            worker_id,
          ])
        ).rows[0]?.active_job;
        if (selfBusy || active >= Number(process.env.MAX_RUNNING_JOBS || 1))
          return { job: null };
        for (const candidate of candidates) {
          await c.query("SELECT set_config('app.workspace_id',$1,true)", [
            candidate.workspace_id,
          ]);
          const j = (
            await c.query(
              "UPDATE jobs SET status='running',worker_id=$2,fence=fence+1,attempt=attempt+1,lease_expires_at=now()+interval '90 seconds',updated_at=now() WHERE id=$1 AND status='queued' RETURNING *",
              [candidate.job_id, worker_id],
            )
          ).rows[0];
          if (!j) continue;
          await jobEvent(
            c,
            candidate.workspace_id,
            j.id,
            "running",
            "Agent 已接收任务",
          );
          const scope = {
            workspace_id: candidate.workspace_id,
            job_id: j.id,
            worker_id,
            fence: j.fence,
            // Every job endpoint checks the renewable lease and fence. Binding
            // this credential to that lease avoids an implicit two-hour cap.
            lease_bound: true,
          };
          await c.query("UPDATE worker_nodes SET active_job=$2 WHERE id=$1", [
            worker_id,
            j.id,
          ]);
          return {
            job: {
              id: j.id,
              kind: j.kind,
              request: j.request,
              checkpoint: j.checkpoint,
              snapshot: j.snapshot,
              limits: {
                billing_mode: j.billing_mode,
                model_budget_cny:
                  j.billing_mode === "wallet_per_call"
                    ? null
                    : cny(j.model_budget),
                data_budget:
                  j.billing_mode === "wallet_per_call"
                    ? null
                    : Number(points(j.data_budget)),
              },
            },
            job_token: signJob(key, scope),
          };
        }
        return { job: null };
      });
    },
  );
  app.post(
    "/internal/job/heartbeat",
    { preHandler: app.jobAuth },
    async (req) =>
      db.tenant(req.jobScope.workspace_id, async (c) => {
        const j = await lockedLease(c, req.jobScope, { allowCancel: true });
        await c.query(
          "UPDATE jobs SET lease_expires_at=now()+interval '90 seconds' WHERE id=$1",
          [j.id],
        );
        await c.query("UPDATE worker_nodes SET last_seen=now() WHERE id=$1", [
          req.jobScope.worker_id,
        ]);
        return { cancel_requested: j.cancel_requested };
      }),
  );
  app.post("/internal/job/event", { preHandler: app.jobAuth }, async (req) =>
    db.tenant(req.jobScope.workspace_id, async (c) => {
      await lockedLease(c, req.jobScope);
      const v = z
        .object({
          stage: z.string().min(1).max(80),
          summary: z.string().min(1).max(500),
          checkpoint: z.record(z.string(), z.unknown()).optional(),
        })
        .strict()
        .parse(req.body);
      await c.query(
        "UPDATE jobs SET stage=$2,checkpoint=checkpoint||$3,updated_at=now() WHERE id=$1",
        [req.jobScope.job_id, v.stage, v.checkpoint || {}],
      );
      await jobEvent(
        c,
        req.jobScope.workspace_id,
        req.jobScope.job_id,
        "progress",
        v.summary,
      );
      return { ok: true };
    }),
  );
  app.post("/internal/job/bundle", { preHandler: app.jobAuth }, async (req) =>
    db.tenant(req.jobScope.workspace_id, async (c) => {
      const j = await lockedLease(c, req.jobScope);
      return (
        await c.query("SELECT a.* FROM artifacts a WHERE a.id=$1", [
          j.snapshot.skill.artifact_id,
        ])
      ).rows[0];
    }),
  );
}
