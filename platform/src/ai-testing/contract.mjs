import { z } from "zod";
import { AppError, digest, requireThat } from "../common/core.mjs";
import { requiredTestFields } from "../../web/lib/ai-test-required.mjs";
import { validationFields } from "../../web/lib/validation-errors.mjs";
import { productTestUrl } from "./product-url.mjs";
import {
  AI_TEST_PERSONA_MIN,
  AI_TEST_PERSONA_MAX,
  AI_TEST_PERSONA_DEFAULT,
  AI_TEST_PERSONA_ERROR,
  AI_TEST_PRODUCT_URL_MAX,
  AI_TEST_PRODUCT_URL_ERROR,
} from "../../web/lib/ai-test-limits.mjs";

export const MARKETS = [
  "tiktok_us",
  "tiktok_uk",
  "tiktok_jp",
  "amazon_us",
  "amazon_uk",
  "amazon_jp",
];
export const PRODUCT_FIELDS = [
  "name",
  "variant",
  "use",
  "material",
  "dimensions",
  "inner_dimensions",
];
export const PRICING_FIELDS = ["current_price", "shipping", "delivery"];
const text = z.string().trim().max(300).default("");
const product = z
  .object(Object.fromEntries(PRODUCT_FIELDS.map((k) => [k, text])))
  .extend({
    key_features: z
      .array(z.string().trim().min(1).max(200))
      .max(10)
      .default([]),
    limitations: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
  })
  .strict();
const pricing = z
  .object({
    current_price: z.number().positive().nullable().default(null),
    shipping: text,
    delivery: text,
  })
  .strict();
const categorical = [
  "age",
  "gender",
  "income",
  "education",
  "industry",
  "home_ownership",
  "pet_ownership",
  "parental_status",
  "relationship_status",
  "urbanicity",
  "cohort",
];
const ranges = [
  "income_min",
  "average_purchase_price",
  "median_purchase_price",
  "max_purchase_price",
  "average_monthly_spending",
  "avg_purchases_per_month",
  "total_purchases",
];
const range = z
  .object({
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
  })
  .strict()
  .refine((v) => v.min === undefined || v.max === undefined || v.min <= v.max);
export const AudienceFilters = z
  .object(
    Object.fromEntries([
      ...categorical.map((k) => [
        k,
        z.array(z.string().min(1).max(100)).max(50).optional(),
      ]),
      ...ranges.map((k) => [k, range.optional()]),
    ]),
  )
  .strict();
export const DraftInput = z
  .object({
    name: z.string().trim().max(200),
    market: z.string().max(40),
    currency: z.string().max(3),
    material_language: z.string().max(20),
    shopper_intent: z.enum(["browsing", "in_market"]),
    entry_point: z.enum([
      "feed_content",
      "search",
      "comparison",
      "product_page",
    ]),
    shopper_problem: text,
    usage_context: text,
    audience_description: z.string().max(500),
    audience_filters: AudienceFilters,
    question: z.string().trim().max(300),
    follow_ups: z.array(z.string().trim().min(1).max(300)).max(3),
    persona_count: z
      .number()
      .int(AI_TEST_PERSONA_ERROR)
      .min(AI_TEST_PERSONA_MIN, AI_TEST_PERSONA_ERROR)
      .max(AI_TEST_PERSONA_MAX, AI_TEST_PERSONA_ERROR),
    sessions_per_arm: z.number().int().min(3).max(5),
    arms: z
      .array(
        z
          .object({
            id: z.string().regex(/^[A-F]$/),
            label: z.string().trim().min(1).max(120),
            other_product: z.boolean(),
            url: z
              .string()
              .max(AI_TEST_PRODUCT_URL_MAX, AI_TEST_PRODUCT_URL_ERROR),
            product_id: z.string().max(100),
            product,
            pricing,
            inherit: z
              .array(
                z.enum([
                  ...PRODUCT_FIELDS,
                  "key_features",
                  "limitations",
                  ...PRICING_FIELDS.map((k) => "pricing." + k),
                ]),
              )
              .max(11),
            image_id: z.string().uuid().nullable(),
            change_summary: z.string().max(300),
          })
          .strict(),
      )
      .min(2)
      .max(6),
  })
  .strict()
  .superRefine((v, ctx) => {
    v.arms.forEach((a, i) => {
      if (a.id !== String.fromCharCode(65 + i))
        ctx.addIssue({
          code: "custom",
          path: ["arms", i, "id"],
          message: "方案须按 A、B、C 顺序排列",
        });
    });
    if (v.arms[0].inherit.length || v.arms[0].other_product)
      ctx.addIssue({
        code: "custom",
        path: ["arms", 0],
        message: "对照方案不能继承其他方案",
      });
  });
export function emptyArm(id = "A") {
  return {
    id,
    label: id === "A" ? "原页面" : "对比方案",
    other_product: false,
    url: "",
    product_id: "",
    product: product.parse({}),
    pricing: pricing.parse({}),
    inherit:
      id === "A"
        ? []
        : [
            ...PRODUCT_FIELDS,
            "key_features",
            "limitations",
            ...PRICING_FIELDS.map((k) => "pricing." + k),
          ],
    image_id: null,
    change_summary: "",
  };
}
export function emptyDraft() {
  return {
    name: "新的 AI 测品",
    market: "tiktok_us",
    currency: "USD",
    material_language: "en-US",
    shopper_intent: "browsing",
    entry_point: "product_page",
    shopper_problem: "",
    usage_context: "",
    audience_description: "",
    audience_filters: {},
    question: "看到该页面及价格，你是否愿意购买？",
    follow_ups: [],
    persona_count: AI_TEST_PERSONA_DEFAULT,
    sessions_per_arm: 5,
    arms: [emptyArm("A"), emptyArm("B")],
  };
}
export function effectiveArm(draft, arm) {
  const out = structuredClone(arm),
    control = draft.arms[0];
  if (arm.id !== "A" && !arm.other_product) {
    out.url = arm.url || control.url;
    out.product_id = control.product_id;
  }
  for (const key of arm.inherit) {
    if (key.startsWith("pricing."))
      out.pricing[key.slice(8)] = control.pricing[key.slice(8)];
    else out.product[key] = structuredClone(control.product[key]);
  }
  return out;
}
export function creditsFor(v) {
  return v.persona_count * v.arms.length * Math.ceil(v.sessions_per_arm / 5);
}
export function marketDetails(market) {
  const suffix = market.split("_").at(-1);
  return {
    currency: { us: "USD", uk: "GBP", jp: "JPY" }[suffix],
    language: { us: "en-US", uk: "en-GB", jp: "ja-JP" }[suffix],
  };
}
export function captureIdentity(draft, arm) {
  return digest({
    url: arm.url,
    product_id: arm.product_id,
    variant: arm.product.variant,
    price: arm.pricing.current_price,
    currency: draft.currency,
    market: draft.market,
    language: draft.material_language,
  });
}
export function testSpec(input, externalRef = {}) {
  const d = DraftInput.parse(input),
    arms = d.arms.map((a) => effectiveArm(d, a));
  const missing = requiredTestFields(d);
  if (missing.length) {
    const code = missing.every((x) => x.path === "shopper_problem")
      ? "ai_problem_required"
      : missing.some((x) => x.path.endsWith(".url"))
        ? "ai_product_link_required"
        : "ai_required_fields";
    throw new AppError(code, 400, {
      fields: validationFields(missing, "ai-testing"),
    });
  }
  for (const arm of arms)
    requireThat(
      z.string().url().safeParse(arm.url).success &&
        /^https:\/\//.test(arm.url) &&
        !new URL(arm.url).username &&
        !new URL(arm.url).password,
      "ai_product_link_required",
    );
  requireThat(MARKETS.includes(d.market), "ai_market_unsupported");
  requireThat(
    d.currency === marketDetails(d.market).currency,
    "ai_currency_mismatch",
  );
  requireThat(d.name && d.question, "ai_required_fields");
  for (const a of arms) {
    requireThat(
      a.product.name && a.pricing.current_price > 0,
      "ai_product_required",
    );
    requireThat(a.product.use || d.shopper_problem, "ai_use_required");
    requireThat(a.image_id, "ai_image_required");
  }
  const clean = (o) =>
    Object.fromEntries(
      Object.entries(o).filter(([, v]) =>
        Array.isArray(v) ? v.length : v !== "" && v !== null,
      ),
    );
  // Only mandatory identity/price are shared. Optional attributes live on each arm so B can remain unknown.
  const spec = {
    name: d.name,
    market: d.market,
    currency: d.currency,
    material_language: d.material_language,
    product: {
      name: arms[0].product.name,
      url: productTestUrl(arms[0].url, d.market, arms[0].product_id),
      ...(arms[0].product_id
        ? {
            [d.market.startsWith("amazon") ? "asin" : "platform_product_id"]:
              arms[0].product_id,
          }
        : {}),
    },
    pricing: { current_price: arms[0].pricing.current_price },
    scenario: clean({
      shopper_intent: d.shopper_intent,
      entry_point: d.entry_point,
      shopper_problem: d.shopper_problem,
      usage_context: d.usage_context,
    }),
    audience: clean({
      description: d.audience_description,
      filters: d.audience_filters,
    }),
    question: { primary: d.question, follow_ups: d.follow_ups },
    arms: arms.map((a) =>
      clean({
        id: a.id,
        label: a.label,
        change_summary: a.change_summary,
        product: clean(a.product),
        pricing: clean(a.pricing),
      }),
    ),
    persona_count: d.persona_count,
    sessions_per_arm: d.sessions_per_arm,
    external_ref: externalRef,
  };
  // The service requires a shared use/problem even when per-arm use is supplied.
  if (arms.every((a) => a.product.use && a.product.use === arms[0].product.use))
    spec.product.use = arms[0].product.use;
  else
    requireThat(Boolean(spec.scenario.shopper_problem), "ai_problem_required");
  return spec;
}
export function confirmationDigest(draft, images) {
  return digest({
    version: draft.version,
    data: draft.data,
    images: images.map((i) => ({
      id: i.id,
      sha256: i.sha256,
      request: i.request,
      metadata: i.metadata,
    })),
  });
}
export function importedArm(candidate, market, id = "A") {
  const a = emptyArm(id),
    f = candidate.assessment?.facts || {},
    value = (k) => f[k]?.value;
  a.inherit = [];
  a.other_product = id !== "A";
  a.url = candidate.product_url || candidate.tk_url || "";
  a.product_id = candidate.product_id || "";
  a.product.name = String(candidate.title || "").slice(0, 300);
  a.pricing.current_price =
    Number(candidate.price) > 0 ? Number(candidate.price) : null;
  if (value("is_free_shipping") === true) a.pricing.shipping = "Free shipping";
  return a;
}
export function candidateDraft(candidate, market, platform) {
  const d = emptyDraft();
  d.arms[0] = importedArm(candidate, market);
  d.name = ("AI 测品 · " + candidate.title).slice(0, 200);
  d.market = `${platform}_${{ US: "us", GB: "uk", UK: "uk", JP: "jp" }[market] || market.toLowerCase()}`;
  const m = marketDetails(d.market);
  d.currency = candidate.price_currency || m.currency || "";
  d.material_language = m.language || "";
  return d;
}
export const terminal = (s) => ["completed", "failed", "cancelled"].includes(s);
