import { requireThat } from "../common/core.mjs";
import { PLATFORMS } from "../common/platforms.mjs";

const markets = new Set(PLATFORMS.tiktok.markets);

// Only use facts saved by the report's evidence checks. Never interpret a
// product URL/ID or a rounded JavaScript number as a shop identifier.
export function candidateMonitorTarget(candidate, reportMarket) {
  const facts = candidate?.assessment?.facts || {};
  const seller = facts.shop_id;
  if (
    typeof seller?.value !== "string" ||
    !/^\d{1,40}$/.test(seller.value) ||
    !seller.invocation_id ||
    !/^\/decoded\/\d+\/data\/(?:list\/\d+\/)?shop\/shop_id$/.test(
      seller.pointer || "",
    )
  )
    return null;
  const region = facts.region?.value;
  if (region && reportMarket && region !== reportMarket) return null;
  const market = region || reportMarket;
  if (!markets.has(market)) return null;
  // A name from another snapshot may belong to a previous shop for this product.
  const name =
    facts.shop_name?.invocation_id === seller.invocation_id &&
    typeof facts.shop_name.value === "string" &&
    facts.shop_name.value.trim()
      ? facts.shop_name.value.trim()
      : `竞店 ${seller.value}`;
  return { seller_id: seller.value, market, name: name.slice(0, 100) };
}

export async function reportMonitorCandidates(c, store, reportId) {
  const report = (
    await c.query(
      `SELECT r.*,j.kind AS job_kind,j.request->>'market' AS market
     FROM records r LEFT JOIN jobs j ON j.id::text=r.data->>'job_id'
     WHERE r.id=$1 AND r.kind='report'`,
      [reportId],
    )
  ).rows[0];
  requireThat(report, "report_not_found", 404);
  const artifact = (
    await c.query("SELECT * FROM artifacts WHERE id=$1", [
      report.data.candidates_artifact_id,
    ])
  ).rows[0];
  requireThat(artifact, "report_candidates_missing", 409);
  const candidates = JSON.parse(
    (await store.read(artifact.object_key, artifact.sha256)).toString(),
  );
  return candidates.map((candidate) => ({
    ...candidate,
    monitor_target:
      report.job_kind === "scouting" && report.data.platform !== "amazon"
        ? candidateMonitorTarget(candidate, report.market)
        : null,
  }));
}
