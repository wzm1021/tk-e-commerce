# HTML and PDF report design

Read this reference only when the user asks for a polished HTML report, a PDF, or both.

## Deliverable contract

- Build one self-contained HTML report as the canonical artifact.
- Export the PDF from that exact final HTML so the two formats cannot drift.
- Keep product images embedded as data URLs when portability matters.
- Provide a separate CSV when the user asks for row-level product data; do not turn the main report into a raw data dump.

## Visual direction

Use a warm editorial research-report style rather than a generic dashboard:

- paper background `#f2ede2`;
- white-warm surfaces `#fffdf8`;
- forest ink `#20392d` and primary green `#244a38`;
- rust accent `#a65d40`;
- fine rules `#cfc7b9`;
- serif display headings with a restrained sans-serif body;
- maximum reading width around 1120 px;
- square corners, thin rules, and whitespace instead of heavy shadows or card grids.

Use the bundled [editorial-report-theme.css](../assets/editorial-report-theme.css). For portable Data Analytics HTML, run:

```bash
node scripts/apply_editorial_report_theme.mjs <input.html> [output.html]
```

The helper intentionally shows the semantic portable reader because it preserves embedded product images and source affordances reliably.

## Information hierarchy

1. Title, market, category, period, and cutoff date.
2. Executive conclusion in one sentence.
3. Visual action summary: priority candidate, conditional candidate, watch candidate, and the key reason for each.
4. Three to five decision metrics, not vanity metrics.
5. Scope, rules, and metric definitions.
6. Ranked shortlist and product image boards.
7. FastMoss evidence validation and second-round answers.
8. Unit economics, procurement ceilings, and assumptions.
9. Watchlist and minimum test plan.
10. Limitations and source inventory.

Recommended artifact block IDs are `executive-summary`, `phase2-answer`, and `test-plan`; the bundled theme gives these blocks distinct visual treatment.

## Product imagery

- Retrieve the product cover from the product-detail endpoint for each candidate.
- A cover returned by the candidate search or ranking endpoint may be used when
  the same `product_id` has no detail cover. Never fetch a model-proposed URL
  that is absent from the archived FastMoss response.
- Preserve `product_id`, source URL, capture time, and image URL in the normalized data.
- Use consistent crops and labels; do not stretch packaging.
- For 10 products, prefer two image boards of five products each plus a smaller executive hero.
- Every image needs useful alt text. A caption should state whether imagery came from FastMoss or TikTok Shop.
- If an image cannot be retrieved, show a neutral placeholder with the product name and disclose the missing asset.

## Sales trend charts

- When `product_sales_trend.daily_trend` contains valid `date` and
  `daily_units_sold` values, show both a daily-sales chart and a daily
  cumulative-sales chart from that same series.
- Position observations by their actual date. Leave missing dates blank and do
  not fill them with zero.
- Calculate cumulative sales from the first valid day in the displayed
  observation window. Label it as window cumulative sales; it is not the
  product's lifetime sales.
- Sales are not orders. These charts may support product observation but cannot
  pass the strategy-B order gates or replace the required daily order series.
- Keep an expandable table with the source daily value and derived cumulative
  value. If no usable daily series exists, show a missing-data explanation and
  never draw a decorative curve.

## Source presentation

Every analytical block must carry a compact source label such as:

```text
Source: FastMoss · product detail and 28d sales trend · as of 2026-08-28
```

Keep these layers distinct:

- **Observed:** source field, metric, unit, period, cutoff date.
- **Derived:** calculation formula and source fields.
- **Inference:** lifecycle, entry window, or action judgment.
- **Planning assumption:** refund reserve, target margin, sourcing cost, or fulfillment quote.

For official fees or fulfillment rules, link the relevant TikTok Shop document. Never present an unquoted sourcing or fulfillment cost as observed fact.

## HTML requirements

- Responsive at desktop and mobile widths.
- Self-contained when practical; embed critical images and styles.
- Product names and official documentation links remain clickable.
- Tables may scroll on small screens but must remain readable.
- The source inventory is visible in the HTML.
- Avoid UI controls, publishing chrome, raw SQL, manifest paths, or validation metadata in the reader-facing report.

## PDF requirements

- Use the final HTML as the print source.
- Preserve selectable/searchable text.
- Hide raw source queries while retaining human-readable source summaries.
- Force wide tables to `table-layout: fixed`; allow cell wrapping and constrain every content block to the printable width.
- Use two columns only for compact source inventories or short test-plan steps.
- Avoid breaking product cards, metric cards, or single source entries across pages.

## Visual QA

Render every PDF page to PNG at 110–144 dpi and inspect all pages. Pay special attention to wide tables and the transition between price-band, watchlist, and test-plan sections.

Do not deliver until all of these hold:

- no left/right clipping;
- no overlapping text or images;
- all 10 product images and names are present, or missing assets are disclosed;
- tables fit the page and retain readable headers;
- source lines remain adjacent to the claims they support;
- links and body text remain selectable;
- HTML and PDF conclusions, numbers, and source dates agree.
