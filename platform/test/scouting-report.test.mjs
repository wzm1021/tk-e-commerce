import test from "node:test";
import assert from "node:assert/strict";
import { renderReport } from "../src/reports/reports.mjs";
import { scoutingReportSections } from "../src/reports/scouting-report.mjs";

function fixture(count = 1) {
  const invocation = "e4b5b72c-a14a-4cba-a461-f8bdcc159b7c";
  const source = {
    source: "FastMoss",
    tool: "product_detail_info",
    captured_at: "2026-09-01T10:00:00Z",
    served_at: "2026-09-01T10:04:00Z",
    snapshot_id: "snapshot-example",
    cache_hit: true,
    data: { rating: 4.3, price: 19.95, currency: "USD" },
  };
  const ev = (key) => ({
    invocation_id: invocation,
    pointer: `/data/${key}`,
    value: source.data[key],
    metric: key,
    unit: "来源字段",
    period_start: null,
    period_end: null,
    timezone: null,
  });
  const result = {
    status: "partial",
    summary: "待核验的研究结果",
    sections: [],
    candidates: Array.from({ length: count }, (_, i) => ({
      product_id: String(1730000000000000000n + BigInt(i)),
      title: `候选商品 ${i + 1}`,
      tk_url: `https://www.tiktok.com/shop/pdp/${1730000000000000000n + BigInt(i)}`,
      image: null,
      strategy_a: "unverified",
      strategy_b: "unverified",
      decision: "watch",
      reason: "缺少真实日订单与成本。",
      limitations: ["未买样"],
      evidence: [ev("rating"), ev("price"), ev("currency")],
      assessment: {
        facts: {
          product_rating: ev("rating"),
          floor_price: ev("price"),
          currency_code: ev("currency"),
        },
      },
    })),
    questions: [],
    limitations: ["未完成全市场竞争核验"],
    next_actions: [],
  };
  const meta = {
    kind: "scouting",
    title: "研究报告",
    created_at: "2026-09-02T12:00:00Z",
    as_of: "2026-09-01T10:00:00Z",
    skill_version: 2,
    request: {
      category: "家居收纳 / 浴室用品",
      market: "US",
      candidate_count: 60,
      lookback_days: 28,
      strategies: ["A", "B"],
      minimum_rating: 4.2,
      minimum_orders_7d: 100,
      minimum_margin: 0.3,
      active_sellers_max: 5,
      market_min_gmv: 10000,
    },
    sources: new Map([[invocation, source]]),
  };
  return { result, meta, source, ev };
}

test("60 candidates produce a complete editorial report with five catalog pages and stable anchors", () => {
  const { result, meta } = fixture(60);
  const html = renderReport(result, meta);
  assert.equal(scoutingReportSections(result).length, 14);
  assert.equal((html.match(/class="catalog-page"/g) || []).length, 0);
  assert.equal((html.match(/class="section catalog-page"/g) || []).length, 5);
  assert.equal((html.match(/class="catalog-card"/g) || []).length, 60);
  assert.equal((html.match(/class="deep-card"/g) || []).length, 5);
  for (let i = 1; i <= 60; i++) assert.ok(html.includes(`id="candidate-${i}"`));
  for (const section of scoutingReportSections(result)) {
    assert.ok(html.includes(`href="#${section.id}"`));
    assert.ok(html.includes(`id="${section.id}"`));
  }
  assert.ok(html.includes("USD 19.95"));
  assert.ok(html.includes("采集：2026-09-01 10:00:00 UTC"));
  assert.ok(html.includes("快照复用"));
  assert.ok(html.includes("报告生成 2026-09-02 12:00:00 UTC"));
  assert.ok(!html.includes("<script"));
  assert.ok(html.includes("@media print"));
  assert.ok(Buffer.byteLength(html) < 500000);
});

test("short and empty reports disclose gaps without inheriting historical numbers or invented trends", () => {
  for (const count of [0, 1, 13]) {
    const { result, meta } = fixture(count),
      html = renderReport(result, meta);
    assert.equal((html.match(/class="catalog-card"/g) || []).length, count);
    assert.equal(
      (html.match(/class="section catalog-page"/g) || []).length,
      Math.max(1, Math.ceil(count / 12)),
    );
    assert.ok(html.includes(`实际 ${count} / 目标 60 个`));
    assert.ok(!html.includes("<polyline"));
    assert.ok(!html.includes("Clawec"));
    assert.ok(!html.includes("349"));
  }
});

test("source-backed metric values win over loose candidate fields, and mismatched citations remain unknown", () => {
  const { result, meta } = fixture();
  result.candidates[0].rating = 4.99;
  result.candidates[0].price = 8888;
  result.candidates[0].assessment.facts.product_rating.value = 12345;
  result.candidates[0].evidence[0].value = 12345;
  const html = renderReport(result, meta);
  assert.ok(!html.includes("12345"));
  assert.ok(!html.includes("4.99"));
  assert.ok(!html.includes("8888"));
  assert.ok(html.includes("来源评分 / 5</dt><dd>待核验"));
  assert.ok(html.includes("部分引用无法与本次归档来源对应"));
});

test("archived product covers render and sales trend becomes a source-backed daily cumulative chart", () => {
  const { result, meta } = fixture();
  const trendInvocation = "7240c8f7-4c45-4e3e-a67d-cd3365db9fd8";
  meta.sources.set(trendInvocation, {
    source: "FastMoss",
    tool: "product_sales_trend",
    request: { filter: { product_id: result.candidates[0].product_id } },
    captured_at: "2026-09-01T10:01:00Z",
    decoded: [
      {
        data: {
          daily_trend: [
            { date: "2026-08-29", daily_units_sold: 4 },
            { date: "2026-08-30", daily_units_sold: 7 },
            { date: "2026-09-01", daily_units_sold: 3 },
          ],
        },
      },
    ],
  });
  meta.images = new Map([
    [
      result.candidates[0].product_id,
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    ],
  ]);
  const html = renderReport(result, meta);
  assert.equal((html.match(/<img /g) || []).length, 2);
  assert.equal((html.match(/<polyline /g) || []).length, 1);
  assert.equal((html.match(/class="daily-bar"/g) || []).length, 3);
  assert.ok(html.includes("每日销量"));
  assert.ok(html.includes("每日累计销量"));
  assert.ok(html.includes("窗口累计 11 件"));
  assert.ok(html.includes("窗口累计 14 件"));
  assert.ok(html.includes("区间缺 1 个自然日，图中留空且未补零"));
  assert.ok(html.includes(`href="#source-2"`));
  assert.ok(!html.includes("订单趋势 / 待核验"));
});

test("untrusted text, image payloads and links cannot introduce executable HTML or remote resources", () => {
  const { result, meta, source, ev } = fixture();
  const attack = '<script>alert(1)</script><img src=x onerror="alert(2)">';
  result.summary = attack;
  meta.request.category = attack;
  result.candidates[0].title = attack;
  result.candidates[0].tk_url = "https://tiktok.com.evil.example/";
  result.candidates[0].image =
    "data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+";
  result.model_draft = {
    summary: attack,
    sections: [{ title: attack, body: attack, evidence_ids: [] }],
  };
  const html = renderReport(result, meta);
  assert.ok(!html.includes("<script"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<img "));
  assert.ok(!html.includes("tiktok.com.evil"));
  assert.ok(html.includes("Content-Security-Policy"));
  source.data.image =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  result.candidates[0].image = source.data.image;
  assert.ok(
    !renderReport(result, meta).includes("<img "),
    "uncited model images stay hidden",
  );
  result.candidates[0].evidence.push(ev("image"));
  const withImage = renderReport(result, meta);
  assert.equal((withImage.match(/<img /g) || []).length, 2);
  assert.ok(withImage.includes('loading="lazy"'));
  assert.ok(!withImage.includes("<img src=x"));
});
