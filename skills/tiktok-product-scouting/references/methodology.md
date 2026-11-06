# Selection methodology

Use this methodology after candidate identity and metric alignment. Prefer category-relative evidence over universal volume thresholds.

## Lifecycle inference

Classify only when the evidence supports it:

- **New:** listed within roughly 30 days, low-to-moderate accumulated volume, early creator/video pickup.
- **Growth:** recent GMV/units acceleration with expanding creator or video participation; the entry window may still be open.
- **Breakout:** sharp recent acceleration and strong content propagation; validate concentration and paid-traffic dependence before following.
- **Steady:** high scale but flat growth, mature creator coverage, and heavier competition.
- **Decline:** sustained deceleration in GMV/units with weakening creator/video activity.
- **Unknown:** insufficient or incompatible time-series evidence.

Treat creator count, active selling-video count, and organic content growth as leading indicators. Treat realized GMV/units as lagging indicators. A single viral video is not a durable trend.

## Hard gates

Reject or pause scoring when any critical gate fails:

- prohibited, regulated, counterfeit, trademark, patent, or unsafe product risk;
- landed cost, platform fees, commission, ad cost, returns, and fulfillment make plausible contribution margin non-positive;
- impossible lead time, certification, storage, shipping, or local-warehouse constraint;
- extreme negative-review pattern tied to an inherent product defect;
- unresolved product identity;
- key decision metrics use incompatible currencies, periods, or attribution and cannot be reconciled.

Record the gate and evidence. Do not hide a rejection behind a low total score.

## Default scoring model

Score each dimension 0–100 using category-relative evidence:

| Dimension | Weight | What raises the score |
| --- | ---: | --- |
| `demand_momentum` | 25 | accelerating 7d/28d units and GMV, search/category tailwind |
| `competition_window` | 20 | demand rising faster than seller/content saturation, low concentration risk |
| `content_replicability` | 15 | multiple organic creators/videos, reproducible hooks, not one-hit dependence |
| `unit_economics` | 15 | viable landed margin after fees, commission, ads, returns, and discounts |
| `operational_fit` | 15 | manageable SKU, logistics, compliance, supply, seasonality, and localization |
| `evidence_confidence` | 10 | exact identity, aligned periods, fresh FastMoss data, endpoint consistency |

Default recommendation bands:

- `shortlist`: score ≥75, no hard stop, evidence confidence ≥60;
- `watch/test`: score 60–74, or a promising score with unresolved warnings;
- `reject`: score <60 or any hard stop.

Weights are defaults, not universal truth. Adjust them when the user states a strategy such as low-capital testing, local-warehouse advantage, ad-free growth, or premium margin.

For deterministic scoring, write normalized candidates to a temporary JSON file and run:

```bash
node skills/tiktok-product-scouting/scripts/score_candidates.ts /tmp/tiktok-candidates.json
```

Input shape:

```json
{
  "candidates": [
    {
      "id": "product-id-as-string",
      "title": "Product title",
      "dimensions": {
        "demand_momentum": 0,
        "competition_window": 0,
        "content_replicability": 0,
        "unit_economics": 0,
        "operational_fit": 0,
        "evidence_confidence": 0
      },
      "hard_stops": [],
      "warnings": []
    }
  ]
}
```

Every dimension is 0–100. Optional custom `weights` use the same dimension keys.

## Dimension guidance

### Demand momentum

Compare recent growth with both the product's prior period and category peers. Reward multi-period persistence. Penalize volume produced entirely by a one-day spike.

### Competition window

Consider seller count, creator count, video count, top-seller concentration, price compression, and how quickly copycats are appearing. High demand alone does not imply an open entry window.

### Content replicability

Prefer several independent organic creators or videos with different executions. Penalize dependence on one creator, one live room, one paid ad, or a celebrity effect the user cannot reproduce.

### Unit economics

Use contribution margin, not selling price. If cost inputs are missing, produce a break-even ceiling instead of inventing margin.

### Operational fit

Include SKU complexity, fragility, size/weight, battery/liquid restrictions, return propensity, certification, seasonality, and restock lead time.

### Evidence confidence

Start from freshness, identity quality, period alignment, and consistency across compatible FastMoss endpoints. A >20% discrepancy on a key aligned metric should normally cap this dimension below 60 until explained.

## Minimal experiment

For `shortlist` and `watch/test`, propose the smallest next test that could falsify the thesis: sample order, 3–5 creator seeding test, limited content batch, landing-price test, or supplier compliance check. Define a success metric and a stop condition.
