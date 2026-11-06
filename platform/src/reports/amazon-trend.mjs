import { reusableResponse } from "../data/data-cache.mjs";
const market = (v) => (v === "UK" ? "GB" : v);
// Accept only the documented monthly series alongside its exact ASIN/site.
// Parent and child estimates stay separate; null is not zero.
export function amazonSalesTrend(candidate, sources = new Map()) {
  for (const [invocation_id, source] of sources) {
    if (
      source.source !== "SellerSprite" ||
      source.tool !== "asin_sales_trend" ||
      !reusableResponse(source.result, source.source)
    )
      continue;
    for (const [index, decoded] of (source.decoded || []).entries()) {
      const data = decoded.data?.data;
      if (
        data?.asin?.asin !== candidate.product_id ||
        market(data.asin.marketplace) !== candidate.market ||
        !Array.isArray(data.salesTrendPoints)
      )
        continue;
      const seen = new Set();
      const points = data.salesTrendPoints
        .filter((p) => {
          if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(p?.month) || seen.has(p.month))
            return false;
          seen.add(p.month);
          return true;
        })
        .map((p) => ({
          month: p.month,
          parent: valid(p.parentUnitSales),
          child: valid(p.childUnitSales),
        }))
        .sort((a, b) => a.month.localeCompare(b.month));
      if (!points.some((p) => p.parent !== null || p.child !== null)) continue;
      return {
        points,
        invocation_id,
        captured_at: source.captured_at,
        pointer: `/decoded/${index}/data/data/salesTrendPoints`,
      };
    }
  }
  // The prediction endpoint includes a separate, already archived monthly
  // series. Its variation scope is unspecified, so never label it parent/child.
  for (const [invocation_id, source] of [...sources].sort((a, b) =>
    String(b[1].captured_at).localeCompare(String(a[1].captured_at)),
  )) {
    if (
      source.source !== "SellerSprite" ||
      source.tool !== "asin_prediction" ||
      !reusableResponse(source.result, source.source) ||
      source.request?.asin !== candidate.product_id ||
      market(source.request?.marketplace) !== candidate.market
    )
      continue;
    for (const [index, decoded] of (source.decoded || []).entries()) {
      const data = decoded.data?.data;
      if (
        data?.asinDetail?.asin !== candidate.product_id ||
        (data.asinDetail.marketplace &&
          market(data.asinDetail.marketplace) !== candidate.market) ||
        !Array.isArray(data.monthItemList)
      )
        continue;
      const values = new Map(),
        duplicates = new Set();
      for (const p of data.monthItemList) {
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(p?.date)) continue;
        if (values.has(p.date)) duplicates.add(p.date);
        values.set(p.date, { month: p.date, estimated: valid(p.sales) });
      }
      for (const month of duplicates) values.delete(month);
      const points = [...values.values()].sort((a, b) =>
        a.month.localeCompare(b.month),
      );
      if (!points.some((p) => p.estimated !== null)) continue;
      return {
        scope: "prediction",
        points,
        invocation_id,
        captured_at: source.captured_at,
        pointer: `/decoded/${index}/data/data/monthItemList`,
      };
    }
  }
  return null;
}
function valid(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}
