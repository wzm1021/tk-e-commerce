// Normalized input: {products:[{asin,parent_asin,marketplace,currency,period,
// estimated_units_30d,sales_growth,bsr,rating_count_growth,keyword_growth,
// price_change_30d,seller_count,price,brand}]}. All numeric values must already
// be reconciled against archived source fields. No network or credentials.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const weights = {
  estimated_units_30d: 0.25,
  sales_growth: 0.25,
  bsr: 0.15,
  rating_count_growth: 0.1,
  keyword_growth: 0.1,
  price_change_30d: 0.1,
  seller_count: 0.05,
};
const number = (v) => typeof v === "number" && Number.isFinite(v);
export function analyzeAmazon(products) {
  const groups = new Map();
  for (const row of products) {
    if (!/^[A-Z0-9]{10}$/.test(row.asin || "")) continue;
    const key = JSON.stringify([
      row.marketplace || null,
      row.currency || null,
      row.period || null,
    ]);
    const group = groups.get(key) || new Map();
    const parent = /^[A-Z0-9]{10}$/.test(row.parent_asin || "")
      ? row.parent_asin
      : row.asin;
    if (!group.has(parent)) group.set(parent, row);
    groups.set(key, group);
  }
  return [...groups].map(([key, byParent]) => {
    const rows = [...byParent.values()];
    const cohorts = Object.fromEntries(
      Object.keys(weights).map((k) => [
        k,
        rows
          .map((r) => r[k])
          .filter(number)
          .map((n) => (k === "price_change_30d" ? Math.abs(n) : n)),
      ]),
    );
    const ranked = rows
      .map((row) => {
        let sum = 0,
          weight = 0,
          coverage = 0;
        for (const [k, w] of Object.entries(weights)) {
          if (!number(row[k])) continue;
          const xs = cohorts[k],
            low = Math.min(...xs),
            high = Math.max(...xs);
          let component =
            high === low
              ? 0.5
              : ((k === "price_change_30d" ? Math.abs(row[k]) : row[k]) - low) /
                (high - low);
          if (["bsr", "price_change_30d", "seller_count"].includes(k))
            component = 1 - component;
          sum += component * w;
          weight += w;
          coverage++;
        }
        return {
          asin: row.asin,
          parent_asin: row.parent_asin || row.asin,
          available_components: coverage,
          score:
            coverage >= 2 ? Math.round((sum / weight) * 10000) / 100 : null,
        };
      })
      .sort(
        (a, b) =>
          (b.score ?? -1) - (a.score ?? -1) || a.asin.localeCompare(b.asin),
      );
    const prices = rows
      .map((r) => r.price)
      .filter(number)
      .sort((a, b) => a - b);
    const brands = new Map();
    for (const row of rows)
      if (row.brand) brands.set(row.brand, (brands.get(row.brand) || 0) + 1);
    const known = [...brands.values()].reduce((a, b) => a + b, 0);
    return {
      scope: JSON.parse(key),
      unique_parent_count: rows.length,
      ranked,
      price_range: prices.length ? [prices[0], prices.at(-1)] : null,
      brand_known_count: known,
      brand_top3_sample_share: known
        ? [...brands.values()]
            .sort((a, b) => b - a)
            .slice(0, 3)
            .reduce((a, b) => a + b, 0) / known
        : null,
      note: "样本内相对评分与商品数集中度，非市场份额；不同币种、周期、站点分组，缺失值未补零。",
    };
  });
}
if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  const input = JSON.parse(await readFile(process.argv[2], "utf8"));
  console.log(JSON.stringify(analyzeAmazon(input.products), null, 2));
}
