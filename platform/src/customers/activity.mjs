import { z } from "zod";
import { accountTx } from "./profile.mjs";
export const ACTIVITY_PAGES = [
  "scouting",
  "opportunities",
  "ai-testing",
  "assistant",
  "research",
  "monitoring",
  "supply",
  "economics",
  "experiments",
  "wallet",
  "team",
  "settings",
  "feedback",
];
export async function recordActivity(db, userId) {
  return accountTx(db, userId, async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      "customer-activity:" + userId,
    ]);
    const previous = (
      await c.query(
        "SELECT last_at FROM customer_activity_clock WHERE user_id=$1",
        [userId],
      )
    ).rows[0];
    const now = (
      await c.query(
        "SELECT now() AS at,(now() AT TIME ZONE 'Asia/Shanghai')::date::text AS day",
      )
    ).rows[0];
    const elapsed = previous
      ? new Date(now.at) - new Date(previous.last_at)
      : Infinity;
    // Multiple tabs and a burst of pointer/keyboard actions are one interaction; idle polling never calls this.
    if (elapsed < 60000) return { ok: true };
    const sessions = elapsed >= 30 * 60000 ? 1 : 0;
    await c.query(
      "INSERT INTO customer_activity_clock(user_id,last_at) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET last_at=$2",
      [userId, now.at],
    );
    await c.query(
      "INSERT INTO customer_activity(user_id,day,sessions,interactions,first_at,last_at) VALUES($1,$2,$3,1,$4,$4) ON CONFLICT(user_id,day) DO UPDATE SET sessions=customer_activity.sessions+EXCLUDED.sessions,interactions=customer_activity.interactions+1,last_at=EXCLUDED.last_at",
      [userId, now.day, sessions, now.at],
    );
    return { ok: true };
  });
}
export function installCustomerActivity(app, db) {
  app.post(
    "/api/account/activity",
    {
      preHandler: app.account,
      config: {
        rateLimit: {
          hook: "preHandler",
          keyGenerator: (req) => req.identity.id,
          max: 30,
          timeWindow: "1 minute",
        },
      },
    },
    (req) => {
      z.object({ page: z.enum(ACTIVITY_PAGES) })
        .strict()
        .parse(req.body);
      return recordActivity(db, req.identity.id);
    },
  );
}
