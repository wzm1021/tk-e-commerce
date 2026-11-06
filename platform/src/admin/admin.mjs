import { pointUnits } from "../common/data-points.mjs";
import { z } from "zod";
import {
  id,
  uuid,
  passwordHash,
  requireThat,
  PublishedPriceSchema,
  micro,
  KINDS,
  money,
  digest,
} from "../common/core.mjs";
import { projectBundle, publishSkill } from "../skills/skills.mjs";
import { accountTx } from "../customers/profile.mjs";
import {
  checkedEndpoint,
  providerFetch,
  readLimited,
} from "../infra/network.mjs";
export const ConnectionInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    kind: z.enum(["model", "fastmoss", "sellersprite", "1688"]),
    config: z
      .object({
        endpoint: z.string().url(),
        model: z.string().max(200).optional(),
        protocol: z.enum(["responses", "mcp", "1688-pending"]),
        context_limit: z.number().int().min(1024).max(1000000).optional(),
        output_limit: z.number().int().min(128).max(384000).optional(),
        upstream_streaming: z.boolean().default(false),
      })
      .strict(),
    secret: z.string().min(8).max(16000),
  })
  .strict();
export async function createConnection(
  db,
  secrets,
  actor,
  input,
  connectionId,
) {
  const v = ConnectionInput.parse(input);
  await checkedEndpoint(v.config.endpoint);
  requireThat(
    (v.kind === "model" &&
      v.config.protocol === "responses" &&
      v.config.model) ||
      (v.kind === "fastmoss" &&
        v.config.protocol === "mcp" &&
        new URL(v.config.endpoint).hostname === "mcp.fastmoss.com") ||
      (v.kind === "sellersprite" &&
        v.config.protocol === "mcp" &&
        new URL(v.config.endpoint).hostname === "mcp.sellersprite.com" &&
        new URL(v.config.endpoint).pathname === "/mcp") ||
      (v.kind === "1688" && v.config.protocol === "1688-pending"),
    "connection_protocol_mismatch",
  );
  const cid = connectionId || id(),
    vid = id();
  const ref = await secrets.write(v.secret, `${cid}:${vid}`);
  return db.tx(null, async (c) => {
    if (connectionId) {
      requireThat(
        (
          await c.query(
            "SELECT 1 FROM connections WHERE id=$1 AND kind=$2 FOR UPDATE",
            [cid, v.kind],
          )
        ).rowCount,
        "connection_not_found",
        404,
      );
    } else
      await c.query("INSERT INTO connections(id,name,kind) VALUES($1,$2,$3)", [
        cid,
        v.name,
        v.kind,
      ]);
    await c.query(
      "INSERT INTO connection_versions(id,connection_id,config,secret_ref) VALUES($1,$2,$3,$4)",
      [vid, cid, v.config, ref],
    );
    await c.query(
      "UPDATE connections SET active_version_id=$2,generation=generation+1,enabled=false,name=$3 WHERE id=$1",
      [cid, vid, v.name],
    );
    await c.query(
      "INSERT INTO platform_audit(actor_id,action,target_id,summary) VALUES($1,$2,$3,$4)",
      [actor, "connection.version", cid, { version_id: vid }],
    );
    return { id: cid, version_id: vid };
  });
}
export async function creditWallet(
  c,
  workspace,
  currency,
  amount,
  reference,
  detail,
) {
  requireThat(amount > 0n, "credit_positive");
  const inserted = await c.query(
    "INSERT INTO ledger(id,workspace_id,currency,operation,amount,reference,detail) VALUES($1,$2,$3,'credit',$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id",
    [id(), workspace, currency, amount.toString(), reference, detail],
  );
  if (!inserted.rowCount) {
    const old = (
      await c.query(
        "SELECT amount,detail,data_unit_scale FROM ledger WHERE currency=$1 AND operation='credit' AND reference=$2",
        [currency, reference],
      )
    ).rows[0];
    requireThat(
      old &&
        BigInt(old.amount) *
          (currency === "data_points" && old.data_unit_scale === 1
            ? 10n
            : 1n) ===
          amount &&
        digest(old.detail) === digest(detail),
      "credit_idempotency_conflict",
      409,
    );
    return { duplicate: true };
  }
  await c.query(
    "INSERT INTO wallets(workspace_id,currency,available) VALUES($1,$2,$3) ON CONFLICT(workspace_id,currency) DO UPDATE SET available=wallets.available+EXCLUDED.available",
    [workspace, currency, amount.toString()],
  );
  return { duplicate: false };
}
export function installAdmin(
  app,
  db,
  store,
  secrets,
  projectRoot,
  validateConnection,
) {
  const admin = { preHandler: app.admin };
  app.get("/api/admin/overview", admin, async () => {
    const [ws, users, connections, audit] = await Promise.all([
      accountTx(
        db,
        null,
        (c) =>
          c.query(`SELECT w.*,COALESCE(owners.company_names,ARRAY[]::text[]) AS company_names
            FROM workspaces w LEFT JOIN (
              SELECT m.workspace_id,
                array_agg(DISTINCT btrim(p.data->>'company_name') ORDER BY btrim(p.data->>'company_name')) AS company_names
              FROM memberships m JOIN customer_profiles p ON p.user_id=m.user_id
              WHERE m.role='owner' AND NULLIF(btrim(p.data->>'company_name'),'') IS NOT NULL
              GROUP BY m.workspace_id
            ) owners ON owners.workspace_id=w.id ORDER BY w.created_at DESC`),
        true,
      ),
      db.query(
        "SELECT id,login,display_name,is_admin,enabled,created_at FROM users ORDER BY created_at DESC",
      ),
      db.query(
        "SELECT c.*,v.config,v.verified,v.validation FROM connections c LEFT JOIN connection_versions v ON v.id=c.active_version_id ORDER BY c.created_at",
      ),
      db.query("SELECT * FROM platform_audit ORDER BY id DESC LIMIT 100"),
    ]);
    return {
      workspaces: ws.rows,
      users: users.rows,
      connections: connections.rows,
      audit: audit.rows,
    };
  });
  app.post("/api/admin/workspaces", admin, async (req) => {
    const v = z
      .object({ name: z.string().min(1).max(100) })
      .strict()
      .parse(req.body);
    return db.tx(null, async (c) => {
      const row = (
        await c.query(
          "INSERT INTO workspaces(id,name) VALUES($1,$2) RETURNING *",
          [id(), v.name],
        )
      ).rows[0];
      await c.query(
        "INSERT INTO platform_audit(actor_id,action,target_id) VALUES($1,'workspace.create',$2)",
        [req.identity.id, row.id],
      );
      return row;
    });
  });
  app.post("/api/admin/users", admin, async () => {
    requireThat(false, "email_registration_required", 409);
  });
  app.patch("/api/admin/users/:id", admin, async (req) => {
    const uid = uuid.parse(req.params.id);
    const v = z.object({ enabled: z.boolean() }).strict().parse(req.body);
    requireThat(uid !== req.identity.id, "cannot_disable_self");
    await db.tx(null, async (c) => {
      requireThat(
        (
          await c.query("UPDATE users SET enabled=$2 WHERE id=$1", [
            uid,
            v.enabled,
          ])
        ).rowCount,
        "user_not_found",
        404,
      );
      if (!v.enabled)
        await c.query("DELETE FROM sessions WHERE user_id=$1", [uid]);
      await c.query(
        "INSERT INTO platform_audit(actor_id,action,target_id,summary) VALUES($1,'user.enabled',$2,$3)",
        [req.identity.id, uid, v],
      );
    });
    return { ok: true };
  });
  app.post("/api/admin/connections", admin, (req) =>
    createConnection(db, secrets, req.identity.id, req.body),
  );
  app.post("/api/admin/connections/:id/rotate", admin, (req) =>
    createConnection(
      db,
      secrets,
      req.identity.id,
      req.body,
      uuid.parse(req.params.id),
    ),
  );
  app.post("/api/admin/connections/:id/validate", admin, async (req) =>
    validateConnection(uuid.parse(req.params.id), req.identity.id),
  );
  app.patch("/api/admin/connections/:id", admin, async (req) => {
    const cid = uuid.parse(req.params.id);
    const { enabled } = z
      .object({ enabled: z.boolean() })
      .strict()
      .parse(req.body);
    await db.tx(null, async (c) => {
      const row = (
        await c.query(
          "SELECT c.kind,v.verified FROM connections c JOIN connection_versions v ON v.id=c.active_version_id WHERE c.id=$1 FOR UPDATE OF c",
          [cid],
        )
      ).rows[0];
      requireThat(row, "connection_not_found", 404);
      requireThat(!enabled || row.verified, "connection_not_verified", 409);
      await c.query("UPDATE connections SET enabled=$2 WHERE id=$1", [
        cid,
        enabled,
      ]);
      await c.query(
        "INSERT INTO platform_audit(actor_id,action,target_id,summary) VALUES($1,'connection.enabled',$2,$3)",
        [req.identity.id, cid, { enabled }],
      );
    });
    return { ok: true };
  });
  app.get("/api/admin/prices", admin, async () => ({
    items: (
      await db.query("SELECT * FROM price_cards ORDER BY created_at DESC")
    ).rows,
  }));
  app.post("/api/admin/prices", admin, async (req) => {
    const v = z
      .object({
        connection_id: uuid,
        name: z.string().min(1).max(100),
        data: PublishedPriceSchema,
      })
      .strict()
      .parse(req.body);
    return db.tx(null, async (c) => {
      requireThat(
        (
          await c.query(
            "SELECT 1 FROM connections WHERE id=$1 AND kind='model' FOR UPDATE",
            [v.connection_id],
          )
        ).rowCount,
        "model_connection_required",
      );
      await c.query(
        "UPDATE price_cards SET active=false WHERE connection_id=$1",
        [v.connection_id],
      );
      const pid = id();
      await c.query(
        "INSERT INTO price_cards(id,connection_id,name,data,active) VALUES($1,$2,$3,$4,true)",
        [pid, v.connection_id, v.name, v.data],
      );
      await c.query(
        "INSERT INTO platform_audit(actor_id,action,target_id,summary) VALUES($1,'price.publish',$2,$3)",
        [
          req.identity.id,
          pid,
          { connection_id: v.connection_id, data: v.data },
        ],
      );
      return { id: pid };
    });
  });
  app.put("/api/admin/workspaces/:id/connections", admin, async (req) => {
    const wid = uuid.parse(req.params.id);
    const v = z
      .object({ connection_id: uuid, enabled: z.boolean() })
      .strict()
      .parse(req.body);
    await db.tx(null, async (c) => {
      await c.query(
        "INSERT INTO workspace_connections(workspace_id,connection_id,enabled) VALUES($1,$2,$3) ON CONFLICT(workspace_id,connection_id) DO UPDATE SET enabled=$3",
        [wid, v.connection_id, v.enabled],
      );
      await c.query(
        "INSERT INTO platform_audit(actor_id,action,target_id,summary) VALUES($1,'workspace.connection',$2,$3)",
        [req.identity.id, wid, v],
      );
    });
    return { ok: true };
  });
  app.get("/api/admin/workspaces/:id", admin, async (req) =>
    db.tenant(uuid.parse(req.params.id), async (c) => {
      const ws = (
        await c.query("SELECT * FROM workspaces WHERE id=$1", [req.params.id])
      ).rows[0];
      requireThat(ws, "workspace_not_found", 404);
      const tables = {
        wallets: "SELECT * FROM wallets",
        skills:
          "SELECT b.*,r.version,r.digest FROM skill_bindings b JOIN skill_releases r ON r.id=b.release_id",
        releases:
          "SELECT id,skill_id,version,digest,created_at FROM skill_releases ORDER BY created_at DESC",
        ledger: "SELECT * FROM ledger ORDER BY created_at DESC LIMIT 100",
        jobs: "SELECT id,title,kind,status,model_spent,data_spent,error_code,updated_at FROM jobs ORDER BY created_at DESC LIMIT 100",
        connections:
          "SELECT c.id,c.name,c.kind,w.enabled FROM workspace_connections w JOIN connections c ON c.id=w.connection_id WHERE w.workspace_id=$1",
      };
      const out = { workspace: ws };
      for (const [k, q] of Object.entries(tables))
        out[k] = (
          await c.query(q, k === "connections" ? [req.params.id] : [])
        ).rows;
      return out;
    }),
  );
  app.post("/api/admin/workspaces/:id/credit", admin, async (req) => {
    const wid = uuid.parse(req.params.id);
    const v = z
      .object({
        currency: z.enum(["model_micro_cny", "data_points", "ai_test_uses"]),
        amount: money,
        reference: z.string().min(12).max(160),
        reason: z.string().min(3).max(500),
        type: z.enum(["sponsored_test", "manual_paid"]),
      })
      .strict()
      .parse(req.body);
    if (v.currency === "ai_test_uses")
      requireThat(
        /^[1-9]\d*$/.test(String(v.amount)) && Number(v.amount) <= 1000000,
        "ai_quota_integer_required",
      );
    const amount =
      v.currency === "ai_test_uses"
        ? BigInt(v.amount)
        : v.currency === "model_micro_cny"
          ? micro(v.amount)
          : pointUnits(v.amount);
    return db.tenant(wid, async (c) => {
      const r = await creditWallet(c, wid, v.currency, amount, v.reference, {
        reason: v.reason,
        type: v.type,
        actor_id: req.identity.id,
      });
      if (!r.duplicate)
        await c.query(
          "INSERT INTO platform_audit(actor_id,action,target_id,summary) VALUES($1,'wallet.credit',$2,$3)",
          [req.identity.id, wid, { ...v, amount: amount.toString() }],
        );
      return r;
    });
  });
  app.get("/api/admin/workspaces/:id/skills/:skill", admin, async (req) =>
    db.tenant(uuid.parse(req.params.id), async (c) => {
      const row = (
        await c.query(
          "SELECT b.generation,r.version,r.digest,a.* FROM skill_bindings b JOIN skill_releases r ON r.id=b.release_id JOIN artifacts a ON a.id=r.artifact_id WHERE b.skill_id=$1",
          [req.params.skill],
        )
      ).rows[0];
      if (!row) {
        const bundle = await projectBundle(projectRoot, req.params.skill);
        return {
          generation: 0,
          version: 0,
          instructions: bundle.files[`skills/${req.params.skill}/SKILL.md`],
        };
      }
      const bundle = JSON.parse(
        (await store.read(row.object_key, row.sha256)).toString(),
      );
      return {
        generation: row.generation,
        version: row.version,
        digest: row.digest,
        instructions: bundle.files[`skills/${req.params.skill}/SKILL.md`],
      };
    }),
  );
  app.post(
    "/api/admin/workspaces/:id/skills/:skill/publish",
    admin,
    async (req) => {
      const v = z
        .object({
          expected_generation: z.number().int().nonnegative(),
          instructions: z.string().min(30).max(120000).optional(),
        })
        .strict()
        .parse(req.body);
      const bundle = await projectBundle(
        projectRoot,
        req.params.skill,
        v.instructions,
      );
      return publishSkill(
        db,
        store,
        uuid.parse(req.params.id),
        req.identity.id,
        req.params.skill,
        bundle,
        v.expected_generation,
      );
    },
  );
  app.post(
    "/api/admin/workspaces/:id/skills/:skill/rollback",
    admin,
    async (req) => {
      const wid = uuid.parse(req.params.id);
      const v = z
        .object({
          release_id: uuid,
          expected_generation: z.number().int().positive(),
        })
        .strict()
        .parse(req.body);
      return db.tenant(wid, async (c) => {
        requireThat(
          (
            await c.query(
              "SELECT 1 FROM skill_releases WHERE id=$1 AND skill_id=$2",
              [v.release_id, req.params.skill],
            )
          ).rowCount,
          "release_not_found",
          404,
        );
        requireThat(
          (
            await c.query(
              "UPDATE skill_bindings SET release_id=$1,generation=generation+1 WHERE skill_id=$2 AND generation=$3",
              [v.release_id, req.params.skill, v.expected_generation],
            )
          ).rowCount,
          "skill_publish_conflict",
          409,
        );
        await c.query(
          "INSERT INTO platform_audit(actor_id,action,target_id,summary) VALUES($1,'skill.rollback',$2,$3)",
          [req.identity.id, wid, { skill_id: req.params.skill, ...v }],
        );
        return { ok: true };
      });
    },
  );
}
