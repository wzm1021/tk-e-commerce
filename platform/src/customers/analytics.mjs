import { z } from "zod";
import { uuid, requireThat } from "../common/core.mjs";
import { accountTx } from "./profile.mjs";
import { effectiveArm } from "../ai-testing/contract.mjs";

export function analyticsPeriod(query = {}) {
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const days = z.coerce
    .number()
    .int()
    .min(1)
    .max(366)
    .default(30)
    .parse(query.days);
  const date = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(
      (s) =>
        !Number.isNaN(Date.parse(s)) &&
        new Date(s).toISOString().slice(0, 10) === s,
    );
  const end = date.parse(query.end || today),
    start = date.parse(
      query.start ||
        new Date(Date.parse(end) - (days - 1) * 86400000)
          .toISOString()
          .slice(0, 10),
    );
  requireThat(
    start <= end && Date.parse(end) - Date.parse(start) < 366 * 86400000,
    "analytics_period_invalid",
  );
  return {
    start,
    end,
    from: `${start}T00:00:00+08:00`,
    until: new Date(
      Date.parse(`${end}T00:00:00+08:00`) + 86400000,
    ).toISOString(),
    timezone: "Asia/Shanghai",
  };
}
export function safeProductLink(value) {
  try {
    const u = new URL(value);
    return ["https:", "http:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
}
function safeImage(value) {
  return typeof value === "string" &&
    (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value) ||
      value.startsWith("https://"))
    ? value
    : null;
}
export function runProducts(run) {
  const d = run.snapshot?.data;
  if (!d?.arms) return [];
  return d.arms.map((raw, index) => {
    const arm = effectiveArm(d, raw),
      url = safeProductLink(arm.url);
    const same = index > 0 && !raw.other_product;
    const base = same ? effectiveArm(d, d.arms[0]) : arm;
    const key = base.product_id
      ? `${d.platform}:${d.market}:${base.product_id}`
      : safeProductLink(base.url)?.replace(/#.*$/, "") ||
        `${run.id}:${same ? "A" : raw.id}`;
    return {
      key,
      arm: raw.id,
      other_product: !!raw.other_product,
      title: arm.product?.name || "未保存商品名称",
      url,
      image:
        run.snapshot.images?.find((i) => i.arm === raw.id)?.artifact_id || null,
    };
  });
}
function emptyStats() {
  return {
    active_days: 0,
    sessions: 0,
    last_active: null,
    input_tokens: 0,
    output_tokens: 0,
    cached_tokens: 0,
    total_tokens: 0,
    unknown_token_calls: 0,
    data_calls: 0,
    real_data_calls: 0,
    cache_hits: 0,
    pending_calls: 0,
    scouting_tasks: 0,
    candidate_entries: 0,
    ai_started: 0,
    ai_completed: 0,
    ai_unique_products: 0,
  };
}
const numeric = [
  "input_tokens",
  "output_tokens",
  "cached_tokens",
  "unknown_token_calls",
  "data_calls",
  "real_data_calls",
  "cache_hits",
  "pending_calls",
  "scouting_tasks",
  "candidate_entries",
];
async function statsFor(db, ids, period) {
  const stats = Object.fromEntries(ids.map((id) => [id, emptyStats()])),
    products = new Map(ids.map((id) => [id, new Set()]));
  if (!ids.length) return stats;
  const activity = await accountTx(
    db,
    null,
    async (c) =>
      (
        await c.query(
          `SELECT user_id,count(*)::int active_days,sum(sessions)::int sessions,max(last_at) last_active FROM customer_activity WHERE user_id=ANY($1::uuid[]) AND day BETWEEN $2::date AND $3::date GROUP BY user_id`,
          [ids, period.start, period.end],
        )
      ).rows,
    true,
  );
  for (const a of activity) Object.assign(stats[a.user_id], a);
  // Explicitly scope every tenant read; former memberships must not hide a user's historical activity.
  const workspaces = (await db.query("SELECT id FROM workspaces")).rows;
  for (const w of workspaces) {
    const values = [ids, period.from, period.until];
    const result = await db.tenant(w.id, async (c) => {
      const calls = (
        await c.query(
          `SELECT j.created_by,
    COALESCE(sum((i.usage#>>'{normalized,input_uncached}')::bigint+(i.usage#>>'{normalized,cache_read}')::bigint) FILTER(WHERE i.kind='model' AND i.state='succeeded'),0)::text input_tokens,
    COALESCE(sum((i.usage#>>'{normalized,output_total}')::bigint) FILTER(WHERE i.kind='model' AND i.state='succeeded'),0)::text output_tokens,
    COALESCE(sum((i.usage#>>'{normalized,cache_read}')::bigint) FILTER(WHERE i.kind='model' AND i.state='succeeded'),0)::text cached_tokens,
    count(*) FILTER(WHERE i.kind='model' AND i.state<>'rejected' AND (i.state<>'succeeded' OR i.usage#>>'{normalized,input_uncached}' IS NULL OR i.usage#>>'{normalized,cache_read}' IS NULL OR i.usage#>>'{normalized,output_total}' IS NULL))::int unknown_token_calls,
    count(*) FILTER(WHERE i.kind='data' AND i.state='succeeded' AND COALESCE(i.usage->>'outcome','success') NOT IN('failed','rate_limited'))::int data_calls,
    count(*) FILTER(WHERE i.kind='data' AND i.state='succeeded' AND COALESCE(i.usage->>'outcome','success') NOT IN('failed','rate_limited') AND COALESCE(i.usage->>'cache_hit','false')<>'true')::int real_data_calls,
    count(*) FILTER(WHERE i.kind='data' AND i.state='succeeded' AND COALESCE(i.usage->>'outcome','success') NOT IN('failed','rate_limited') AND i.usage->>'cache_hit'='true')::int cache_hits,
    count(*) FILTER(WHERE i.state IN('started','reconciling'))::int pending_calls
    FROM invocations i JOIN jobs j ON j.id=i.job_id WHERE j.created_by=ANY($1::uuid[]) AND i.created_at >= $2 AND i.created_at < $3 GROUP BY j.created_by`,
          values,
        )
      ).rows;
      const suggestions = (
        await c.query(
          `SELECT created_by,
        COALESCE(sum((usage#>>'{normalized,input_uncached}')::bigint+(usage#>>'{normalized,cache_read}')::bigint),0)::text input_tokens,
        COALESCE(sum((usage#>>'{normalized,output_total}')::bigint),0)::text output_tokens,
        COALESCE(sum((usage#>>'{normalized,cache_read}')::bigint),0)::text cached_tokens
        FROM ai_test_suggestions WHERE created_by=ANY($1::uuid[]) AND created_at >= $2 AND created_at < $3 GROUP BY created_by`,
          values,
        )
      ).rows;
      const jobs = (
        await c.query(
          "SELECT created_by,count(*)::int scouting_tasks FROM jobs WHERE created_by=ANY($1::uuid[]) AND kind='scouting' AND created_at >= $2 AND created_at < $3 GROUP BY created_by",
          values,
        )
      ).rows;
      const reports = (
        await c.query(
          "SELECT created_by,COALESCE(sum(CASE WHEN data->>'candidate_count' ~ '^[0-9]+$' THEN (data->>'candidate_count')::int ELSE 0 END),0)::int candidate_entries FROM records WHERE created_by=ANY($1::uuid[]) AND kind='report' AND data ? 'candidates_artifact_id' AND created_at >= $2 AND created_at < $3 GROUP BY created_by",
          values,
        )
      ).rows;
      const runs = (
        await c.query(
          "SELECT id,created_by,status,snapshot FROM ai_test_runs r WHERE created_by=ANY($1::uuid[]) AND created_at >= $2 AND created_at < $3 AND EXISTS(SELECT 1 FROM ai_test_reservations x WHERE x.run_id=r.id AND x.trial_counted)",
          values,
        )
      ).rows;
      return { calls: [...calls, ...suggestions], jobs, reports, runs };
    });
    for (const row of [...result.calls, ...result.jobs, ...result.reports])
      for (const key of numeric)
        if (row[key] != null) stats[row.created_by][key] += Number(row[key]);
    for (const r of result.runs) {
      stats[r.created_by].ai_started++;
      if (r.status === "completed") stats[r.created_by].ai_completed++;
      for (const p of runProducts(r)) products.get(r.created_by).add(p.key);
    }
  }
  for (const uid of ids) {
    const s = stats[uid];
    s.total_tokens = s.input_tokens + s.output_tokens;
    s.ai_unique_products = products.get(uid).size;
    delete s.user_id;
  }
  return stats;
}
export function installCustomerAnalytics(app, db, store) {
  const admin = { preHandler: app.admin };
  app.get("/api/admin/customers", admin, async (req) => {
    const period = analyticsPeriod(req.query),
      q = z
        .object({
          page: z.coerce.number().int().min(1).max(10000).default(1),
          search: z.string().trim().max(200).default(""),
        })
        .parse(req.query);
    const users = await accountTx(
      db,
      null,
      async (c) =>
        (
          await c.query(
            `SELECT u.id,u.email,u.display_name,u.enabled,u.created_at,p.data profile FROM users u LEFT JOIN customer_profiles p ON p.user_id=u.id WHERE u.email IS NOT NULL AND NOT u.is_admin AND ($1='' OR u.email ILIKE '%'||$1||'%' OR p.data->>'company_name' ILIKE '%'||$1||'%') ORDER BY u.created_at DESC,u.id DESC LIMIT 21 OFFSET $2`,
            [q.search, (q.page - 1) * 20],
          )
        ).rows,
      true,
    );
    const items = users.slice(0, 20),
      stats = await statsFor(
        db,
        items.map((u) => u.id),
        period,
      );
    return {
      items: items.map((u) => ({ ...u, usage: stats[u.id] })),
      has_more: users.length > 20,
      page: q.page,
      period,
    };
  });
  app.get("/api/admin/customers/:id", admin, async (req) => {
    const uid = uuid.parse(req.params.id),
      period = analyticsPeriod(req.query);
    const user = await accountTx(
      db,
      null,
      async (c) =>
        (
          await c.query(
            "SELECT u.id,u.email,u.display_name,u.enabled,u.created_at,p.data profile FROM users u LEFT JOIN customer_profiles p ON p.user_id=u.id WHERE u.id=$1",
            [uid],
          )
        ).rows[0],
      true,
    );
    requireThat(user, "customer_not_found", 404);
    return { ...user, usage: (await statsFor(db, [uid], period))[uid], period };
  });
  // Page by report/run, then return only its lightweight products. No supplier envelope, chat or full report crosses this API.
  app.get("/api/admin/customers/:id/products", admin, async (req) => {
    const uid = uuid.parse(req.params.id),
      period = analyticsPeriod(req.query);
    const q = z
      .object({
        kind: z.enum(["scouting", "ai"]).default("scouting"),
        page: z.coerce.number().int().min(1).max(10000).default(1),
      })
      .parse(req.query);
    const workspaces = (await db.query("SELECT id FROM workspaces")).rows;
    let rows = [];
    for (const w of workspaces)
      rows.push(
        ...(await db.tenant(
          w.id,
          async (c) =>
            (
              await c.query(
                q.kind === "ai"
                  ? `SELECT id,workspace_id,created_at,status,snapshot FROM ai_test_runs r WHERE created_by=$1 AND created_at >= $2 AND created_at < $3 AND EXISTS(SELECT 1 FROM ai_test_reservations x WHERE x.run_id=r.id AND x.trial_counted) ORDER BY created_at DESC,id DESC LIMIT $4`
                  : `SELECT id,workspace_id,created_at,data FROM records WHERE created_by=$1 AND kind='report' AND data ? 'candidates_artifact_id' AND created_at >= $2 AND created_at < $3 ORDER BY created_at DESC,id DESC LIMIT $4`,
                [uid, period.from, period.until, q.page * 10 + 1],
              )
            ).rows,
        )),
      );
    rows.sort(
      (a, b) =>
        new Date(b.created_at) - new Date(a.created_at) ||
        b.id.localeCompare(a.id),
    );
    const has_more = rows.length > q.page * 10;
    const groups = [];
    for (const r of rows.slice((q.page - 1) * 10, q.page * 10)) {
      if (q.kind === "ai")
        groups.push({
          id: r.id,
          created_at: r.created_at,
          status: r.status,
          kind: "ai",
          products: runProducts(r).map(({ key, image, ...p }) => ({
            ...p,
            image: image
              ? `/api/admin/customers/${uid}/test-image/${r.workspace_id}/${r.id}/${p.arm}`
              : null,
          })),
        });
      else
        groups.push(
          await db.tenant(r.workspace_id, async (c) => {
            const a = uuid.safeParse(r.data.candidates_artifact_id).success
              ? (
                  await c.query("SELECT * FROM artifacts WHERE id=$1", [
                    r.data.candidates_artifact_id,
                  ])
                ).rows[0]
              : null;
            let candidates;
            try {
              candidates = a
                ? JSON.parse(
                    (await store.read(a.object_key, a.sha256)).toString(),
                  )
                : null;
            } catch {
              candidates = null;
            }
            const selected = new Set(
              (
                await c.query(
                  "SELECT data->>'product_id' product_id FROM records WHERE kind='opportunity' AND created_by=$1 AND data->>'report_id'=$2",
                  [uid, r.id],
                )
              ).rows.map((v) => v.product_id),
            );
            return {
              id: r.id,
              created_at: r.created_at,
              kind: "scouting",
              title: r.data.title || "选品报告",
              missing: !Array.isArray(candidates),
              products: Array.isArray(candidates)
                ? candidates.map((p) => ({
                    title: String(
                      p.title || p.name || p.product_id || "未保存商品名称",
                    ).slice(0, 200),
                    url: safeProductLink(p.product_url || p.tk_url),
                    image: safeImage(p.image),
                    selected: selected.has(p.product_id),
                  }))
                : [],
            };
          }),
        );
    }
    return { groups, page: q.page, has_more, period };
  });
  app.get(
    "/api/admin/customers/:id/test-image/:workspace/:run/:arm",
    admin,
    async (req, reply) => {
      const uid = uuid.parse(req.params.id),
        wid = uuid.parse(req.params.workspace),
        rid = uuid.parse(req.params.run),
        arm = z.enum(["A", "B", "C", "D"]).parse(req.params.arm);
      const bytes = await db.tenant(wid, async (c) => {
        const r = (
          await c.query(
            "SELECT snapshot FROM ai_test_runs WHERE id=$1 AND created_by=$2",
            [rid, uid],
          )
        ).rows[0];
        requireThat(r, "ai_run_not_found", 404);
        const aid = r.snapshot.images?.find((i) => i.arm === arm)?.artifact_id;
        requireThat(aid, "ai_image_missing", 404);
        const a = (
          await c.query(
            "SELECT * FROM artifacts WHERE id=$1 AND mime IN('image/png','image/jpeg','image/webp')",
            [aid],
          )
        ).rows[0];
        requireThat(a, "ai_image_missing", 404);
        return {
          mime: a.mime,
          bytes: await store.read(a.object_key, a.sha256),
        };
      });
      return reply
        .type(bytes.mime)
        .header("X-Content-Type-Options", "nosniff")
        .send(bytes.bytes);
    },
  );
}
