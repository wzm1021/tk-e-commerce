// Explicit FastMoss product scopes only: shop sales/rating must never become
// product metrics. Preserve raw values and JSON pointers for report verification.
import { productPriceWarning } from "./product-price.mjs";
const priority = {
  product_rank_top_selling: 1,
  product_rank_new_listed: 1,
  product_search: 2,
  product_detail_info: 3,
};
const numeric = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;
const productFields = [
  "product_rating",
  "review_count",
  "launch_time",
  "total_gmv",
  "total_units_sold",
  "commission_rate_percent",
  "sku_count",
  "stock_count",
  "linked_creator_count",
  "linked_video_count",
  "linked_live_count",
  "region",
  "is_free_shipping",
  "is_cross_border",
];
const salesFields = [
  "last_7d_units_sold",
  "last_28d_units_sold",
  "last_90d_units_sold",
  "last_7d_gmv",
  "last_28d_gmv",
  "last_90d_gmv",
  "total_units_sold",
  "total_gmv",
  "yesterday_units_sold",
  "yesterday_gmv",
];
function valid(field, value) {
  if (field.startsWith("is_")) return typeof value === "boolean";
  if (["region", "shop_name", "shop_id", "category_name"].includes(field))
    return typeof value === "string" && value.trim().length > 0;
  if (!numeric(value)) return false;
  if (field === "product_rating") return value <= 5;
  if (field === "commission_rate_percent") return value <= 100;
  if (field === "launch_time")
    return Number.isSafeInteger(value) && value > 0 && value <= 8640000000000;
  return true;
}

export function scoutingProductFacts(candidate, sources, market) {
  const facts = {};
  const ordered = [...sources]
    .filter(([, e]) => e.source === "FastMoss" && priority[e.tool])
    .sort(
      ([aId, a], [bId, b]) =>
        (Date.parse(a.captured_at) || 0) - (Date.parse(b.captured_at) || 0) ||
        priority[a.tool] - priority[b.tool] ||
        aId.localeCompare(bId),
    );
  for (const [invocationId, envelope] of ordered) {
    const detail = envelope.tool === "product_detail_info";
    if (
      detail &&
      String(envelope.request?.filter?.product_id ?? "") !==
        String(candidate.product_id)
    )
      continue;
    for (const [i, decoded] of (envelope.decoded || []).entries()) {
      const rows = detail ? [decoded.data] : decoded.data?.list;
      if (!Array.isArray(rows)) continue;
      for (const [j, row] of rows.entries()) {
        if (!row || typeof row !== "object") continue;
        const nested = row.product && typeof row.product === "object";
        const product = nested ? row.product : row;
        if (detail && !nested) continue;
        const id =
          product.product_id ??
          (detail ? envelope.request.filter.product_id : null);
        if (String(id) !== String(candidate.product_id)) continue;
        const region = product.region || envelope.request?.filter?.region;
        if (
          market &&
          region &&
          String(market).toUpperCase() !== String(region).toUpperCase()
        )
          continue;
        const base = `/decoded/${i}/data${detail ? "" : `/list/${j}`}`;
        const productBase = base + (nested ? "/product" : "");
        const set = (key, value, pointer) => {
          facts[key] = {
            value,
            invocation_id: invocationId,
            pointer,
            captured_at: envelope.captured_at,
          };
        };
        const fields = (obj, keys, path) => {
          for (const key of keys)
            if (obj && Object.hasOwn(obj, key) && valid(key, obj[key]))
              set(key, obj[key], `${path}/${key}`);
        };
        fields(product, productFields, productBase);
        // Replace the price group together, including clearing a stale upper
        // bound or currency; never construct a range from separate snapshots.
        if (numeric(product.floor_price)) {
          for (const key of [
            "floor_price",
            "ceiling_price",
            "currency_code",
            "price_display",
            "unverified_floor_price",
            "unverified_ceiling_price",
          ])
            delete facts[key];
          const unverified = !!productPriceWarning(product, market);
          const priceKey = (key) => (unverified ? `unverified_${key}` : key);
          if (
            typeof product.price_display === "string" &&
            product.price_display.trim()
          )
            set(
              "price_display",
              product.price_display,
              `${productBase}/price_display`,
            );
          set(
            priceKey("floor_price"),
            product.floor_price,
            `${productBase}/floor_price`,
          );
          if (
            numeric(product.ceiling_price) &&
            product.ceiling_price >= product.floor_price
          )
            set(
              priceKey("ceiling_price"),
              product.ceiling_price,
              `${productBase}/ceiling_price`,
            );
          if (
            typeof product.currency_code === "string" &&
            /^[A-Z]{3}$/.test(product.currency_code)
          )
            set(
              "currency_code",
              product.currency_code,
              `${productBase}/currency_code`,
            );
        }
        fields(
          nested ? row.sales_summary : product,
          salesFields,
          nested ? `${base}/sales_summary` : productBase,
        );
        fields(
          row.distribution_summary,
          ["linked_creator_count", "linked_video_count", "linked_live_count"],
          `${base}/distribution_summary`,
        );
        fields(row.shop, ["shop_name", "shop_id"], `${base}/shop`);
        const category = product.category?.l3 || product.category_l3;
        if (valid("category_name", category?.name))
          set(
            "category_name",
            category.name,
            `${productBase}/${product.category?.l3 ? "category/l3" : "category_l3"}/name`,
          );
      }
    }
  }
  return facts;
}
