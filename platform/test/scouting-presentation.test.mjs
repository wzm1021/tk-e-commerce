import test from "node:test";
import assert from "node:assert/strict";
import {
  ensureScoutingCandidates,
  applyScoutingPolicy,
} from "../src/reports/scouting-policy.mjs";
import { scoutingPresentation } from "../src/reports/scouting-presentation.mjs";
import { SCOUTING_REPORT_VERSION } from "../src/reports/scouting-report.mjs";
import { archiveReportImages } from "../src/reports/report-images.mjs";

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
function fixture(count) {
  const request = {
    market: "US",
    category: "storage",
    candidate_count: count,
    lookback_days: 28,
    minimum_rating: 4.2,
    minimum_orders_7d: 100,
    strategies: ["A", "B"],
  };
  const rows = Array.from({ length: count }, (_, i) => ({
    product: {
      product_id: String(1730000000000000000n + BigInt(i)),
      title: `Storage ${i + 1}`,
      region: "US",
      floor_price: 10 + i,
      ceiling_price: 20 + i,
      currency_code: "USD",
      product_rating: 4.5,
      launch_time: 1788220800,
      cover_url: `https://cdn.example/${i}.png`,
    },
    sales_summary: {
      last_7d_units_sold: 140,
      last_28d_units_sold: 560,
      total_units_sold: 900,
    },
    shop: { shop_name: "Fixture Shop" },
  }));
  const sources = new Map([
    [
      "pool",
      {
        source: "FastMoss",
        tool: "product_search",
        captured_at: "2026-09-12T01:00:00Z",
        decoded: [{ data: { list: rows } }],
      },
    ],
  ]);
  for (const [i, row] of rows.entries())
    sources.set(`trend-${i}`, {
      source: "FastMoss",
      tool: "product_sales_trend",
      request: {
        filter: { product_id: row.product.product_id, time_range_days: 14 },
      },
      captured_at: "2026-09-12T01:01:00Z",
      decoded: [
        {
          data: {
            product_id: row.product.product_id,
            daily_trend: [
              { date: "2026-09-09", daily_units_sold: 10 },
              { date: "2026-09-10", daily_units_sold: 20 },
              { date: "2026-09-11", daily_units_sold: 30 },
            ],
          },
        },
      ],
    });
  const raw = {
    status: "partial",
    summary: "Model omitted candidates and metrics",
    sections: [],
    candidates: [],
    questions: [],
    next_actions: [],
    limitations: [],
  };
  const prepare = () =>
    applyScoutingPolicy(
      ensureScoutingCandidates(raw, request, sources),
      request,
      sources,
      "2026-09-12T00:00:00Z",
    );
  return { sources, request, prepare };
}

test("new 1/20/60-product reports retain images, facts and both trends for every candidate without model HTML", async () => {
  for (const count of [1, 20, 60]) {
    const { sources, request, prepare } = fixture(count);
    const result = prepare();
    const output = await scoutingPresentation(
      result,
      { sources, request },
      { fetchOne: async () => ({ data_url: png, byte_length: 68 }) },
    );
    assert.equal(output.metadata.template_version, SCOUTING_REPORT_VERSION);
    assert.equal(output.metadata.report_quality.image_count, count);
    assert.equal(
      output.metadata.report_quality.daily_sales_series_count,
      count,
    );
    assert.equal(
      output.metadata.report_quality.field_coverage.product_rating,
      count,
    );
    assert.deepEqual(output.metadata.report_quality.missing, []);
    assert.equal(
      (output.html.match(/class="catalog-card"/g) || []).length,
      count,
    );
    assert.equal(
      (output.html.match(/<img /g) || []).length,
      count + Math.min(count, 5),
    );
    assert.equal((output.html.match(/<polyline /g) || []).length, count);
    assert.equal(
      (output.html.match(/class="daily-bar"/g) || []).length,
      count * 3,
    );
    assert.ok(output.html.includes(`USD ${9 + count} – ${19 + count}`));
    assert.ok(output.html.includes(`售价 ${count}/${count}`));
    assert.ok(Buffer.byteLength(output.html) < 12 * 1024 * 1024);
  }
});

test("missing upstream fields, image failures and wrong-product trends produce explicit per-product gaps", async () => {
  const { sources, request, prepare } = fixture(2);
  const product = sources.get("pool").decoded[0].data.list[1].product;
  delete product.product_rating;
  sources.get("trend-1").decoded[0].data.product_id = "unrelated";
  const output = await scoutingPresentation(
    prepare(),
    { sources, request },
    {
      fetchOne: async () => {
        throw new Error("unavailable");
      },
    },
  );
  assert.equal(output.metadata.report_quality.image_count, 0);
  assert.equal(output.metadata.report_quality.daily_sales_series_count, 1);
  assert.deepEqual(output.metadata.report_quality.missing[1].fields, [
    "product_rating",
    "image",
    "daily_sales_series",
  ]);
  assert.ok(output.html.includes("评分 1/2；日销量序列 1/2"));
  assert.ok(output.html.includes("本次归档来源中没有该商品的逐日销量序列"));
});

test("covers skipped when the image budget is exhausted are all counted as missing", async () => {
  const { sources, prepare } = fixture(20);
  const output = await archiveReportImages(prepare().candidates, sources, {
    maxBytes: 1,
    fetchOne: async () => ({ data_url: png, byte_length: 1 }),
  });
  assert.equal(output.archived_count, 1);
  assert.equal(output.failed_product_ids.length, 19);
  assert.equal(new Set(output.failed_product_ids).size, 19);
});
