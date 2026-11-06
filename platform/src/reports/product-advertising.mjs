const activityMetrics = [
  "estimated_ad_spend",
  "ad_gmv",
  "ad_units_sold",
  "ad_play_count",
  "ad_video_count",
];

function metric(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^\d+(\.\d+)?$/.test(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Only call after validating the product_investment tool and exact request.
// The provider does not always echo the product ID; the archived request binds it.
export function productAdvertisingEvidence(data, productId, days) {
  const summary = data.ad_performance_summary || {};
  const daily = Array.isArray(data.daily_ad_performance_trend)
    ? data.daily_ad_performance_trend.filter((row) =>
        /^\d{4}-\d{2}-\d{2}$/.test(row?.date || ""),
      )
    : [];
  const evidence = activityMetrics.flatMap((field) => {
    const value = metric(summary[field]);
    if (value > 0) return [{ field, value, source: "summary" }];
    const row = daily.find((row) => metric(row[field]) > 0);
    return row
      ? [{ field, value: metric(row[field]), source: "daily", date: row.date }]
      : [];
  });
  const status = evidence.length
    ? "observed"
    : activityMetrics.every((field) => metric(summary[field]) === 0)
      ? "not_observed"
      : "unknown";
  return { product_id: productId, days, status, evidence };
}
