import { z } from "zod";
import {
  id,
  uuid,
  requireThat,
  micro,
  digest,
  publicPrice,
} from "../common/core.mjs";
import { points, pointUnits } from "../common/data-points.mjs";
import { creditWallet } from "../admin/admin.mjs";
import { normalizeEmail, eligibleModels } from "./account-policy.mjs";
const Email = z.string().trim().email().max(254).transform(normalizeEmail);
const MemberInput = z
  .object({ email: Email, role: z.enum(["admin", "member"]).default("member") })
  .strict();

export function addMonths(date, months) {
  const result = new Date(date),
    day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const last = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, last));
  return result;
}
export function installTeams(app, db, provisioner) {
  async function team(c, wid) {
    const w = (
      await c.query(
        `SELECT w.*,s.seat_limit,s.starts_at,s.ends_at,
      s.ends_at>clock_timestamp() AND s.starts_at<=clock_timestamp() AS subscribed
      FROM workspaces w LEFT JOIN subscription_periods s ON s.id=w.subscription_id WHERE w.id=$1 FOR NO KEY UPDATE OF w`,
        [wid],
      )
    ).rows[0];
    requireThat(w?.enabled, "workspace_forbidden", 403);
    return w;
  }
  async function manager(c, wid, actor, platform = false) {
    const w = await team(c, wid);
    requireThat(w.kind === "team", "team_required", 409);
    const role = platform
      ? "owner"
      : (
          await c.query(
            "SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2",
            [wid, actor],
          )
        ).rows[0]?.role;
    requireThat(
      ["owner", "admin"].includes(role),
      "team_manager_required",
      403,
    );
    return { w, role };
  }
  const audit = (c, wid, actor, action, target, summary = {}) =>
    c.query(
      "INSERT INTO tenant_audit(workspace_id,actor_id,action,target_id,summary) VALUES($1,$2,$3,$4,$5)",
      [wid, actor, action, target, summary],
    );
  async function members(c, wid) {
    return (
      await c.query(
        `SELECT u.id,u.display_name,u.email,u.login,u.enabled,m.role FROM memberships m
      JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,u.created_at`,
        [wid],
      )
    ).rows;
  }
  async function addMember(req, wid, platform = false) {
    const v = MemberInput.parse(req.body);
    return db.tenant(wid, async (c) => {
      const { w, role } = await manager(c, wid, req.identity.id, platform);
      requireThat(
        v.role === "member" || role === "owner",
        "team_owner_required",
        403,
      );
      requireThat(
        !w.subscription_required || w.subscribed,
        "subscription_inactive",
        409,
      );
      const user = (
        await c.query(
          "SELECT id FROM users WHERE email=$1 AND email_verified_at IS NOT NULL AND enabled",
          [v.email],
        )
      ).rows[0];
      requireThat(user, "registered_member_required", 404);
      if (
        (
          await c.query(
            "SELECT 1 FROM memberships WHERE workspace_id=$1 AND user_id=$2",
            [wid, user.id],
          )
        ).rowCount
      )
        return { ok: true, already_member: true };
      const count = Number(
        (
          await c.query(
            "SELECT count(*) AS n FROM memberships WHERE workspace_id=$1",
            [wid],
          )
        ).rows[0].n,
      );
      requireThat(count < (w.seat_limit || 5), "team_seat_limit", 409);
      await c.query(
        "INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,$3)",
        [wid, user.id, v.role],
      );
      await audit(c, wid, req.identity.id, "team.member.add", user.id, {
        role: v.role,
      });
      return { ok: true };
    });
  }
  app.post("/api/teams", { preHandler: app.account }, async (req) => {
    const v = z
      .object({ name: z.string().trim().min(1).max(100) })
      .strict()
      .parse(req.body);
    const bundles = await provisioner.prepare();
    return db.tx(null, async (c) => {
      await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
        req.identity.id,
      ]);
      const count = Number(
        (
          await c.query(
            "SELECT count(*) AS n FROM memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE m.user_id=$1 AND m.role='owner' AND w.kind='team' AND w.enabled",
            [req.identity.id],
          )
        ).rows[0].n,
      );
      requireThat(count < 5, "team_creation_limit", 409);
      const wid = id();
      await provisioner.create(
        c,
        wid,
        req.identity.id,
        v.name,
        "team",
        bundles,
      );
      return { id: wid };
    });
  });
  app.post("/api/admin/teams", { preHandler: app.admin }, async (req) => {
    const v = z
      .object({ name: z.string().trim().min(1).max(100), owner_email: Email })
      .strict()
      .parse(req.body);
    const owner = (
      await db.query(
        "SELECT id FROM users WHERE email=$1 AND email_verified_at IS NOT NULL AND enabled",
        [v.owner_email],
      )
    ).rows[0];
    requireThat(owner, "registered_member_required", 404);
    const bundles = await provisioner.prepare();
    return db.tx(null, async (c) => {
      const wid = id();
      await provisioner.create(c, wid, owner.id, v.name, "team", bundles);
      return { id: wid };
    });
  });
  app.get("/api/team", { preHandler: app.user }, async (req) =>
    db.tenant(req.workspace, async (c) => {
      const workspace = await team(c, req.workspace);
      const list = await members(c, req.workspace);
      return {
        workspace,
        members: list,
        role: list.find((x) => x.id === req.identity.id)?.role,
        seat_limit:
          workspace.seat_limit || (workspace.kind === "personal" ? 1 : 5),
      };
    }),
  );
  app.post("/api/team/members", { preHandler: app.user }, (req) =>
    addMember(req, req.workspace),
  );
  app.patch("/api/team/members/:id", { preHandler: app.user }, async (req) => {
    const target = uuid.parse(req.params.id),
      v = z
        .object({ role: z.enum(["admin", "member"]) })
        .strict()
        .parse(req.body);
    return db.tenant(req.workspace, async (c) => {
      const { role } = await manager(c, req.workspace, req.identity.id);
      requireThat(role === "owner", "team_owner_required", 403);
      const old = (
        await c.query(
          "SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2",
          [req.workspace, target],
        )
      ).rows[0];
      requireThat(old && old.role !== "owner", "owner_transfer_required", 409);
      await c.query(
        "UPDATE memberships SET role=$3 WHERE workspace_id=$1 AND user_id=$2",
        [req.workspace, target, v.role],
      );
      await audit(
        c,
        req.workspace,
        req.identity.id,
        "team.member.role",
        target,
        v,
      );
      return { ok: true };
    });
  });
  app.delete("/api/team/members/:id", { preHandler: app.user }, async (req) => {
    const target = uuid.parse(req.params.id);
    return db.tenant(req.workspace, async (c) => {
      const { role } = await manager(c, req.workspace, req.identity.id);
      const old = (
        await c.query(
          "SELECT role FROM memberships WHERE workspace_id=$1 AND user_id=$2",
          [req.workspace, target],
        )
      ).rows[0];
      requireThat(old, "member_not_found", 404);
      requireThat(old.role !== "owner", "owner_transfer_required", 409);
      requireThat(
        role === "owner" || old.role === "member",
        "team_owner_required",
        403,
      );
      await c.query(
        "DELETE FROM memberships WHERE workspace_id=$1 AND user_id=$2",
        [req.workspace, target],
      );
      await audit(
        c,
        req.workspace,
        req.identity.id,
        "team.member.remove",
        target,
      );
      return { ok: true };
    });
  });
  app.post("/api/team/transfer", { preHandler: app.user }, async (req) => {
    const v = z.object({ user_id: uuid }).strict().parse(req.body);
    return db.tenant(req.workspace, async (c) => {
      const { role } = await manager(c, req.workspace, req.identity.id);
      requireThat(
        role === "owner" && v.user_id !== req.identity.id,
        "team_owner_required",
        403,
      );
      requireThat(
        (
          await c.query(
            "SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2 AND u.enabled",
            [req.workspace, v.user_id],
          )
        ).rowCount,
        "member_not_found",
        404,
      );
      await c.query(
        "UPDATE memberships SET role='admin' WHERE workspace_id=$1 AND role='owner'",
        [req.workspace],
      );
      await c.query(
        "UPDATE memberships SET role='owner' WHERE workspace_id=$1 AND user_id=$2",
        [req.workspace, v.user_id],
      );
      await audit(
        c,
        req.workspace,
        req.identity.id,
        "team.owner.transfer",
        v.user_id,
      );
      return { ok: true };
    });
  });
  app.get("/api/settings", { preHandler: app.user }, async (req) =>
    db.tenant(req.workspace, async (c) => {
      const profile = (
        await c.query(
          "SELECT display_name,email,email_verified_at FROM users WHERE id=$1",
          [req.identity.id],
        )
      ).rows[0];
      const preference = (
        await c.query(
          "SELECT default_model_id,role FROM memberships WHERE workspace_id=$1 AND user_id=$2",
          [req.workspace, req.identity.id],
        )
      ).rows[0];
      const usage = async (user) =>
        (
          await c.query(
            `SELECT count(*) FILTER(WHERE i.kind='model' AND i.state='succeeded')::int AS model_requests,
      count(*) FILTER(WHERE i.kind='data' AND i.state='succeeded')::int AS data_requests,
      count(*) FILTER(WHERE i.kind='data' AND i.state='succeeded' AND i.usage->>'cache_hit'='true')::int AS snapshot_hits,
      count(*) FILTER(WHERE i.state='reconciling')::int AS pending_reconciliation,
      COALESCE(sum((i.usage#>>'{normalized,input_uncached}')::bigint+(i.usage#>>'{normalized,cache_read}')::bigint) FILTER(WHERE i.kind='model' AND i.state='succeeded'),0)::text AS input_tokens,
      COALESCE(sum((i.usage#>>'{normalized,output_total}')::bigint) FILTER(WHERE i.kind='model' AND i.state='succeeded'),0)::text AS output_tokens,
      COALESCE(sum((i.usage#>>'{normalized,cache_read}')::bigint) FILTER(WHERE i.kind='model' AND i.state='succeeded'),0)::text AS cached_tokens,
      COALESCE(sum(i.charged) FILTER(WHERE i.kind='data' AND i.state='succeeded'),0)::text AS data_units,
      COALESCE(sum(i.charged) FILTER(WHERE i.kind='model' AND i.state='succeeded'),0)::text AS model_micro_cny
      FROM invocations i JOIN jobs j ON j.id=i.job_id WHERE i.workspace_id=$1 AND ($2::uuid IS NULL OR j.created_by=$2)
      AND i.created_at >= date_trunc('month',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'`,
            [req.workspace, user],
          )
        ).rows[0];
      const own = await usage(req.identity.id),
        shared = await usage(null);
      const suggestionUsage = (
        await c.query(`SELECT created_by,count(*) FILTER(WHERE usage IS NOT NULL)::int model_requests,
        COALESCE(sum((usage#>>'{normalized,input_uncached}')::bigint+(usage#>>'{normalized,cache_read}')::bigint),0)::text input_tokens,
        COALESCE(sum((usage#>>'{normalized,output_total}')::bigint),0)::text output_tokens,
        COALESCE(sum((usage#>>'{normalized,cache_read}')::bigint),0)::text cached_tokens
        FROM ai_test_suggestions WHERE created_at >= date_trunc('month',now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai' GROUP BY created_by`)
      ).rows;
      for (const row of suggestionUsage) {
        for (const target of row.created_by === req.identity.id
          ? [own, shared]
          : [shared]) {
          target.model_requests += row.model_requests;
          for (const key of ["input_tokens", "output_tokens", "cached_tokens"])
            target[key] = String(BigInt(target[key]) + BigInt(row[key]));
        }
      }
      for (const u of [own, shared]) {
        u.data_points = points(u.data_units);
        delete u.data_units;
        u.total_tokens = String(
          BigInt(u.input_tokens) + BigInt(u.output_tokens),
        );
      }
      return {
        profile,
        preference,
        usage: { period: "本月（北京时间）", own, team: shared },
        models: (await eligibleModels(c, req.workspace)).map((x) => ({
          id: x.id,
          name: x.name,
          model: x.config.model,
          price: publicPrice(x.price),
        })),
      };
    }),
  );
  app.put("/api/settings", { preHandler: app.user }, async (req) => {
    const v = z
      .object({
        display_name: z.string().trim().min(1).max(80),
        default_model_id: uuid.nullable(),
      })
      .strict()
      .parse(req.body);
    return db.tenant(req.workspace, async (c) => {
      if (v.default_model_id)
        requireThat(
          (await eligibleModels(c, req.workspace)).some(
            (x) => x.id === v.default_model_id,
          ),
          "model_unavailable",
          409,
        );
      await c.query("UPDATE users SET display_name=$2 WHERE id=$1", [
        req.identity.id,
        v.display_name,
      ]);
      await c.query(
        "UPDATE memberships SET default_model_id=$3 WHERE workspace_id=$1 AND user_id=$2",
        [req.workspace, req.identity.id, v.default_model_id],
      );
      return { ok: true };
    });
  });
  app.get(
    "/api/admin/workspaces/:id/members",
    { preHandler: app.admin },
    async (req) => ({ items: await members(db, uuid.parse(req.params.id)) }),
  );
  app.post(
    "/api/admin/workspaces/:id/members",
    { preHandler: app.admin },
    (req) => addMember(req, uuid.parse(req.params.id), true),
  );
  app.get(
    "/api/admin/workspaces/:id/subscription",
    { preHandler: app.admin },
    (req) =>
      db.tenant(uuid.parse(req.params.id), async (c) => ({
        workspace: await team(c, req.params.id),
        periods: (
          await c.query(
            "SELECT * FROM subscription_periods ORDER BY created_at DESC LIMIT 30",
          )
        ).rows,
      })),
  );
  app.post(
    "/api/admin/workspaces/:id/subscription",
    { preHandler: app.admin },
    async (req) => {
      const wid = uuid.parse(req.params.id),
        v = z
          .object({
            reference: z.string().trim().min(8).max(120),
            kind: z.enum(["paid", "trial"]),
            months: z.number().int().min(1).max(12),
            seat_limit: z.number().int().min(1).max(200),
            model_credit: z.string().regex(/^\d+(\.\d{1,2})?$/),
            data_credit: z.number().min(0).max(1000000),
            fee_cny: z.string().regex(/^\d+(\.\d{1,2})?$/),
          })
          .strict()
          .parse(req.body);
      requireThat(
        micro(v.model_credit) <= 1000000000000n &&
          micro(v.fee_cny) <= 1000000000000n,
        "credit_too_large",
      );
      requireThat(
        (v.kind === "paid" && micro(v.fee_cny) > 0n) ||
          (v.kind === "trial" && micro(v.fee_cny) === 0n),
        "subscription_payment_kind",
      );
      return db.tenant(wid, async (c) => {
        const w = await team(c, wid);
        requireThat(w.kind === "team", "team_required", 409);
        const existing = (
          await c.query(
            "SELECT id,terms FROM subscription_periods WHERE reference=$1",
            [v.reference],
          )
        ).rows[0];
        if (existing) {
          requireThat(
            digest(existing.terms) === digest(v),
            "subscription_reference_conflict",
            409,
          );
          return { id: existing.id, duplicate: true };
        }
        const count = Number(
          (
            await c.query(
              "SELECT count(*) AS n FROM memberships WHERE workspace_id=$1",
              [wid],
            )
          ).rows[0].n,
        );
        requireThat(
          v.seat_limit >= count,
          "subscription_seats_below_members",
          409,
        );
        const sid = id(),
          now = new Date(),
          end = addMonths(
            w.ends_at && new Date(w.ends_at) > now ? w.ends_at : now,
            v.months,
          );
        await c.query(
          "INSERT INTO subscription_periods(id,workspace_id,actor_id,reference,kind,starts_at,ends_at,seat_limit,model_credit,data_credit,fee_micro_cny,terms) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
          [
            sid,
            wid,
            req.identity.id,
            v.reference,
            v.kind,
            now,
            end,
            v.seat_limit,
            micro(v.model_credit).toString(),
            pointUnits(v.data_credit).toString(),
            micro(v.fee_cny).toString(),
            v,
          ],
        );
        for (const [currency, amount] of [
          ["model_micro_cny", micro(v.model_credit)],
          ["data_points", pointUnits(v.data_credit)],
        ])
          if (amount > 0n)
            await creditWallet(
              c,
              wid,
              currency,
              amount,
              "subscription:" + sid,
              {
                type: v.kind === "trial" ? "sponsored_test" : "subscription",
                subscription_id: sid,
                actor_id: req.identity.id,
                payment_reference: v.reference,
              },
            );
        await c.query(
          "UPDATE workspaces SET subscription_required=true,subscription_id=$2 WHERE id=$1",
          [wid, sid],
        );
        await c.query(
          "INSERT INTO platform_audit(actor_id,action,target_id,summary) VALUES($1,'subscription.activate',$2,$3)",
          [
            req.identity.id,
            wid,
            { subscription_id: sid, kind: v.kind, ends_at: end.toISOString() },
          ],
        );
        return { id: sid, ends_at: end };
      });
    },
  );
  app.put(
    "/api/admin/connections/:id/signup-default",
    { preHandler: app.admin },
    async (req) => {
      const cid = uuid.parse(req.params.id),
        v = z.object({ enabled: z.boolean() }).strict().parse(req.body);
      await db.tx(null, async (c) => {
        const row = (
          await c.query(
            "SELECT c.kind,c.enabled,v.verified FROM connections c JOIN connection_versions v ON v.id=c.active_version_id WHERE c.id=$1 FOR UPDATE OF c",
            [cid],
          )
        ).rows[0];
        requireThat(
          row && ["model", "fastmoss", "sellersprite"].includes(row.kind),
          "connection_not_found",
          404,
        );
        requireThat(
          !v.enabled || (row.enabled && row.verified),
          "connection_not_ready",
          409,
        );
        await c.query("UPDATE connections SET signup_default=$2 WHERE id=$1", [
          cid,
          v.enabled,
        ]);
        await c.query(
          "INSERT INTO platform_audit(actor_id,action,target_id,summary) VALUES($1,'connection.signup_default',$2,$3)",
          [req.identity.id, cid, v],
        );
      });
      return { ok: true };
    },
  );
}
