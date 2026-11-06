---
name: tiktok-product-scouting
description: Discover, validate, rank, or compare TikTok Shop product opportunities using FastMoss data with explicit metric alignment and evidence-quality checks. Use for TikTok Shop 选品、蓝海机会、新品/爆品扫描、跟卖窗口、候选商品尽调或选品报告；do not use for generic social content ideation without a product-selection decision.
---

# TikTok Shop Product Scouting

Produce a decision-ready shortlist, not a raw ranking dump. Make every recommendation traceable to market, time window, source, and metric definition.

## Scope the decision

Establish or explicitly assume:

- target region;
- category or keyword boundary;
- price band, sourcing constraints, and risk tolerance when relevant;
- whether the user wants discovery, validation of named products, or a durable report.

For a quick exploratory scan with no region, default to `US` and state the assumption. Ask a concise question only when a missing constraint would materially reverse the recommendation.

## Route the work

- For live data retrieval and exact tool selection, read [references/data-sources.md](references/data-sources.md).
- For lifecycle classification, scoring, gates, and confidence rules, read [references/methodology.md](references/methodology.md).
- For a shortlist, comparison table, or report, read [references/report-contract.md](references/report-contract.md).
- For form-driven batch research with multiple strategies or a requested candidate count, also read [references/batch-research.md](references/batch-research.md).
- For a Tidelab platform task (`task.json` and `result.schema.json`), read [references/platform-reports.md](references/platform-reports.md) before collecting data; the platform generates the HTML from the structured result and archived evidence.
- For a polished HTML/PDF report, also read [references/report-design.md](references/report-design.md) and apply the bundled editorial theme.
- When candidates already have normalized dimension scores, run `scripts/score_candidates.ts` instead of recalculating weighted totals manually.

## Platform user rules

For platform tasks containing `request.selection_rules` (including an empty string), those user preferences guide research and replace default A/B strategies and scoring gates in this skill and its references. Do not enforce each preference as a pass/fail gate. Preserve source accuracy, explain tradeoffs and unknowns, and give a product-specific recommendation. Missing preference evidence does not automatically reject a candidate. An empty rule means general opportunity analysis within the requested scope; do not insert default thresholds. See [references/platform-reports.md](references/platform-reports.md).

## Workflow

1. **Build the candidate pool.** Use category ranking plus top-selling/new-listed/product search as appropriate. Cap the initial pool at 20 unless the user requests a broader export. Persist source-backed product identities from that pool immediately. The candidate list is a research queue: keep relevant products as `watch` when order, seller-count, margin, or trend evidence is missing, and mark those gates unverified instead of returning an empty list.
2. **Resolve identities.** Keep TikTok IDs as strings. Prefer exact `product_id`; otherwise match by normalized title + seller and label match confidence.
3. **Normalize before comparing.** Align region, currency, time window, cutoff date, GMV versus units, organic versus paid, and category level. Never average incompatible metrics.
4. **Verify eligibility before optional deep research.** Check every included candidate against the conditions asserted for it, including individual trends when rising orders are required. Missing evidence means unverified, not passed. For platform jobs, collect the per-candidate growth, video, competition and review evidence required by platform-reports.md; limit only additional creator, ad and SKU deep dives to at most 5 finalists unless the user requests more. Do not call every endpoint indiscriminately.
5. **Validate key claims inside FastMoss.** Triangulate identity, GMV/units trend, creator/video momentum, and ad reliance across compatible FastMoss ranking, search, detail, trend, overview, creator, video, and investment endpoints. Preserve conflicting field values and their periods instead of blending them.
6. **Classify stage and entry window.** Treat creator/video growth as leading evidence and GMV/units as lagging evidence. Use category-relative percentiles when available.
7. **Apply hard gates, then score.** Regulatory, IP, margin, fulfillment, and critical data-quality failures override a high numeric score.
8. **Recommend an action.** Use `shortlist`, `watch/test`, or `reject`, with a reason and next validation step.
9. **Package durable outputs when requested.** Build the HTML report first, apply `scripts/apply_editorial_report_theme.mjs`, then export the PDF from that exact HTML. Render every PDF page for visual inspection before delivery.

## Data discipline

- Cite each consequential number with source and period, for example `FastMoss · 7d GMV · as of 2026-08-28`.
- Distinguish observed fields from inference. Label lifecycle stage and entry-window judgments as inference.
- FastMoss is the only live product-data acquisition source for this skill. Do not call or fall back to Clawec.
- If compatible FastMoss endpoints or periods disagree beyond tolerance, report the disagreement; do not silently choose one.
- If FastMoss is unavailable, stop live acquisition, disclose the limitation, and request refreshed FastMoss access or user-provided data. Historical cached data may be used only when clearly labeled with its capture date.
- Stop after one corrected retry for an invalid paid query. Fix parameters from the live Schema before retrying; do not probe repeatedly.
- Do not promise sales outcomes. Treat the result as an evidence-backed experiment priority.

## Local implementation

The repository exposes the FastMoss client from `src/index.ts`:

```ts
const fastmoss = createFastMossClientFromEnv();
```

Do not instantiate `createTikTokDataClientFromEnv()` or call Clawec endpoints in workflows governed by this skill. FastMoss exact inputs are generated in `src/fastmoss/generated-inputs.ts`. Use `npm run fastmoss:sync-tools` when its live Schema may have changed. Keep all keys in the ignored `.env`; never place them in skill files, reports, or code examples.
