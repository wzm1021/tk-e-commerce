import { z } from "zod";
export const COMPANY_SIZES = [
  "1–5人",
  "6–20人",
  "21–50人",
  "51–200人",
  "201–500人",
  "500人以上",
];
const text = (max) => z.string().trim().min(1).max(max);
export const CustomerProfile = z
  .object({
    company_name: text(200),
    address: text(600),
    tax_id: z.string().trim().max(100).default(""),
    contact_name: text(80),
    phone: text(40).regex(
      /^\+[1-9][0-9 ()-]{5,30}$/,
      "请填写国家区号及电话号码",
    ),
    company_size: z.enum(COMPANY_SIZES),
    annual_revenue: z
      .string()
      .trim()
      .regex(/^(0|[1-9]\d{0,14})(\.\d{1,2})?$/, "请填写不小于0的金额"),
    revenue_currency: z.enum([
      "CNY",
      "USD",
      "EUR",
      "GBP",
      "JPY",
      "HKD",
      "SGD",
      "AUD",
      "CAD",
    ]),
    revenue_year: z.number().int().min(2000).max(new Date().getUTCFullYear()),
  })
  .strict();
// Only trusted route/worker code sets the admin flag. Never accept scope from a request body.
export function accountTx(db, userId, fn, admin = false) {
  return db.tx(null, async (c) => {
    await c.query(
      "SELECT set_config('app.account_id',$1,true),set_config('app.customer_admin',$2,true)",
      [userId || "", String(admin)],
    );
    return fn(c);
  });
}
export async function saveProfile(c, userId, value) {
  const data = CustomerProfile.parse(value);
  await c.query(
    "INSERT INTO customer_profiles(user_id,data) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET data=$2,updated_at=now()",
    [userId, data],
  );
  return data;
}
export function installCustomerProfile(app, db) {
  app.get("/api/account/profile", { preHandler: app.account }, (req) =>
    accountTx(db, req.identity.id, async (c) => ({
      email: req.identity.email,
      profile:
        (
          await c.query(
            "SELECT data,updated_at FROM customer_profiles WHERE user_id=$1",
            [req.identity.id],
          )
        ).rows[0] || null,
    })),
  );
  app.put("/api/account/profile", { preHandler: app.account }, (req) =>
    accountTx(db, req.identity.id, async (c) => ({
      profile: await saveProfile(c, req.identity.id, req.body),
    })),
  );
}
