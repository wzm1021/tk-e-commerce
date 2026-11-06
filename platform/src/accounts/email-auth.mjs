import { CustomerProfile, saveProfile } from "../customers/profile.mjs";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { id, uuid, passwordHash, requireThat } from "../common/core.mjs";
import { normalizeEmail } from "./account-policy.mjs";
const Email = z.string().trim().email().max(254).transform(normalizeEmail);
const Password = z.string().min(12).max(256);
const Proof = z.object({
  email: Email,
  challenge_id: uuid,
  code: z.string().regex(/^\d{6}$/),
});

export function installEmailAuth(app, db, mailer, provisioner, pepper) {
  const codeHash = (cid, email, purpose, code) =>
    createHmac("sha256", pepper)
      .update(`tidelab-email:${cid}:${email}:${purpose}:${code}`)
      .digest("hex");
  // Return failures instead of throwing inside the transaction, so attempt counters commit.
  async function consume(c, v, purpose, user) {
    const row = (
      await c.query(
        "SELECT *,expires_at>clock_timestamp() AS valid FROM email_challenges WHERE id=$1 FOR UPDATE",
        [v.challenge_id],
      )
    ).rows[0];
    if (
      !row ||
      row.email !== v.email ||
      row.purpose !== purpose ||
      row.user_id !== (user || null) ||
      !row.valid ||
      !row.sent_at ||
      row.consumed_at ||
      row.attempts >= 5
    )
      return false;
    const expected = codeHash(row.id, row.email, purpose, v.code);
    const match = timingSafeEqual(
      Buffer.from(row.code_hash, "hex"),
      Buffer.from(expected, "hex"),
    );
    await c.query(
      "UPDATE email_challenges SET attempts=attempts+1,consumed_at=CASE WHEN $2 THEN now() ELSE consumed_at END WHERE id=$1",
      [row.id, match],
    );
    return match;
  }
  app.get("/api/auth/options", async () => ({
    email_registration: await mailer.ready(),
  }));
  async function sendChallenge(req, purpose, user = null) {
    const { email } = z.object({ email: Email }).strict().parse(req.body);
    requireThat(await mailer.ready(), "email_service_unavailable", 503);
    const cid = id(),
      code = String(randomInt(100000, 1000000));
    await db.tx(null, async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        "email:" + email + ":" + purpose,
      ]);
      const rate = (
        await c.query(
          `SELECT count(*) FILTER(WHERE created_at>now()-interval '60 seconds') AS recent,
        count(*) AS total FROM email_challenges WHERE email=$1 AND purpose=$2 AND created_at>now()-interval '1 hour'`,
          [email, purpose],
        )
      ).rows[0];
      requireThat(
        Number(rate.recent) === 0 && Number(rate.total) < 5,
        "email_rate_limited",
        429,
      );
      await c.query(
        "UPDATE email_challenges SET consumed_at=now() WHERE email=$1 AND purpose=$2 AND consumed_at IS NULL",
        [email, purpose],
      );
      await c.query(
        "INSERT INTO email_challenges(id,email,purpose,user_id,code_hash,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes')",
        [cid, email, purpose, user, codeHash(cid, email, purpose, code)],
      );
    });
    const existing = (
      await db.query("SELECT id,enabled FROM users WHERE email=$1", [email])
    ).rows[0];
    const shouldSend = purpose === "reset" ? existing?.enabled : !existing;
    // Use the same response for existing and unknown accounts; never return codes in API responses.
    if (shouldSend) {
      try {
        await mailer.send({ email, code, purpose });
        await db.query(
          "UPDATE email_challenges SET sent_at=now() WHERE id=$1 AND consumed_at IS NULL",
          [cid],
        );
      } catch (e) {
        await db.query(
          "UPDATE email_challenges SET consumed_at=now() WHERE id=$1",
          [cid],
        );
        throw e;
      }
    }
    return {
      challenge_id: cid,
      expires_in: 600,
      message: "如该邮箱符合条件，验证码已发送。",
    };
  }
  const limited = {
    config: { rateLimit: { max: 10, timeWindow: "10 minutes" } },
  };
  app.post("/api/auth/register/code", limited, (req) =>
    sendChallenge(req, "register"),
  );
  app.post("/api/auth/reset/code", limited, (req) =>
    sendChallenge(req, "reset"),
  );
  app.post(
    "/api/account/email/code",
    { ...limited, preHandler: app.account },
    (req) => sendChallenge(req, "bind", req.identity.id),
  );
  app.post("/api/auth/register", limited, async (req) => {
    const v = Proof.extend({
      password: Password,
      display_name: z.string().trim().min(1).max(80).optional(),
      profile: CustomerProfile,
    })
      .strict()
      .parse(req.body);
    const encoded = await passwordHash(v.password),
      bundles = await provisioner.prepare();
    const result = await db.tx(null, async (c) => {
      if (!(await consume(c, v, "register")))
        return { error: "email_code_invalid" };
      const uid = id(),
        workspace = id();
      const inserted = await c.query(
        `INSERT INTO users(id,login,email,email_verified_at,password_hash,display_name)
        VALUES($1,$2,$2,now(),$3,$4) ON CONFLICT DO NOTHING RETURNING id`,
        [uid, v.email, encoded, v.profile.contact_name],
      );
      if (!inserted.rowCount) return { error: "email_already_registered" };
      await c.query("SELECT set_config('app.account_id',$1,true)", [uid]);
      await saveProfile(c, uid, v.profile);
      await provisioner.create(
        c,
        workspace,
        uid,
        v.profile.contact_name + "的空间",
        "personal",
        bundles,
      );
      return { ok: true };
    });
    requireThat(!result.error, result.error, 400);
    return result;
  });
  app.post("/api/auth/reset", limited, async (req) => {
    const v = Proof.extend({ password: Password }).strict().parse(req.body),
      encoded = await passwordHash(v.password);
    const ok = await db.tx(null, async (c) => {
      if (!(await consume(c, v, "reset"))) return false;
      const user = (
        await c.query(
          "UPDATE users SET password_hash=$2 WHERE email=$1 AND enabled RETURNING id",
          [v.email, encoded],
        )
      ).rows[0];
      if (!user) return false;
      await c.query("DELETE FROM sessions WHERE user_id=$1", [user.id]);
      return true;
    });
    requireThat(ok, "email_code_invalid", 400);
    return { ok: true };
  });
  app.put("/api/account/email", { preHandler: app.account }, async (req) => {
    const v = Proof.strict().parse(req.body);
    const result = await db.tx(null, async (c) => {
      if (!(await consume(c, v, "bind", req.identity.id)))
        return "email_code_invalid";
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        "bind-email:" + v.email,
      ]);
      if (
        (await c.query("SELECT 1 FROM users WHERE email=$1", [v.email]))
          .rowCount
      )
        return "email_already_registered";
      await c.query(
        "UPDATE users SET email=$2,email_verified_at=now() WHERE id=$1",
        [req.identity.id, v.email],
      );
      return null;
    });
    requireThat(!result, result, 400);
    return { ok: true };
  });
}
