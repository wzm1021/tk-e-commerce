import { z } from "zod";
import { id, uuid, requireThat, digest } from "../common/core.mjs";
import { sdkCall } from "./sdk.mjs";
import { utcMonth } from "./pool.mjs";
const counts = {
  trial_used: z.number().int().min(0).nullable(),
  monthly_used: z.number().int().min(0),
  monthly_limit: z.number().int().min(0).max(100000),
  trial_limit: z.number().int().min(0).max(10000),
};
const publicAccount = ({ secret_ref, secret_version, credential_hash, ...a }) =>
  a;
export function installAiTestAdmin(app, db, secrets, { sdk = sdkCall } = {}) {
  const admin = { preHandler: app.admin };
  app.post(
    "/api/admin/ai-test-reservations/:id/reconcile",
    admin,
    async (req) => {
      const v = z
        .object({
          remote_id: z.string().regex(/^pt_[A-Za-z0-9_-]{1,100}$/),
          note: z.string().trim().min(8).max(1000),
        })
        .strict()
        .parse(req.body);
      const r = (
        await db.query("SELECT * FROM ai_test_reservations WHERE id=$1", [
          uuid.parse(req.params.id),
        ])
      ).rows[0];
      requireThat(
        r?.state === "uncertain",
        "ai_reconciliation_not_available",
        409,
      );
      const remote = await sdk({
        action: "get",
        id: v.remote_id,
        key: await secrets.read(
          r.secret_ref,
          `ai-test:${r.account_id}:${r.secret_version}`,
        ),
      });
      return db.tenant(r.workspace_id, async (c) => {
        // Same dispatch -> run -> reservation lock order as the worker.
        const dispatch = (
          await c.query(
            "SELECT * FROM ai_test_dispatch WHERE id=$1 FOR UPDATE",
            [r.run_id],
          )
        ).rows[0];
        requireThat(
          dispatch &&
            (!dispatch.lease_until ||
              new Date(dispatch.lease_until) < new Date()),
          "ai_reconciliation_busy",
          409,
        );
        const run = (
          await c.query("SELECT * FROM ai_test_runs WHERE id=$1 FOR UPDATE", [
            r.run_id,
          ])
        ).rows[0];
        requireThat(
          run.attempt === r.attempt &&
            (!run.remote_id || run.remote_id === v.remote_id),
          "ai_remote_id_changed",
          409,
        );
        requireThat(
          remote.id === v.remote_id &&
            (remote.partner_product_id ||
              remote.spec?.external_ref?.partner_product_id) ===
              run.snapshot.spec.external_ref.partner_product_id,
          "ai_remote_identity_mismatch",
          409,
        );
        await c.query(
          "UPDATE ai_test_runs SET remote_id=$2,error_code=NULL,status='reconciling',updated_at=now() WHERE id=$1",
          [run.id, v.remote_id],
        );
        await c.query(
          "UPDATE ai_test_dispatch SET available_at=now(),lease_until=NULL,lease_token=NULL WHERE id=$1",
          [run.id],
        );
        await c.query(
          "INSERT INTO platform_audit(actor_id,action,target_id,summary) VALUES($1,'ai_test.run.reconcile',$2,$3)",
          [req.identity.id, run.id, { note: v.note, remote_id: v.remote_id }],
        );
        return { ok: true };
      });
    },
  );
  app.get("/api/admin/ai-test-accounts", admin, async () => ({
    items: (
      await db.query(
        `SELECT a.*,
 (SELECT count(*)::int FROM ai_test_reservations r WHERE r.account_id=a.id AND r.state IN('reserved','started','uncertain')) AS active,
 (SELECT COALESCE(sum(credits),0)::int FROM ai_test_reservations r WHERE r.account_id=a.id AND r.state IN('reserved','started','uncertain') AND r.quota_month=$1) AS reserved_credits
 FROM ai_test_accounts a ORDER BY priority,created_at`,
        [utcMonth()],
      )
    ).rows.map(publicAccount),
    usage: (
      await db.query(
        "SELECT r.id,r.workspace_id,r.run_id,a.name AS account_name,r.attempt,r.credits,r.state,r.trial_counted,r.charged,r.quota_month,r.created_at FROM ai_test_reservations r JOIN ai_test_accounts a ON a.id=r.account_id ORDER BY r.created_at DESC LIMIT 100",
      )
    ).rows,
  }));
  app.post("/api/admin/ai-test-accounts", admin, async (req) => {
    const v = z
      .object({
        name: z.string().trim().min(1).max(100),
        owner_identity: z.string().trim().min(1).max(254),
        key: z.string().startsWith("fl_").min(8).max(16000),
        ...counts,
        priority: z.number().int().min(0).max(1000).default(100),
        note: z.string().max(1000).default(""),
      })
      .strict()
      .parse(req.body);
    const account = id(),
      version = id(),
      ref = await secrets.write(v.key, `ai-test:${account}:${version}`);
    return db.tx(null, async (c) => {
      await c.query(
        `INSERT INTO ai_test_accounts(id,name,owner_identity,secret_ref,secret_version,credential_hash,trial_used,monthly_used,monthly_limit,trial_limit,quota_month,priority,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          account,
          v.name,
          v.owner_identity.toLowerCase(),
          ref,
          version,
          digest(v.key),
          v.trial_used,
          v.monthly_used,
          v.monthly_limit,
          v.trial_limit,
          utcMonth(),
          v.priority,
          v.note,
        ],
      );
      await c.query(
        "INSERT INTO platform_audit(actor_id,action,target_id,summary) VALUES($1,'ai_test.account.add',$2,$3)",
        [req.identity.id, account, { name: v.name }],
      );
      return { id: account };
    });
  });
  app.post("/api/admin/ai-test-accounts/:id/validate", admin, async (req) => {
    const a = (
      await db.query("SELECT * FROM ai_test_accounts WHERE id=$1", [
        uuid.parse(req.params.id),
      ])
    ).rows[0];
    requireThat(a, "ai_account_missing", 404);
    const result = await sdk({
      action: "audience",
      market: "tiktok_us",
      key: await secrets.read(
        a.secret_ref,
        `ai-test:${a.id}:${a.secret_version}`,
      ),
    });
    requireThat(
      result.market === "tiktok_us" && result.fields,
      "ai_account_invalid",
      409,
    );
    await db.query(
      "UPDATE ai_test_accounts SET verified=true,state='ready',checked_at=now() WHERE id=$1 AND secret_version=$2",
      [a.id, a.secret_version],
    );
    return { ok: true };
  });
  app.patch("/api/admin/ai-test-accounts/:id", admin, (req) =>
    db.tx(null, async (c) => {
      const v = z
        .object({
          name: z.string().trim().min(1).max(100),
          enabled: z.boolean(),
          ...counts,
          priority: z.number().int().min(0).max(1000),
          note: z.string().max(1000),
        })
        .strict()
        .parse(req.body);
      await c.query("SELECT pg_advisory_xact_lock(93419741)");
      const a = (
        await c.query("SELECT * FROM ai_test_accounts WHERE id=$1 FOR UPDATE", [
          uuid.parse(req.params.id),
        ])
      ).rows[0];
      requireThat(a, "ai_account_missing", 404);
      const active = (
        await c.query(
          "SELECT count(*)::int AS n FROM ai_test_reservations WHERE account_id=$1 AND state IN('reserved','started','uncertain')",
          [a.id],
        )
      ).rows[0].n;
      requireThat(!active, "ai_account_busy", 409);
      requireThat(
        !v.enabled || (a.verified && v.trial_used !== null),
        "ai_account_unverified",
        409,
      );
      await c.query(
        "UPDATE ai_test_accounts SET name=$2,enabled=$3,trial_used=$4,monthly_used=$5,monthly_limit=$6,trial_limit=$7,priority=$8,note=$9,quota_month=$10,state=CASE WHEN verified THEN 'ready' ELSE 'pending' END,checked_at=now() WHERE id=$1",
        [
          a.id,
          v.name,
          v.enabled,
          v.trial_used,
          v.monthly_used,
          v.monthly_limit,
          v.trial_limit,
          v.priority,
          v.note,
          utcMonth(),
        ],
      );
      await c.query(
        "INSERT INTO platform_audit(actor_id,action,target_id,summary) VALUES($1,'ai_test.account.update',$2,$3)",
        [req.identity.id, a.id, v],
      );
      return { ok: true };
    }),
  );
  app.post("/api/admin/ai-test-accounts/:id/rotate", admin, async (req) => {
    const v = z
        .object({ key: z.string().startsWith("fl_").min(8).max(16000) })
        .strict()
        .parse(req.body),
      account = uuid.parse(req.params.id),
      version = id(),
      ref = await secrets.write(v.key, `ai-test:${account}:${version}`);
    return db.tx(null, async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(93419741)");
      const old = (
        await c.query(
          "SELECT id FROM ai_test_accounts WHERE id=$1 FOR UPDATE",
          [account],
        )
      ).rows[0];
      requireThat(old, "ai_account_missing", 404);
      requireThat(
        !(
          await c.query(
            "SELECT 1 FROM ai_test_reservations WHERE account_id=$1 AND state IN('reserved','started','uncertain')",
            [account],
          )
        ).rowCount,
        "ai_account_busy",
        409,
      );
      await c.query(
        "UPDATE ai_test_accounts SET secret_ref=$2,secret_version=$3,credential_hash=$4,enabled=false,verified=false,state='pending' WHERE id=$1",
        [account, ref, version, digest(v.key)],
      );
      await c.query(
        "INSERT INTO platform_audit(actor_id,action,target_id,summary) VALUES($1,'ai_test.account.rotate',$2,'{}')",
        [req.identity.id, account],
      );
      return { ok: true };
    });
  });
}
