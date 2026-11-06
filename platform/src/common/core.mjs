import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";
import { promisify } from "node:util";
import Decimal from "decimal.js";
import { z } from "zod";
const scrypt = promisify(scryptCallback);
export const id = () => randomUUID();
export const token = () => randomBytes(32).toString("base64url");
export const hash = (x) => createHash("sha256").update(x).digest("hex");
export function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonical(v[k])]),
    );
  return v;
}
export const digest = (v) => hash(JSON.stringify(canonical(v)));
export class AppError extends Error {
  constructor(code, status = 400, detail = null) {
    super(code);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}
export function requireThat(value, code, status = 400) {
  if (!value) throw new AppError(code, status);
}
export const uuid = z.string().uuid();
export const money = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/)
  .refine((x) => new Decimal(x).lte(1000000), "金额超出范围");
export function micro(s) {
  const n = new Decimal(s).mul(1e6);
  requireThat(
    n.isInteger() && n.gte(0) && n.lte("9000000000000000"),
    "invalid_amount",
  );
  return BigInt(n.toFixed(0));
}
export const cny = (n) => new Decimal(n.toString()).div(1e6).toFixed(6);
export async function passwordHash(password) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${(await scrypt(password, salt, 32, { N: 16384 })).toString("hex")}`;
}
export async function verifyPassword(password, encoded) {
  const [, salt, key] = encoded.split(":");
  if (!salt || !key) return false;
  const out = await scrypt(password, salt, 32, { N: 16384 });
  const b = Buffer.from(key, "hex");
  return b.length === out.length && timingSafeEqual(out, b);
}
export function equalToken(a, b) {
  return timingSafeEqual(
    Buffer.from(hash(a || ""), "hex"),
    Buffer.from(hash(b || ""), "hex"),
  );
}
export const KINDS = {
  scouting: "tiktok-product-scouting",
  competitor: "tiktok-competitor-intelligence",
  monitoring: "tiktok-competitor-monitoring",
  content: "tiktok-content-playbook",
  reviews: "tiktok-review-insights",
  ads: "tiktok-ad-intelligence",
  diagnostics: "tiktok-growth-diagnostics",
  supply: "tiktok-supplier-matching",
  economics: "tiktok-unit-economics",
  assistant: "tiktok-product-assistant",
};
export const SKILL_IDS = [...Object.values(KINDS), "amazon-product-scouting"];
export const JobInput = z
  .object({
    kind: z.enum(Object.keys(KINDS)),
    title: z.string().trim().min(1).max(160),
    request: z.record(z.string(), z.unknown()),
    model_connection_id: uuid.optional(),
    model_budget: money.optional(),
    data_budget: z
      .number()
      .min(0)
      .max(2400)
      .refine((n) => /^\d+(\.\d)?$/.test(String(n)), "积分最多一位小数")
      .optional(),
    idempotency_key: z.string().min(12).max(100),
  })
  .strict();
export const PriceSchema = z
  .object({
    currency: z.enum(["USD", "CNY"]),
    fx: money,
    market: z.object({
      input: money,
      output: money,
      cache_read: money,
      cache_write: money,
    }),
    procurement_discount: z.string().regex(/^\d+(\.\d{1,4})?$/),
    sale_discount: z.string().regex(/^\d+(\.\d{1,4})?$/),
    time_pricing: z
      .object({
        schedule: z.literal("deepseek_business_hours_v1"),
        off_peak_discount: z.string().regex(/^\d+(\.\d{1,4})?$/),
      })
      .strict()
      .optional(),
    max_context_tokens: z.number().int().min(1024).max(1000000),
    max_output_tokens: z.number().int().min(128).max(384000),
    note: z.string().max(1000).default(""),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.currency === "CNY" && !new Decimal(v.fx).eq(1))
      c.addIssue({
        code: "custom",
        message: "CNY requires fx=1",
        path: ["fx"],
      });
    if (
      v.time_pricing &&
      (new Decimal(v.time_pricing.off_peak_discount).lte(0) ||
        new Decimal(v.time_pricing.off_peak_discount).gt(1))
    )
      c.addIssue({
        code: "custom",
        message: "off-peak discount must be in (0,1]",
        path: ["time_pricing", "off_peak_discount"],
      });
    for (const k of ["fx", "procurement_discount", "sale_discount"])
      if (
        new Decimal(v[k]).lte(0) ||
        new Decimal(v[k]).gt(k === "fx" ? 100 : 10)
      )
        c.addIssue({ code: "custom", message: "invalid rate", path: [k] });
  });
// Historical job snapshots still use PriceSchema and their original exchange rate.
// Only newly published price cards must use direct RMB pricing.
export const PublishedPriceSchema = PriceSchema.refine(
  (v) => v.currency === "CNY" && new Decimal(v.fx).eq(1),
  { message: "新价卡仅支持人民币计价，currency=CNY、fx=1", path: ["currency"] },
);
export function pricingPeriod(card, at = new Date()) {
  if (!card.time_pricing) return { period: "fixed", multiplier: "1" };
  requireThat(
    card.time_pricing.schedule === "deepseek_business_hours_v1",
    "unsupported_price_schedule",
  );
  const timestamp = new Date(at).getTime();
  requireThat(Number.isFinite(timestamp), "invalid_pricing_time");
  // Shanghai has UTC+8 throughout this schedule; use UTC accessors, never host timezone.
  const local = new Date(timestamp + 8 * 60 * 60 * 1000);
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  const weekday = local.getUTCDay() >= 1 && local.getUTCDay() <= 5;
  const peak =
    weekday &&
    ((minutes >= 540 && minutes < 720) || (minutes >= 840 && minutes < 1080));
  return {
    period: peak ? "peak" : "off_peak",
    multiplier: peak ? "1" : card.time_pricing.off_peak_discount,
  };
}
export function charges(usage, card, at = new Date()) {
  const raw = usage.input_tokens ?? usage.prompt_tokens;
  const output = usage.output_tokens ?? usage.completion_tokens;
  const cached =
    usage.input_tokens_details?.cached_tokens ??
    usage.prompt_tokens_details?.cached_tokens ??
    0;
  requireThat(
    [raw, output, cached].every((n) => Number.isSafeInteger(n) && n >= 0) &&
      cached <= raw &&
      raw > 0,
    "usage_unavailable",
    502,
  );
  requireThat(
    !(usage.cache_creation_input_tokens || usage.cache_write_input_tokens),
    "unsupported_cache_write_usage",
    502,
  );
  const norm = {
    input_uncached: raw - cached,
    cache_read: cached,
    output_total: output,
  };
  const base = new Decimal(raw - cached)
    .mul(card.market.input)
    .plus(new Decimal(cached).mul(card.market.cache_read))
    .plus(new Decimal(output).mul(card.market.output));
  const tariff = pricingPeriod(card, at);
  const calc = (discount) =>
    BigInt(
      base.mul(card.fx).mul(discount).mul(tariff.multiplier).ceil().toFixed(0),
    );
  return {
    sale: calc(card.sale_discount),
    procurement: calc(card.procurement_discount),
    normalized: norm,
  };
}
export function callBound(card) {
  const maxInput = Decimal.max(
    card.market.input,
    card.market.cache_read,
  ).toString();
  return charges(
    {
      input_tokens: card.max_context_tokens,
      output_tokens: card.max_output_tokens,
    },
    {
      ...card,
      time_pricing: undefined,
      market: { ...card.market, input: maxInput },
    },
  ).sale;
}
// Choose and reserve the largest affordable output atomically under the job lock.
// A configured capacity is not an obligation to reserve its full cost every turn.
export function modelCallBudget(
  card,
  inputTokens,
  available,
  requestedOutput,
  insufficientCode = "task_budget_exhausted",
) {
  requireThat(
    Number.isSafeInteger(inputTokens) &&
      inputTokens > 0 &&
      inputTokens < card.max_context_tokens,
    "model_context_budget_exceeded",
    409,
  );
  if (requestedOutput !== undefined)
    requireThat(
      Number.isSafeInteger(requestedOutput) && requestedOutput > 0,
      "invalid_output_limit",
    );
  const ceiling = Math.min(
    card.max_output_tokens,
    card.max_context_tokens - inputTokens,
    requestedOutput ?? card.max_output_tokens,
  );
  const cost = (output) =>
    callBound({
      ...card,
      max_context_tokens: inputTokens,
      max_output_tokens: output,
    });
  const minimum = Math.min(128, ceiling);
  requireThat(cost(minimum) <= BigInt(available), insufficientCode, 409);
  let low = minimum,
    high = ceiling;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (cost(mid) <= BigInt(available)) low = mid;
    else high = mid - 1;
  }
  return { max_output_tokens: low, reserved: cost(low) };
}
// Provider context limits are measured in tokens, while the gateway receives a
// JSON byte stream. UTF-8 bytes / 3 is deliberately conservative for both
// Chinese text (commonly three bytes per character) and mostly-ASCII JSON.
// The caller supplies additional room for output and tokenizer variance.
export function serializedRequestTokenBound(value, headroom = 8192) {
  requireThat(
    Number.isSafeInteger(headroom) && headroom >= 0,
    "invalid_context_headroom",
  );
  return Math.ceil(Buffer.byteLength(JSON.stringify(value)) / 3) + headroom;
}
export function researchAutoCompactLimit(
  maxContextTokens,
  maxOutputTokens = 0,
) {
  requireThat(
    Number.isSafeInteger(maxContextTokens) && maxContextTokens >= 1024,
    "invalid_context_window",
  );
  // Keep room for the compaction request, output, and tokenizer variance. For
  // a 128K window retains its existing 28K margin. Larger windows reserve
  // 10% rather than remaining capped at 100K (1M compacts at 900K).
  return maxContextTokens > 128000
    ? Math.min(
        Math.floor(maxContextTokens * 0.9),
        Math.max(
          1024,
          maxContextTokens -
            maxOutputTokens -
            Math.max(16000, Math.floor(maxContextTokens * 0.04)),
        ),
      )
    : Math.min(100000, Math.max(1024, maxContextTokens - 16000));
}
export function boundedText(value, max = 2000) {
  return typeof value === "string" ? value.slice(0, max) : "";
}
export function publicPrice(card, at = new Date()) {
  const tariff = pricingPeriod(card, at);
  return {
    currency: "CNY",
    fx: "1",
    rates: Object.fromEntries(
      Object.entries(card.market).map(([k, v]) => [
        k,
        new Decimal(v)
          .mul(card.fx)
          .mul(card.sale_discount)
          .mul(tariff.multiplier)
          .toFixed(6),
      ]),
    ),
    ...(card.time_pricing
      ? {
          time_pricing: {
            ...card.time_pricing,
            current_period: tariff.period,
            timezone: "Asia/Shanghai",
            peak_hours: "周一至周五 09:00–12:00、14:00–18:00",
          },
          peak_rates: Object.fromEntries(
            Object.entries(card.market).map(([k, v]) => [
              k,
              new Decimal(v).mul(card.fx).mul(card.sale_discount).toFixed(6),
            ]),
          ),
        }
      : {}),
    max_context_tokens: card.max_context_tokens,
    max_output_tokens: card.max_output_tokens,
  };
}
