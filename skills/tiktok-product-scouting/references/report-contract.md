# Output contract

Lead with the decision. Keep raw rows out of the main narrative unless the user asks for an export.

## Required sections

### 1. Scope and assumptions

State region, category/keywords, currency, time window, cutoff date, price or operational constraints, and source availability.

### 2. Ranked shortlist

Use a compact table with these columns:

| Rank | Product | Stage | 7d/28d signal | Entry window | Score | Confidence | Action |
| ---: | --- | --- | --- | --- | ---: | --- | --- |

Use FastMoss-qualified numbers in the signal column. Do not blend incompatible fields or periods.

### 3. Candidate evidence cards

For each recommended candidate, explain:

- demand and lifecycle evidence;
- creator/video and paid/organic structure;
- competition and concentration;
- unit-economics requirement or break-even ceiling;
- operational and review risks;
- FastMoss endpoint/period consistency and any material discrepancy;
- next experiment and stop condition.

### 4. Rejected or deferred candidates

List material candidates that failed a hard gate or evidence threshold. Include the disqualifying reason so the selection is auditable.

### 5. Data-quality notes

Show unresolved identity matches, missing periods, partial-current-period data, currency conversions, FastMoss outages, and discrepancies above tolerance.

### 6. Source inventory

End the report with a human-readable source inventory. Keep raw queries and implementation metadata out of the printable narrative. Each consequential block should also show a compact source line beside the evidence it supports.

### 7. Durable HTML/PDF form

When the user requests HTML or PDF, follow [report-design.md](report-design.md). Use the same evidence model and section order for both formats; the PDF must be exported from the final themed HTML rather than rebuilt independently.

For a 10-product scan, include:

- a visual executive summary;
- product imagery for all 10 candidates;
- the ranked shortlist and candidate evidence;
- second-round validation answers;
- unit-economics or procurement ceilings;
- the minimum test plan and stop conditions;
- a final source inventory.

## Evidence notation

Use concise labels:

```text
FastMoss · day7_gmv · USD · 2026-08-28
Inference · lifecycle=Growth · based on creator/video acceleration + GMV trend
```

## Recommendation language

- **Shortlist:** evidence supports a controlled test now.
- **Watch/test:** promising, but one or more claims need validation.
- **Reject:** hard gate failed or opportunity is not attractive under current constraints.

Avoid “必爆”, “稳赚”, or guaranteed ROI language. Separate market evidence from the user's sourcing and execution capability.
