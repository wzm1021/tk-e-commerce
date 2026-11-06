import { reportMonitorCandidates } from "./candidate-shop.mjs";
import { z } from "zod";
import {
  id,
  uuid,
  digest,
  micro,
  cny,
  requireThat,
  KINDS,
} from "../common/core.mjs";
import { pointUnits, points } from "../common/data-points.mjs";
import { freezeTask, reserveJob, jobEvent } from "../research/jobs.mjs";
import {
  assertWorkspaceAccess,
  selectedModel,
} from "../accounts/account-policy.mjs";
import { projectBundle, publishSkill } from "../skills/skills.mjs";
import {
  MonitorInput,
  MonitorConfig,
  checkMonthlyBudget,
} from "./contract.mjs";
import {
  normalizeSnapshot,
  inspectChanges,
  inspectionResult,
} from "./engine.mjs";

async function lockedMonitor(c, monitorId) {
  const row = (
    await c.query("SELECT * FROM shop_monitors WHERE id=$1 FOR UPDATE", [
      monitorId,
    ])
  ).rows[0];
  requireThat(row, "monitor_not_found", 404);
  return row;
}
async function usage(c, monitorId) {
  return (
    await c.query(
      `SELECT
    COALESCE(sum(CASE WHEN j.status IN ('succeeded','partial','failed','cancelled') THEN j.model_spent ELSE j.model_budget END),0)::text AS model,
    COALESCE(sum(CASE WHEN j.status IN ('succeeded','partial','failed','cancelled') THEN j.data_spent ELSE j.data_budget END),0)::text AS data
    FROM monitor_runs r JOIN jobs j ON j.id=r.job_id
    WHERE r.monitor_id=$1 AND r.created_at>=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
      [monitorId],
    )
  ).rows[0];
}
export async function enqueueInspection(
  c,
  monitor,
  trigger,
  key,
  actor = monitor.created_by,
) {
  await assertWorkspaceAccess(c, monitor.workspace_id, actor);
  const idem = `monitor:${monitor.id}:${key}`;
  const old = (
    await c.query(
      "SELECT j.id,j.status FROM monitor_requests r JOIN jobs j ON j.id=r.job_id WHERE r.monitor_id=$1 AND r.request_key=$2",
      [monitor.id, idem],
    )
  ).rows[0];
  if (old) return { job: old, reused: true };
  requireThat(monitor.status !== "archived", "monitor_archived", 409);
  requireThat(
    trigger !== "scheduled" || monitor.status === "active",
    "monitor_paused",
    409,
  );
  const running = (
    await c.query(
      "SELECT j.id,j.status FROM monitor_runs r JOIN jobs j ON j.id=r.job_id WHERE r.monitor_id=$1 AND j.status NOT IN ('succeeded','partial','failed','cancelled') LIMIT 1",
      [monitor.id],
    )
  ).rows[0];
  if (running) {
    await c.query(
      "INSERT INTO monitor_requests(workspace_id,monitor_id,request_key,job_id) VALUES($1,$2,$3,$4)",
      [monitor.workspace_id, monitor.id, idem, running.id],
    );
    return { job: running, reused: true };
  }
  const config = MonitorConfig.parse(monitor.config);
  checkMonthlyBudget(config, await usage(c, monitor.id));
  const job = {
    id: id(),
    workspace_id: monitor.workspace_id,
    created_by: actor,
    kind: "monitoring",
    title: `竞店巡检 · ${monitor.name}`,
    requested_model_id: await selectedModel(
      c,
      monitor.workspace_id,
      actor,
      config.model_connection_id,
    ),
    model_budget: micro(config.model_budget).toString(),
    data_budget: pointUnits(config.data_budget).toString(),
    request: {
      monitor_id: monitor.id,
      monitor_version: monitor.version,
      seller_id: monitor.seller_id,
      market: monitor.market,
      config,
      previous_state: monitor.state,
      as_of: new Date().toISOString(),
    },
  };
  const frozen = await freezeTask(c, monitor.workspace_id, job);
  requireThat(!frozen.missing, "monitor_connection_missing", 409);
  await c.query(
    `INSERT INTO jobs(id,workspace_id,created_by,kind,title,request,idempotency_key,model_budget,data_budget,snapshot,digest,status,requested_model_id,submission_hash,billing_mode)
    VALUES($1,$2,$3,'monitoring',$4,$5,$6,$7,$8,$9,$10,'queued',$11,$12,'job_reservation')`,
    [
      job.id,
      job.workspace_id,
      actor,
      job.title,
      job.request,
      idem,
      job.model_budget,
      job.data_budget,
      frozen.snapshot,
      frozen.digest,
      job.requested_model_id,
      digest(job.request),
    ],
  );
  await reserveJob(c, job.workspace_id, job);
  await c.query(
    "INSERT INTO monitor_runs(job_id,workspace_id,monitor_id,trigger) VALUES($1,$2,$3,$4)",
    [job.id, job.workspace_id, monitor.id, trigger],
  );
  await c.query(
    "INSERT INTO monitor_requests(workspace_id,monitor_id,request_key,job_id) VALUES($1,$2,$3,$4)",
    [job.workspace_id, monitor.id, idem, job.id],
  );
  await c.query("INSERT INTO dispatch(job_id,workspace_id) VALUES($1,$2)", [
    job.id,
    job.workspace_id,
  ]);
  await c.query(
    "UPDATE shop_monitors SET last_job_id=$2,last_error=NULL,updated_at=now() WHERE id=$1",
    [monitor.id, job.id],
  );
  await jobEvent(
    c,
    job.workspace_id,
    job.id,
    "queued",
    trigger === "manual" ? "手动竞店巡检已入队" : "定时竞店巡检已入队",
  );
  return { job: { id: job.id, status: "queued" }, reused: false };
}

// Called by worker claim; no process-local timers. Multiple API/worker replicas are safe.
export async function tickMonitors(db) {
  const due = (
    await db.query(
      "SELECT monitor_id,workspace_id FROM monitor_schedule WHERE due_at<=now() ORDER BY due_at LIMIT 10",
    )
  ).rows;
  for (const item of due) {
    await db.tenant(item.workspace_id, async (c) => {
      const monitor = (
        await c.query(
          "SELECT * FROM shop_monitors WHERE id=$1 FOR UPDATE SKIP LOCKED",
          [item.monitor_id],
        )
      ).rows[0];
      if (!monitor) return;
      const schedule = (
        await c.query(
          "SELECT * FROM monitor_schedule WHERE monitor_id=$1 AND workspace_id=$2 AND due_at<=now() FOR UPDATE",
          [monitor.id, item.workspace_id],
        )
      ).rows[0];
      if (!schedule) return;
      if (monitor.status !== "active") {
        await c.query("DELETE FROM monitor_schedule WHERE monitor_id=$1", [
          monitor.id,
        ]);
        return;
      }
      await c.query("SAVEPOINT monitor_enqueue");
      try {
        const result = await enqueueInspection(
          c,
          monitor,
          "scheduled",
          new Date(schedule.due_at).toISOString(),
        );
        await c.query("RELEASE SAVEPOINT monitor_enqueue");
        await c.query(
          "UPDATE monitor_schedule SET due_at=now()+($2 * interval '1 hour') WHERE monitor_id=$1",
          [monitor.id, result.reused ? 1 : monitor.config.interval_hours],
        );
      } catch (e) {
        await c.query("ROLLBACK TO SAVEPOINT monitor_enqueue");
        await c.query(
          "UPDATE shop_monitors SET last_error=$2,updated_at=now() WHERE id=$1",
          [
            monitor.id,
            String(e.code || "monitor_schedule_failed").slice(0, 100),
          ],
        );
        await c.query(
          "UPDATE monitor_schedule SET due_at=now()+interval '1 hour' WHERE monitor_id=$1",
          [monitor.id],
        );
      }
    });
  }
}

// The API derives facts from immutable invocation artifacts, never model assertions.
export async function persistInspection(c, job, sources, proposed) {
  const monitor = await lockedMonitor(c, job.request.monitor_id);
  const run = (
    await c.query(
      "SELECT * FROM monitor_runs WHERE job_id=$1 AND monitor_id=$2",
      [job.id, monitor.id],
    )
  ).rows[0];
  requireThat(run, "monitor_run_not_found", 409);
  const snapshot = normalizeSnapshot(
    sources,
    job.request,
    new Date().toISOString(),
  );
  const inspection = inspectChanges(
    snapshot,
    job.request.previous_state,
    job.request.config.rules,
  );
  const result = inspectionResult(snapshot, inspection);
  const failures = (proposed?.limitations || [])
    .filter((x) =>
      /^shop_(base_info|data_trends|product_analysis)：采集失败（[a-z][a-z0-9_]{1,80}）$/.test(
        x,
      ),
    )
    .slice(0, 3);
  result.limitations.push(...failures.map((x) => `执行器反馈：${x}`));
  snapshot.issues.push(...failures.map((x) => `执行器反馈：${x}`));
  // Only labeled hypotheses from the model survive; facts are always recomputed.
  const knownIds = new Set(inspection.events.flatMap((x) => x.evidence_ids));
  if (inspection.events.length && job.request.config.ai_enabled) {
    const explanations = (proposed?.sections || [])
      .filter(
        (x) =>
          x.kind === "inferred" &&
          x.evidence_ids.length &&
          x.evidence_ids.every((k) => knownIds.has(k)),
      )
      .slice(0, 3);
    result.sections.push(...explanations);
    if (!explanations.length)
      result.limitations.push("本轮 AI 解读不可用，已保留规则事件与证据。");
  }
  if (inspection.warning) snapshot.issues.push(inspection.warning);
  await c.query("UPDATE monitor_runs SET snapshot=$2 WHERE job_id=$1", [
    job.id,
    snapshot,
  ]);
  await c.query(
    "UPDATE shop_monitors SET state=$2,updated_at=now() WHERE id=$1",
    [monitor.id, inspection.state],
  );
  for (const event of inspection.events) {
    await c.query(
      "INSERT INTO monitor_events(id,workspace_id,monitor_id,job_id,event_key,kind,data) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(workspace_id,monitor_id,event_key) DO NOTHING",
      [
        id(),
        job.workspace_id,
        monitor.id,
        job.id,
        event.key,
        event.kind,
        { ...event, rule_version: 1 },
      ],
    );
  }
  return result;
}

export function installMonitoring(app, db, store, projectRoot) {
  app.decorate("monitorTick", () => tickMonitors(db));
  async function ensureSkill(workspace, actor) {
    const exists = await db.tenant(
      workspace,
      async (c) =>
        (
          await c.query("SELECT 1 FROM skill_bindings WHERE skill_id=$1", [
            KINDS.monitoring,
          ])
        ).rowCount,
    );
    if (exists) return;
    const bundle = await projectBundle(projectRoot, KINDS.monitoring);
    try {
      await publishSkill(
        db,
        store,
        workspace,
        actor,
        KINDS.monitoring,
        bundle,
        0,
      );
    } catch (e) {
      if (e.code !== "skill_publish_conflict") throw e;
    }
  }
  app.get("/api/monitors", { preHandler: app.user }, async (req) =>
    db.tenant(req.workspace, async (c) => ({
      items: (
        await c.query(`SELECT m.id,m.name,m.seller_id,m.market,m.status,m.config,m.version,m.last_error,m.last_completed_at,m.last_job_id,
    s.due_at AS next_run_at,j.status AS last_status,
    (SELECT count(*)::int FROM monitor_events e WHERE e.monitor_id=m.id AND e.read_at IS NULL) AS unread_count
    FROM shop_monitors m LEFT JOIN monitor_schedule s ON s.monitor_id=m.id AND s.workspace_id=m.workspace_id
    LEFT JOIN jobs j ON j.id=m.last_job_id WHERE m.status<>'archived' ORDER BY m.created_at DESC LIMIT 50`)
      ).rows,
    })),
  );
  async function createMonitor(
    workspace,
    actor,
    v,
    reuse = false,
    source = {},
  ) {
    return db.tenant(workspace, async (c) => {
      await assertWorkspaceAccess(c, workspace, actor);
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `monitors:${workspace}`,
      ]);
      const existing = (
        await c.query(
          "SELECT id,name,status FROM shop_monitors WHERE seller_id=$1 AND market=$2 AND status<>'archived'",
          [v.seller_id, v.market],
        )
      ).rows[0];
      if (existing) {
        requireThat(reuse, "monitor_duplicate", 409);
        return { ...existing, reused: true };
      }
      requireThat(
        Number(
          (
            await c.query(
              "SELECT count(*) FROM shop_monitors WHERE status<>'archived'",
            )
          ).rows[0].count,
        ) < 50,
        "monitor_limit",
        409,
      );
      const monitorId = id();
      const item = (
        await c.query(
          "INSERT INTO shop_monitors(id,workspace_id,created_by,name,seller_id,market,config) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,name,status",
          [
            monitorId,
            workspace,
            actor,
            v.name,
            v.seller_id,
            v.market,
            v.config,
          ],
        )
      ).rows[0];
      await c.query(
        "INSERT INTO monitor_schedule(monitor_id,workspace_id,due_at) VALUES($1,$2,now())",
        [monitorId, workspace],
      );
      await c.query(
        "INSERT INTO tenant_audit(workspace_id,actor_id,action,target_id,summary) VALUES($1,$2,'monitor.create',$3,$4)",
        [
          workspace,
          actor,
          monitorId,
          { seller_id: v.seller_id, market: v.market, ...source },
        ],
      );
      return { ...item, reused: false };
    });
  }
  app.post("/api/monitors", { preHandler: app.user }, async (req) => {
    const v = MonitorInput.parse(req.body);
    await db.tenant(req.workspace, (c) =>
      assertWorkspaceAccess(c, req.workspace, req.identity.id),
    );
    await ensureSkill(req.workspace, req.identity.id);
    return createMonitor(req.workspace, req.identity.id, v);
  });
  app.post(
    "/api/reports/:reportId/candidates/:productId/monitor",
    { preHandler: app.user },
    async (req) => {
      z.object({})
        .strict()
        .parse(req.body ?? {});
      const reportId = uuid.parse(req.params.reportId);
      const productId = z.string().min(1).max(200).parse(req.params.productId);
      const target = await db.tenant(req.workspace, async (c) => {
        await assertWorkspaceAccess(c, req.workspace, req.identity.id);
        const candidates = await reportMonitorCandidates(c, store, reportId);
        const candidate = candidates.find(
          (item) => item.product_id === productId,
        );
        requireThat(candidate, "candidate_not_found", 404);
        requireThat(candidate.monitor_target, "candidate_shop_missing", 409);
        return candidate.monitor_target;
      });
      await ensureSkill(req.workspace, req.identity.id);
      return createMonitor(
        req.workspace,
        req.identity.id,
        MonitorInput.parse(target),
        true,
        {
          report_id: reportId,
          product_id: productId,
          source: "scouting",
        },
      );
    },
  );
  app.get("/api/monitors/events", { preHandler: app.user }, async (req) =>
    db.tenant(req.workspace, async (c) => ({
      items: (
        await c.query(
          "SELECT e.*,m.name AS monitor_name,m.seller_id,m.market FROM monitor_events e JOIN shop_monitors m ON m.id=e.monitor_id ORDER BY e.created_at DESC,e.id DESC LIMIT 100",
        )
      ).rows,
    })),
  );
  app.post(
    "/api/monitors/events/:id/read",
    { preHandler: app.user },
    async (req) =>
      db.tenant(req.workspace, async (c) => {
        const row = (
          await c.query(
            "UPDATE monitor_events SET read_at=COALESCE(read_at,now()) WHERE id=$1 RETURNING id,read_at",
            [uuid.parse(req.params.id)],
          )
        ).rows[0];
        requireThat(row, "monitor_event_not_found", 404);
        return row;
      }),
  );
  app.get("/api/monitors/:id", { preHandler: app.user }, async (req) =>
    db.tenant(req.workspace, async (c) => {
      const monitorId = uuid.parse(req.params.id);
      const item = (
        await c.query("SELECT * FROM shop_monitors WHERE id=$1", [monitorId])
      ).rows[0];
      requireThat(item, "monitor_not_found", 404);
      const used = await usage(c, monitorId);
      const runs = (
        await c.query(
          `SELECT r.job_id,r.trigger,r.snapshot,r.created_at,j.status,j.error_code,j.model_spent,j.data_spent,j.result->>'report_id' AS report_id
      FROM monitor_runs r JOIN jobs j ON j.id=r.job_id WHERE r.monitor_id=$1 ORDER BY r.created_at DESC LIMIT 30`,
          [monitorId],
        )
      ).rows.map((x) => ({
        ...x,
        model_spent: cny(x.model_spent),
        data_spent: points(x.data_spent),
      }));
      const { state, ...publicItem } = item;
      return {
        item: publicItem,
        usage: {
          model: cny(used.model),
          data: points(used.data),
          period: "UTC 自然月，含未结束任务预留",
        },
        runs,
      };
    }),
  );
  app.put("/api/monitors/:id", { preHandler: app.user }, async (req) => {
    const v = z
      .object({
        version: z.number().int().positive(),
        name: z.string().trim().min(1).max(100),
        config: MonitorConfig,
      })
      .strict()
      .parse(req.body);
    return db.tenant(req.workspace, async (c) => {
      await assertWorkspaceAccess(c, req.workspace, req.identity.id);
      const m = await lockedMonitor(c, uuid.parse(req.params.id));
      requireThat(m.status !== "archived", "monitor_archived", 409);
      requireThat(m.version === v.version, "monitor_version_conflict", 409);
      requireThat(
        !(
          await c.query(
            "SELECT 1 FROM monitor_runs r JOIN jobs j ON j.id=r.job_id WHERE r.monitor_id=$1 AND j.status NOT IN ('succeeded','partial','failed','cancelled')",
            [m.id],
          )
        ).rowCount,
        "monitor_running",
        409,
      );
      // Rule changes reset trend confirmation but preserve observed products and currency.
      const state =
        digest(m.config.rules) === digest(v.config.rules)
          ? m.state
          : { ...m.state, metrics: {} };
      await c.query(
        "UPDATE shop_monitors SET name=$2,config=$3,state=$4,version=version+1,updated_at=now() WHERE id=$1",
        [m.id, v.name, v.config, state],
      );
      if (m.status === "active")
        await c.query(
          "UPDATE monitor_schedule SET due_at=now()+($2 * interval '1 hour') WHERE monitor_id=$1",
          [m.id, v.config.interval_hours],
        );
      await c.query(
        "INSERT INTO tenant_audit(workspace_id,actor_id,action,target_id,summary) VALUES($1,$2,'monitor.update',$3,$4)",
        [req.workspace, req.identity.id, m.id, { version: v.version + 1 }],
      );
      return { id: m.id, version: v.version + 1 };
    });
  });
  app.post(
    "/api/monitors/:id/status",
    { preHandler: app.user },
    async (req) => {
      const v = z
        .object({ status: z.enum(["active", "paused", "archived"]) })
        .strict()
        .parse(req.body);
      return db.tenant(req.workspace, async (c) => {
        await assertWorkspaceAccess(c, req.workspace, req.identity.id);
        const m = await lockedMonitor(c, uuid.parse(req.params.id));
        requireThat(m.status !== "archived", "monitor_archived", 409);
        await c.query(
          "UPDATE shop_monitors SET status=$2,updated_at=now() WHERE id=$1",
          [m.id, v.status],
        );
        if (v.status === "active")
          await c.query(
            "INSERT INTO monitor_schedule(monitor_id,workspace_id,due_at) VALUES($1,$2,now()) ON CONFLICT(monitor_id) DO UPDATE SET due_at=now()",
            [m.id, req.workspace],
          );
        else
          await c.query(
            "DELETE FROM monitor_schedule WHERE monitor_id=$1 AND workspace_id=$2",
            [m.id, req.workspace],
          );
        await c.query(
          "INSERT INTO tenant_audit(workspace_id,actor_id,action,target_id,summary) VALUES($1,$2,'monitor.status',$3,$4)",
          [req.workspace, req.identity.id, m.id, v],
        );
        return { id: m.id, ...v };
      });
    },
  );
  app.post("/api/monitors/:id/run", { preHandler: app.user }, async (req) => {
    const v = z
      .object({ idempotency_key: z.string().min(12).max(100) })
      .strict()
      .parse(req.body);
    return db.tenant(req.workspace, async (c) =>
      enqueueInspection(
        c,
        await lockedMonitor(c, uuid.parse(req.params.id)),
        "manual",
        v.idempotency_key,
        req.identity.id,
      ),
    );
  });
}
