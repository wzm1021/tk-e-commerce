import { archiveReportImages } from "./report-images.mjs";
import {
  renderScoutingReport,
  scoutingSalesTrend,
  SCOUTING_REPORT_VERSION,
} from "./scouting-report.mjs";

// New jobs and historical revisions share this path. Presentation is owned by
// the server, independent of which tenant skill/model produced the draft.
export async function scoutingPresentation(result, meta, imageOptions) {
  const images = await archiveReportImages(
    result.candidates,
    meta.sources,
    imageOptions,
  );
  const fields = [
    "floor_price",
    "currency_code",
    "product_rating",
    "launch_time",
    "last_7d_units_sold",
    "last_28d_units_sold",
    "total_units_sold",
  ];
  const coverage = Object.fromEntries(fields.map((key) => [key, 0]));
  const missing = [];
  let trends = 0;
  for (const candidate of result.candidates) {
    const facts = candidate.assessment?.facts || {};
    const gaps = fields.filter((key) => !facts[key]);
    for (const key of fields) if (facts[key]) coverage[key]++;
    if (!images.images.has(candidate.product_id)) gaps.push("image");
    if (scoutingSalesTrend(candidate, meta.sources)) trends++;
    else gaps.push("daily_sales_series");
    if (gaps.length)
      missing.push({ product_id: candidate.product_id, fields: gaps });
  }
  const quality = {
    version: 1,
    candidate_count: result.candidates.length,
    image_count: images.archived_count,
    daily_sales_series_count: trends,
    analysis_coverage: {
      reputation: result.candidates.filter(c => c.research?.reputation?.evidence_ids?.length).length,
      growth: result.candidates.filter(
        (c) => c.research?.growth?.evidence_ids?.length,
      ).length,
      competition: result.candidates.filter(
        (c) => c.research?.competition?.evidence_ids?.length,
      ).length,
      test_plan: result.candidates.filter(
        (c) => c.research?.test_plan?.evidence_ids?.length,
      ).length,
      policy_pages: [...meta.sources.values()].filter(
        (s) => s.tool === "policy_fetch" && s.status === "fetched",
      ).length,
    },
    field_coverage: coverage,
    missing,
  };
  return {
    html: renderScoutingReport(result, {
      ...meta,
      images: images.images,
      quality,
    }),
    metadata: {
      template_version: SCOUTING_REPORT_VERSION,
      report_quality: quality,
      image_archive: {
        eligible: images.eligible_count,
        archived: images.archived_count,
        failed: images.failed_product_ids.length,
        bytes: images.bytes_used,
      },
    },
  };
}
