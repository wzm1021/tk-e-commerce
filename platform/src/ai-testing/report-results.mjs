import { requireThat } from "../common/core.mjs";
export function publicResults(value, armIds) {
  requireThat(
    value?.is_simulation === true &&
      String(value.schema_version) === "1" &&
      value.arms &&
      Array.isArray(value.comparisons),
    "ai_result_invalid",
    502,
  );
  for (const arm of armIds) {
    const v = value.arms[arm]?.buy_rate;
    requireThat(
      v &&
        Number.isFinite(v.value) &&
        v.value >= 0 &&
        v.value <= 1 &&
        Array.isArray(v.ci95) &&
        v.ci95.length === 2 &&
        v.ci95.every((n) => Number.isFinite(n) && n >= 0 && n <= 1),
      "ai_result_invalid",
      502,
    );
  }
  return {
    is_simulation: true,
    schema_version: "1",
    sample: value.sample,
    arms: Object.fromEntries(armIds.map((id) => [id, value.arms[id]])),
    comparisons: value.comparisons,
    segments: value.segments || [],
    data_gaps: value.data_gaps || [],
    scope_warnings: value.scope_warnings || [],
    decision: value.decision || null,
    narrative: value.narrative || null,
    recommendations: value.recommendations || {},
    personas: Array.isArray(value.personas) ? value.personas : [],
    segment_insights: value.segment_insights || {},
    definitions: value.definitions || {},
    disclaimer: value.disclaimer || null,
  };
}
