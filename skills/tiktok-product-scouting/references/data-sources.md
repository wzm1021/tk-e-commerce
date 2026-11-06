# Data-source routing

Use the smallest set of FastMoss calls that can answer the decision. FastMoss methods usually place identifiers and `region` inside `filter`.

## Tool map

| Decision need | FastMoss |
| --- | --- |
| Candidate keyword search | `products.search` |
| Top-selling candidates | `products.rankTopSelling` |
| New-listed candidates | `products.rankNewListed` |
| Product basics | `products.detailInfo` |
| GMV/units trend | `products.salesTrend` |
| Channel/content mix | `products.overview` |
| Selling creators | `products.creatorAnalysis` |
| Selling videos | `products.videoList` |
| Paid traffic / ROAS | `products.investment` |
| SKU health | `products.sku` |
| Buyer feedback | `products.reviewList` |
| Shop context | `shops.baseInfo`, `shops.saleAnalysis` |
| Category ranking | `market.categoryRanking` |
| Category size/trend/price | `market.categoryAnalysis` |
| Creator-tier contribution | `market.categoryAuthorSalesMatrix` |

FastMoss also exposes agency/MCN, ad creative, video script, and knowledge tools. Use them only when the selection thesis depends on those dimensions.

## Query order

1. Resolve category terms with FastMoss `auxiliary.searchCategoryByWords` when the category ID is unknown.
2. Pull the relevant FastMoss category, top-selling, new-listed, and product-search views.
3. Union the FastMoss candidate lists, then deduplicate by product identity.
4. Enrich only the top candidates that survive the first-pass gates.

Default budgets:

- initial pool: up to 20 unique products;
- first-pass shortlist: up to 10;
- full enrichment: up to 5;
- final recommendation: usually 3–5.

Tell the user before intentionally exceeding these defaults because FastMoss business queries consume credits.

## Identity matching

Match in this order:

1. exact `product_id`;
2. exact TikTok detail URL ID;
3. normalized title + exact seller ID;
4. normalized title + normalized seller name + close price.

Label match confidence as `exact`, `high`, `medium`, or `unresolved`. Never cross-validate two records with an unresolved identity.

## Metric alignment

Create a normalized observation with:

```ts
{
  source,
  entityType,
  entityId,
  metric,
  value,
  unit,
  period,
  asOf
}
```

Before comparing:

- convert currencies only with an explicit rate and date;
- keep GMV and revenue labels as returned rather than assuming equivalence;
- align completed periods, not a completed period against a partial current period;
- separate total/cumulative fields from 7d/28d fields;
- separate attributed ad GMV from total product GMV;
- record whether returns/cancellations are included when the source discloses it.

For overlapping FastMoss fields, compare only aligned metrics and periods. Default interpretation is ≤5% consistent, >5% warning, >20% mismatch. Category-dependent volatility can justify different thresholds, but state them.

## Failure handling

- Auth or quota failure: stop live acquisition, disclose the FastMoss failure, and do not fall back to Clawec.
- Empty result: verify region/category/ID once, then broaden one filter at a time.
- Schema rejection: inspect `src/fastmoss/generated-inputs.ts` or resync; retry once.
- FastMoss field disagreement: preserve both values and investigate cutoff time, period type, currency, attribution, returns, or identity before choosing a decision field.
