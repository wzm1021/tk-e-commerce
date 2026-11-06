import { requireThat } from "../common/core.mjs";
export { renderAmazonReport } from "./amazon-report.mjs";
import { reusableResponse } from "../data/data-cache.mjs";
export const AMAZON_DOMAINS = {
  US: "amazon.com",
  GB: "amazon.co.uk",
  DE: "amazon.de",
  FR: "amazon.fr",
  IT: "amazon.it",
  ES: "amazon.es",
  JP: "amazon.co.jp",
  CA: "amazon.ca",
  MX: "amazon.com.mx",
  AU: "amazon.com.au",
  IN: "amazon.in",
};
const token = (s) => s.replaceAll("~", "~0").replaceAll("/", "~1");
const canonicalMarket = (v) => (v === "UK" ? "GB" : v);
const asin = (v) =>
  typeof v === "string" && /^[A-Z0-9]{10}$/.test(v) ? v : null;
const aliases = {
  parent_asin: ["parentAsin", "parent_asin", "parentASIN", "parent"],
  title: ["title", "productName", "name"],
  brand: ["brand", "brandName"],
  image_url: ["zoomImageUrl", "imageUrl"],
  price: ["price", "currentPrice", "buyBoxPrice"],
  currency: ["currency", "currencyCode"],
  estimated_units_30d: [
    "estimatedUnits30d",
    "monthlySales",
    "monthlyUnits",
    "units30d",
  ],
  estimated_revenue_30d: ["estimatedRevenue30d", "monthlyRevenue"],
  bsr: ["bsr", "bsrRank"],
  rating: ["rating", "star", "stars"],
  rating_count: ["ratingCount", "reviewCount", "ratings"],
  seller_count: ["sellerCount", "sellers"],
  sales_growth: ["salesGrowth"],
  rating_count_growth: ["ratingCountGrowth"],
};
const textual = new Set([
  "parent_asin",
  "title",
  "brand",
  "currency",
  "image_url",
]);
const numeric = (v) =>
  (typeof v === "number" || (typeof v === "string" && v.trim() !== "")) &&
  Number.isFinite(Number(v));
export function amazonProductUrl(market, id) {
  requireThat(
    AMAZON_DOMAINS[market] && asin(id),
    "amazon_identity_invalid",
    409,
  );
  return `https://www.${AMAZON_DOMAINS[market]}/dp/${id}`;
}
// Record source pointers before normalization. Unknown aliases stay unknown.
export function amazonFacts(sources, market) {
  const products = new Map();
  for (const [invocation_id, source] of sources) {
    if (
      source.source !== "SellerSprite" ||
      !reusableResponse(source.result, source.source)
    )
      continue;
    // Live product-list responses use units/revenue for the documented monthly
    // estimates. These aliases are scoped to those tools, never generic totals
    // or daily/monthly series rows from other endpoints.
    const sourceAliases = ["product_research", "competitor_lookup"].includes(
      source.tool,
    )
      ? {
          ...aliases,
          estimated_units_30d: [...aliases.estimated_units_30d, "units"],
          estimated_revenue_30d: [...aliases.estimated_revenue_30d, "revenue"],
          sales_growth: [...aliases.sales_growth, "unitsGr"],
        }
      : aliases;
    const roots = (source.decoded || []).map((d, i) => [
      d.data,
      `/decoded/${i}/data`,
    ]);
    if (source.result?.structuredContent)
      roots.push([
        source.result.structuredContent,
        "/result/structuredContent",
      ]);
    const visit = (row, path, depth = 0) => {
      if (!row || typeof row !== "object" || depth > 14) return;
      if (!Array.isArray(row)) {
        if (row.error || row.isError === true || row.success === false) return;
        const scope = canonicalMarket(row.marketplace || row.market);
        if (
          typeof scope === "string" &&
          /^[A-Z]{2}$/.test(scope) &&
          scope !== market
        )
          return;
        const idKey = ["asin", "ASIN", "childAsin"].find((k) => asin(row[k]));
        const rowMarket = canonicalMarket(row.marketplace || row.market);
        if (idKey && (!rowMarket || rowMarket === market)) {
          const id = row[idKey];
          const facts = products.get(id) || {};
          const ref = (k) => ({
            value: row[k],
            invocation_id,
            pointer: `${path}/${token(k)}`,
            captured_at: source.captured_at,
          });
          facts.asin ||= ref(idKey);
          for (const [field, keys] of Object.entries(sourceAliases)) {
            const k = keys.find((k) =>
              textual.has(field)
                ? typeof row[k] === "string" && row[k].trim()
                : numeric(row[k]),
            );
            if (k && !facts[field]) facts[field] = ref(k);
          }
          products.set(id, facts);
        }
      }
      for (const [k, value] of Object.entries(row))
        visit(value, `${path}/${token(k)}`, depth + 1);
    };
    for (const [row, path] of roots) visit(row, path);
  }
  return products;
}
export function amazonCurrency(facts, market, key = "price") {
  const currency = facts.currency;
  if (currency?.invocation_id === facts[key]?.invocation_id && currency)
    return currency.value;
  // User-confirmed US marketplace default, not a fabricated source fact.
  return !currency && market === "US" ? "USD" : null;
}
export function assessAmazonScouting(result, request, sources) {
  const facts = amazonFacts(sources, request.market);
  const parents = new Set(),
    ids = new Set();
  const candidates = [];
  for (const candidate of result.candidates) {
    const found = facts.get(candidate.product_id);
    requireThat(found, "amazon_candidate_identity_unverified", 409);
    if (ids.has(candidate.product_id)) continue;
    ids.add(candidate.product_id);
    const parent = asin(found.parent_asin?.value) || candidate.product_id;
    if (parents.has(parent)) continue;
    parents.add(parent);
    const { strategy_a, strategy_b, ...clean } = candidate;
    candidates.push({
      ...clean,
      platform: "amazon",
      market: request.market,
      parent_asin: parent,
      product_url: amazonProductUrl(request.market, candidate.product_id),
      tk_url: null,
      image: null,
      title: found.title?.value || candidate.title,
      price: found.price ? Number(found.price.value) : null,
      price_currency: amazonCurrency(found, request.market),
      rating: found.rating ? Number(found.rating.value) : null,
      assessment: { mode: "amazon_research", facts: found },
      limitations: [
        ...candidate.limitations,
        "销量、销售额及搜索需求为单一来源估算；缺失费用尚未核验。",
      ],
    });
  }
  const gaps = candidates.filter(
    (c) =>
      !c.research?.growth?.evidence_ids?.length ||
      !c.research?.competition?.evidence_ids?.length ||
      !c.research?.reputation?.evidence_ids?.length,
  );
  return {
    ...result,
    candidates,
    status:
      result.status === "complete" && (gaps.length || !candidates.length)
        ? "partial"
        : result.status,
    limitations: [
      ...result.limitations,
      "按站点和父 ASIN 去重，保留一个实际子 ASIN 作为代表；不累计重复父体销量。样本不代表整个市场，币种和统计窗口缺失时不跨商品加总。",
      ...(gaps.length ? [`${gaps.length} 件候选缺少完整逐品证据分析。`] : []),
    ],
  };
}
export function recoverAmazonDraft(request, sources) {
  const facts = amazonFacts(sources, request.market);
  if (!facts.size) return null;
  return {
    status: "partial",
    summary: "已恢复归档亚马逊候选，分析仍待完成。",
    sections: [],
    questions: [],
    next_actions: [],
    limitations: ["研究中断；仅恢复原始商品身份和事实。"],
    candidates: [...facts]
      .filter(([, f]) => f.title)
      .slice(0, request.candidate_count || 5)
      .map(([id, f]) => ({
        product_id: id,
        title: f.title.value,
        tk_url: null,
        image: null,
        decision: "watch",
        reason: "已取得商品资料，需求、竞争和评价仍待分析。",
        evidence: [],
        limitations: ["待继续核验"],
      })),
  };
}
