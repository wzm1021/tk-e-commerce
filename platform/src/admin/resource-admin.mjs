import { z } from "zod";
import { uuid, requireThat } from "../common/core.mjs";
import { resourceFor } from "../data/resources.mjs";
import { publicDataPricing } from "../data/pricing.mjs";

export function installResourceAdmin(app, db, tools) {
  const admin = { preHandler: app.admin };
  const adminTx = (fn) =>
    db.tx(null, async (c) => {
      await c.query("SELECT set_config('app.platform_admin','true',true)");
      return fn(c);
    });
  const audit = (c, actor, action, target, summary) =>
    c.query(
      "INSERT INTO platform_audit(actor_id,action,target_id,summary) VALUES($1,$2,$3,$4)",
      [actor, action, target, summary],
    );
  app.get("/api/admin/resources", admin, async (req) => {
    const connections = (
      await db.query(
        "SELECT c.id,c.name,c.kind,c.enabled,c.resource_key,c.share_market_snapshots FROM connections c WHERE $1 OR NOT EXISTS(SELECT 1 FROM workspace_connections w WHERE w.connection_id=c.id) OR EXISTS(SELECT 1 FROM workspace_connections w JOIN workspaces s ON s.id=w.workspace_id WHERE w.connection_id=c.id AND w.enabled AND s.enabled) ORDER BY c.created_at",
        [req.query.include_disabled === "true"],
      )
    ).rows;
    for (const c of connections)
      if (!c.resource_key) c.resource_key = await resourceFor(db, c.id);
    const groups = (
      await db.query(
        "SELECT g.*, (SELECT count(*) FROM api_resource_tickets t WHERE t.resource_key=g.key AND t.state='active' AND t.expires_at>now()) AS active, (SELECT count(*) FROM api_resource_tickets t WHERE t.resource_key=g.key AND t.state='queued' AND t.expires_at>now()) AS queued FROM api_resource_groups g ORDER BY key",
      )
    ).rows;
    const visible = new Set(connections.map((c) => c.resource_key));
    return { groups: groups.filter((g) => visible.has(g.key)), connections };
  });
  app.put("/api/admin/resources/:key", admin, async (req) => {
    const v = z
      .object({
        max_concurrent: z.number().int().min(1).max(100),
        max_per_workspace: z.number().int().min(1).max(100),
        queue_limit: z.number().int().min(1).max(1000),
        requests_per_minute: z.number().int().min(1).max(10000),
      })
      .strict()
      .parse(req.body);
    requireThat(
      v.max_per_workspace <= v.max_concurrent,
      "invalid_resource_limits",
    );
    await db.tx(null, async (c) => {
      requireThat(
        (
          await c.query(
            "UPDATE api_resource_groups SET max_concurrent=$2,max_per_workspace=$3,queue_limit=$4,requests_per_minute=$5,updated_at=now() WHERE key=$1 RETURNING key",
            [
              req.params.key,
              v.max_concurrent,
              v.max_per_workspace,
              v.queue_limit,
              v.requests_per_minute,
            ],
          )
        ).rowCount,
        "resource_not_found",
        404,
      );
      await audit(c, req.identity.id, "resource.configure", req.params.key, v);
    });
    return { ok: true };
  });
  app.put("/api/admin/connections/:id/snapshots", admin, async (req) => {
    const v = z.object({ shared: z.boolean() }).strict().parse(req.body);
    await db.tx(null, async (c) => {
      requireThat(
        (
          await c.query(
            "UPDATE connections SET share_market_snapshots=$2 WHERE id=$1 AND kind IN ('fastmoss','sellersprite') RETURNING id",
            [uuid.parse(req.params.id), v.shared],
          )
        ).rowCount,
        "fastmoss_connection_required",
      );
      await audit(c, req.identity.id, "snapshot.sharing", req.params.id, v);
    });
    return { ok: true };
  });
  app.get("/api/admin/data-library", admin, async () =>
    adminTx(async (c) => ({
      policies: (
        await c.query("SELECT * FROM data_cache_policies ORDER BY tool")
      ).rows,
      tools: tools
        .filter((t) => t.name !== "credit_usage_summary")
        .map((t) => t.name),
      snapshots: (
        await c.query(
          "SELECT s.id,s.connection_id,s.scope_workspace_id,s.tool,s.captured_at,s.expires_at,s.reusable,s.size_bytes,(s.reusable AND s.expires_at>now() AND s.captured_at>now()-(SELECT p.ttl_seconds FROM data_cache_policies p WHERE p.tool IN(s.tool,'*') ORDER BY (p.tool=s.tool) DESC LIMIT 1)*interval '1 second') AS fresh FROM data_snapshots s ORDER BY s.captured_at DESC,s.id DESC LIMIT 100",
        )
      ).rows,
      unresolved: (
        await c.query(
          "SELECT id,connection_id,owner_workspace_id,invocation_id,tool,state,created_at,error_code FROM data_fetches WHERE state='uncertain' OR (state='started' AND expires_at<now()) ORDER BY created_at LIMIT 100",
        )
      ).rows,
      usage: (
        await c.query(
          "SELECT * FROM data_usage_daily WHERE day>=current_date-30 ORDER BY day DESC,connection_id",
        )
      ).rows,
      price: publicDataPricing(),
    })),
  );
  app.put("/api/admin/data-library/policy", admin, async (req) => {
    const v = z
      .object({
        tool: z.string(),
        ttl_seconds: z.number().int().min(0).max(86400),
      })
      .strict()
      .parse(req.body);
    requireThat(
      v.tool === "*" ||
        tools.some(
          (t) => t.name === v.tool && t.name !== "credit_usage_summary",
        ),
      "invalid_cache_tool",
    );
    await db.tx(null, async (c) => {
      await c.query(
        "INSERT INTO data_cache_policies(tool,ttl_seconds) VALUES($1,$2) ON CONFLICT(tool) DO UPDATE SET ttl_seconds=$2,updated_at=now()",
        [v.tool, v.ttl_seconds],
      );
      await audit(c, req.identity.id, "snapshot.policy", v.tool, v);
    });
    return { ok: true };
  });
  app.get("/api/admin/data-library/snapshots/:id", admin, (req) =>
    adminTx(async (c) => {
      const row = (
        await c.query("SELECT * FROM data_snapshots WHERE id=$1", [
          uuid.parse(req.params.id),
        ])
      ).rows[0];
      requireThat(row, "snapshot_not_found", 404);
      await audit(c, req.identity.id, "snapshot.read", row.id, {});
      return row;
    }),
  );
  app.get("/api/admin/data-library/fetches/:id", admin, (req) =>
    adminTx(async (c) => {
      const fetch = (
        await c.query("SELECT * FROM data_fetches WHERE id=$1", [
          uuid.parse(req.params.id),
        ])
      ).rows[0];
      requireThat(fetch, "fetch_not_found", 404);
      const responses = (
        await c.query(
          "SELECT http_status,body,captured_at FROM data_provider_responses WHERE fetch_id=$1 ORDER BY captured_at,id",
          [fetch.id],
        )
      ).rows;
      await audit(c, req.identity.id, "snapshot.response.read", fetch.id, {});
      return { fetch, responses };
    }),
  );
  app.post(
    "/api/admin/data-library/fetches/:id/unblock",
    admin,
    async (req) => {
      const v = z
        .object({
          provider_reference: z.string().min(5).max(500),
          note: z.string().min(5).max(1000),
        })
        .strict()
        .parse(req.body);
      await adminTx(async (c) => {
        const f = (
          await c.query(
            "SELECT *,expires_at<clock_timestamp() AS expired FROM data_fetches WHERE id=$1 FOR UPDATE",
            [uuid.parse(req.params.id)],
          )
        ).rows[0];
        requireThat(
          f &&
            (f.state === "uncertain" || (f.state === "started" && f.expired)),
          "fetch_not_uncertain",
          409,
        );
        // Reconciliation must settle the original tenant reservation first. Never invent a zero charge.
        await c.query("SELECT set_config('app.workspace_id',$1,true)", [
          f.owner_workspace_id,
        ]);
        const inv =
          f.invocation_id &&
          (
            await c.query("SELECT state FROM invocations WHERE id=$1", [
              f.invocation_id,
            ])
          ).rows[0];
        requireThat(
          !f.invocation_id || ["succeeded", "rejected"].includes(inv?.state),
          "reconcile_invocation_first",
          409,
        );
        await c.query(
          "UPDATE data_fetches SET state='failed',completed_at=now(),error_code='admin_reconciled' WHERE id=$1",
          [f.id],
        );
        await audit(c, req.identity.id, "snapshot.unblock", f.id, v);
      });
      return { ok: true };
    },
  );
}
