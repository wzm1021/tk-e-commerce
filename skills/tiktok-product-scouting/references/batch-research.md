# Form-driven batch research

Use the user's form as the research scope. Preserve the original request alongside the normalized criteria, market/category resolution, source cutoff, timezone, and explicit assumptions. A target such as 60 overrides the default exploratory pool of 20; it is a target, never a quota to fill with invented or unqualified results.

## Eligibility and depth

- Multiple selected strategies use OR for recall. Within each strategy, all required conditions use AND. Record each strategy's verdict separately: passed, failed, or unverified. Keep qualified and watch candidates distinguishable in the report.
- After the first source-backed product ranking or search, save the requested number of relevant identities as the candidate research pool. Missing downstream evidence changes a candidate to `watch`/unverified; it does not erase the candidate. Exclude only an identity mismatch, an irrelevant market/category, an explicit hard-gate failure, or an unusable/off-shelf product.
- Separate the basic evidence required for every claimed match from optional deep research on the leading candidates. For a request for 60 candidates and 5 deep dives, each candidate claimed to satisfy a rising-order condition needs its own compatible order series. Five enriched candidates cannot substantiate claims about the other 55.
- A strict `7-day orders >100` requires order counts. Units sold are a different metric; use them only when the user explicitly chooses that proxy. Do not change `>` to `>=`.
- Proposed rising-curve rule: complete, aligned daily data for two consecutive 7-day windows; recent total exceeds the previous total and ordinary least-squares slope over the recent 7 days is positive. Declare this rule. A zero previous total permits an absolute increase but no finite percentage growth; label the ratio unavailable. Missing days or uncertain timezone remain unverified.
- Apply the requested new-listing window to the new-competitor strategy. The market-opportunity strategy can include older products unless the user requests new listings for both. State the scope so the report does not silently combine windows.
- “Large market” needs a declared category metric and comparison universe. A percentile among accessible search results is a sample percentile, not the whole market. Same-product active seller counts require identity matching and a known coverage boundary. Creator counts and the number of shops in a truncated search are not whole-market seller counts.
- High-margin potential requires cost assumptions and confidence labels. A reverse-calculated procurement ceiling is a planning constraint, not measured margin. Use the unit-economics skill for a sourced cost case; the user's 6% fee default does not overwrite old reports or establish current platform policy.

## Output and continuation

Return scope, conclusions, per-candidate identities/images/metrics, per-strategy criteria and evidence references, deep dives, the scoring method, cost boundaries, test plans, policy/claim research status, discrepancies, and source inventory. Include actual versus requested counts and exclusion reasons. Score only supported dimensions under the scoring contract; do not fill unknown scores with zero or claim full confidence after rescaling silently.

Keep original imported reports immutable. If a list and a detail card disagree, preserve both values and their field/window provenance until resolved; importing a report does not revalidate its conclusions against new criteria. Save structured candidates beside the report so users can promote selected products to an opportunity pool. Do not promote all candidates automatically.

Bound recall pages, paid calls, and deep dives using the approved task budget. Persist partial results and explain the shortfall when data or budget is insufficient. User-facing progress may show completed work and sources, not invented success percentages.
