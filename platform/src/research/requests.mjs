import { z } from "zod";
import { PLATFORMS } from "../common/platforms.mjs";
const market = z.enum(PLATFORMS.tiktok.markets);
const common = {
  platform: z.literal("tiktok").optional(),
  market: market.default("US"),
  lookback_days: z
    .union([z.literal(7), z.literal(14), z.literal(28)])
    .default(28),
  notes: z.string().max(6000).default(""),
};
const legacyScouting = z
  .object({
    ...common,
    category: z.string().trim().min(2).max(400),
    candidate_count: z.number().int().min(1).max(200).default(5),
    strategies: z
      .array(z.enum(["A", "B"]))
      .min(1)
      .max(2)
      .default(["A", "B"])
      .transform((x) => [...new Set(x)]),
    minimum_orders_7d: z.number().int().nonnegative().default(100),
    orders_operator: z.literal(">").default(">"),
    rising_rule: z
      .literal("complete_14d_recent7_total_and_slope")
      .default("complete_14d_recent7_total_and_slope"),
    market_min_gmv: z.number().finite().nonnegative().default(10000),
    active_sellers_max: z.number().int().positive().default(5),
    minimum_rating: z.number().min(0).max(5).default(4.2),
    minimum_margin: z.number().min(0).max(1).default(0.3),
  })
  .strict();
const scouting = z
  .object({
    ...common,
    category: z.string().trim().min(2).max(400),
    candidate_count: z.number().int().min(1).max(200).default(5),
    selection_rules: z.string().trim().max(6000).default(""),
  })
  .strict();
const legacyKeys = [
  "strategies",
  "minimum_orders_7d",
  "orders_operator",
  "rising_rule",
  "market_min_gmv",
  "active_sellers_max",
  "minimum_rating",
  "minimum_margin",
];
const research = z
  .object({
    ...common,
    target: z.string().trim().min(2).max(3000),
    question: z.string().trim().min(3).max(6000),
  })
  .strict();
const amazonScouting = scouting.extend({
  platform: z.literal("amazon"),
  market: z.enum(PLATFORMS.amazon.markets).default("US"),
  lookback_days: z
    .union([z.literal(30), z.literal(90), z.literal(180), z.literal(365)])
    .default(30),
});
export function normalizeRequest(kind, request) {
  if (kind === "scouting" && request?.platform === "amazon")
    return amazonScouting.parse(request);
  if (kind !== "scouting") return research.parse(request);
  // Old clients can still submit their form; store its preferences as guidance.
  // Historical job JSON is untouched and retains its original assessment mode.
  if (
    request &&
    !Object.hasOwn(request, "selection_rules") &&
    legacyKeys.some((key) => Object.hasOwn(request, key))
  ) {
    const old = legacyScouting.parse(request);
    const rules = [];
    if (old.strategies.includes("A"))
      rules.push(
        `市场机会：关注同类市场 GMV ≥ ${old.market_min_gmv}、同款活跃卖家数 ≤ ${old.active_sellers_max}、商品评分 ≥ ${old.minimum_rating}、预计贡献利润率 ≥ ${Number((old.minimum_margin * 100).toFixed(4))}%。`,
      );
    if (old.strategies.includes("B"))
      rules.push(
        `新竞品机会：关注最近 ${old.lookback_days} 天上架、近 7 天订单 > ${old.minimum_orders_7d}、近 14 天日订单呈上升趋势的商品。`,
      );
    const { market, category, lookback_days, candidate_count, notes } = old;
    return scouting.parse({
      ...(old.platform ? { platform: old.platform } : {}),
      market,
      category,
      lookback_days,
      candidate_count,
      notes,
      selection_rules: rules.join("\n"),
    });
  }
  return scouting.parse(request);
}
export function normalizeTikTokLinks(lines) {
  return lines.map((line, index) => {
    const original = line.trim();
    try {
      const u = new URL(original);
      if (
        u.protocol !== "https:" ||
        !(u.hostname === "tiktok.com" || u.hostname.endsWith(".tiktok.com"))
      )
        return {
          index,
          original,
          status: "invalid",
          reason: "需要 TikTok HTTPS 链接",
        };
      const product =
        u.pathname.match(/\/pdp\/(?:[^/]+\/)?(\d{10,30})(?:\/|$)/)?.[1] || null;
      return {
        index,
        original,
        product_id: product,
        status: product ? "id_parsed" : "needs_resolution",
        reason: product
          ? "已解析链接中的商品 ID，尚未验证商品或货源"
          : "短链接或页面未包含商品 ID，需要补充详情链接",
      };
    } catch {
      return { index, original, status: "invalid", reason: "链接格式无效" };
    }
  });
}
