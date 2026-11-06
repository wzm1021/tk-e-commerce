import { requireThat } from "../common/core.mjs";
// Supplement jobs are tenant-scoped, linked to this report, and independently
// billed. Never rewrite the original research job's frozen snapshot or result.
export async function loadAmazonDailySupplements(c, store, report, sources) {
  const ids = report.data.daily_supplement_job_ids || [];
  if (!ids.length) return;
  requireThat(
    report.data.platform === "amazon" &&
      Array.isArray(ids) &&
      ids.length <= 100,
    "daily_supplements_invalid",
  );
  const rows = (
    await c.query(
      `SELECT i.id,a.object_key,a.sha256 FROM jobs j JOIN invocations i ON i.job_id=j.id JOIN artifacts a ON a.id=i.artifact_id WHERE j.id=ANY($1::uuid[]) AND j.status IN('succeeded','partial') AND j.result->>'supplement_kind'='amazon_daily' AND j.result->>'source_report_id'=$2 AND j.request->>'platform'='amazon' AND j.request->>'market'=$3 AND i.kind='data' AND i.state='succeeded' ORDER BY i.created_at`,
      [ids, report.id, report.data.market],
    )
  ).rows;
  for (const row of rows) {
    const source = JSON.parse(await store.read(row.object_key, row.sha256));
    requireThat(
      source.source === "SellerSprite" && source.tool === "asin_prediction",
      "daily_supplement_source_invalid",
    );
    sources.set(row.id, source);
  }
}
