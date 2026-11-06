import { amazonFacts } from "./amazon-scouting.mjs";
import {
  renderAmazonReport,
  AMAZON_REPORT_VERSION,
  amazonReportSections,
} from "./amazon-report.mjs";
import { archiveReportImages } from "./report-images.mjs";
// Same download limits, HTTPS/SSRF checks and offline archive as TK reports.
export function amazonImageSources(candidates, sources) {
  const result = new Map(),
    byMarket = new Map();
  for (const c of candidates) {
    if (!byMarket.has(c.market))
      byMarket.set(c.market, amazonFacts(sources, c.market));
    const f = byMarket.get(c.market).get(c.product_id)?.image_url;
    if (!f) continue;
    try {
      const url = new URL(f.value);
      if (url.protocol !== "https:" || url.username || url.password) continue;
      result.set(c.product_id, {
        product_id: c.product_id,
        url: url.toString(),
        invocation_id: f.invocation_id,
        pointer: f.pointer,
      });
    } catch {
      /* Unusable source image remains a visible gap. */
    }
  }
  return result;
}
export async function amazonPresentation(result, meta, imageOptions) {
  const images = await archiveReportImages(result.candidates, meta.sources, {
    ...imageOptions,
    selectSources: amazonImageSources,
  });
  return {
    html: renderAmazonReport(result, { ...meta, images: images.images }),
    // The candidate list uses its own JSON artifact, not the report HTML.
    // Share the verified archive; never restore model-supplied image URLs.
    candidates: result.candidates.map((candidate) => ({
      ...candidate,
      image: images.images.get(candidate.product_id) || null,
    })),
    metadata: {
      template_version: AMAZON_REPORT_VERSION,
      sections: amazonReportSections(result).map((s) => s.title),
      image_archive: {
        eligible: images.eligible_count,
        archived: images.archived_count,
        failed: images.failed_product_ids.length,
        bytes: images.bytes_used,
      },
    },
  };
}
