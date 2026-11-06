import test from "node:test";
import assert from "node:assert/strict";
import { amazonSalesTrend } from "../src/reports/amazon-trend.mjs";
import {
  amazonPresentation,
  amazonImageSources,
} from "../src/reports/amazon-presentation.mjs";
import { renderAmazonReport } from "../src/reports/amazon-report.mjs";
const c = {
  product_id: "B012345678",
  market: "US",
  title: "Test",
  decision: "watch",
  reason: "需验证",
  limitations: [],
  assessment: { facts: { price: { value: 999999 } } },
};
const series = {
  source: "SellerSprite",
  tool: "asin_sales_trend",
  captured_at: "2026-09-20T00:00:00Z",
  result: { content: [{ type: "text", text: '{"code":"OK"}' }] },
  decoded: [
    {
      data: {
        data: {
          asin: {
            asin: c.product_id,
            marketplace: "US",
            imageUrl: "https://example.com/photo.jpg",
          },
          salesTrendPoints: [
            { month: "2026-07", parentUnitSales: 20, childUnitSales: null },
            { month: "2026-08", parentUnitSales: 0, childUnitSales: 0 },
            { month: "2026-09", parentUnitSales: 30, childUnitSales: 5 },
          ],
        },
      },
    },
  ],
};
const sources = new Map([["verified", series]]);
const result = {
  status: "partial",
  summary: "阶段结果 SellerSprite / 卖家精灵 <script>bad()</script>",
  sections: [],
  candidates: [c],
  limitations: [],
  questions: [],
  next_actions: [],
};
const meta = {
  request: {
    market: "US",
    platform: "amazon",
    candidate_count: 1,
    lookback_days: 30,
  },
  sources,
};
test("Amazon monthly series binds exact site/ASIN and keeps nulls, zeros and parent/child scopes", () => {
  const trend = amazonSalesTrend(c, sources);
  assert.deepEqual(trend.points, [
    { month: "2026-07", parent: 20, child: null },
    { month: "2026-08", parent: 0, child: 0 },
    { month: "2026-09", parent: 30, child: 5 },
  ]);
  assert.equal(amazonSalesTrend({ ...c, market: "DE" }, sources), null);
  assert.equal(
    amazonSalesTrend({ ...c, product_id: "B999999999" }, sources),
    null,
  );
  for (const other of [
    { source: "FastMoss" },
    { result: { isError: true } },
    { tool: "review" },
  ])
    assert.equal(
      amazonSalesTrend(c, new Map([["bad", { ...series, ...other }]])),
      null,
    );
  const html = renderAmazonReport(result, meta);
  assert.doesNotMatch(html, /SellerSprite|卖家精灵/i);
  assert.equal(series.source, "SellerSprite");
  assert.match(html, /父 ASIN 月销量/);
  assert.match(html, /当前子 ASIN 月销量/);
  assert.match(html, /未完月/);
  assert.doesNotMatch(html, /999999|<script>|累计销量|7 日销量/);
});
test("Amazon archive ignores model images, keeps safe inline covers and handles failed downloads", async () => {
  assert.equal(
    amazonImageSources(
      [{ ...c, image: "https://untrusted.example/fake.jpg" }],
      new Map(),
    ).size,
    0,
  );
  assert.equal(
    amazonImageSources([c], sources).get(c.product_id).pointer,
    "/decoded/0/data/data/asin/imageUrl",
  );
  const before = structuredClone(result);
  const good = await amazonPresentation(result, meta, {
    fetchOne: async () => ({
      data_url: "data:image/png;base64,iVBORw0KGgo=",
      byte_length: 8,
    }),
  });
  assert.equal(good.candidates[0].image, "data:image/png;base64,iVBORw0KGgo=");
  assert.deepEqual(result, before);
  assert.match(good.html, /<img src="data:image\/png/);
  assert.doesNotMatch(good.html, /<img src="https:/);
  const failed = await amazonPresentation(result, meta, {
    fetchOne: async () => {
      throw Error("timeout");
    },
  });
  assert.equal(failed.candidates[0].image, null);
  assert.equal(failed.metadata.image_archive.failed, 1);
  assert.match(failed.html, /图片待补充/);
});
test("Empty and large Amazon reports preserve TK reading order and all source/section links resolve", () => {
  for (const count of [0, 1, 25]) {
    const html = renderAmazonReport(
      {
        ...result,
        candidates: Array.from({ length: count }, (_, i) => ({
          ...c,
          product_id: i ? `B${String(i).padStart(9, "0")}` : c.product_id,
        })),
      },
      meta,
    );
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(ids.length, new Set(ids).size);
    for (const [, target] of html.matchAll(/href="#([^"]+)"/g))
      assert.ok(ids.includes(target), target);
    assert.equal(
      (html.match(/class="section catalog-page"/g) || []).length,
      Math.max(1, Math.ceil(count / 12)),
    );
    assert.match(html, /Content-Security-Policy/);
    assert.match(html, /amazon-editorial-v4/);
  }
});

test("archived prediction months render with their own scope, exact site/ASIN, zeros and invalid-value gaps", () => {
  const prediction = {
    ...series,
    tool: "asin_prediction",
    request: { asin: c.product_id, marketplace: "US" },
    decoded: [
      {
        data: {
          data: {
            asinDetail: { asin: c.product_id },
            monthItemList: [
              { date: "2026-05", sales: 12 },
              { date: "2026-06", sales: -1 },
              { date: "2026-07", sales: 0 },
              { date: "2026-08", sales: 2 },
              { date: "2026-08", sales: 4 },
              { date: "2026-09", sales: 5 },
              { date: "2026-13", sales: 12345 },
            ],
          },
        },
      },
    ],
  };
  const input = new Map([["prediction", prediction]]);
  const trend = amazonSalesTrend(c, input);
  assert.equal(trend.scope, "prediction");
  assert.equal(trend.pointer, "/decoded/0/data/data/monthItemList");
  assert.deepEqual(trend.points, [
    { month: "2026-05", estimated: 12 },
    { month: "2026-06", estimated: null },
    { month: "2026-07", estimated: 0 },
    { month: "2026-09", estimated: 5 },
  ]);
  for (const candidate of [
    { ...c, market: "GB" },
    { ...c, product_id: "B999999999" },
  ])
    assert.equal(amazonSalesTrend(candidate, input), null);
  for (const patch of [
    { source: "FastMoss" },
    { result: { isError: true } },
    { request: { asin: "B999999999", marketplace: "US" } },
    { request: { asin: c.product_id, marketplace: "GB" } },
    {
      decoded: [
        {
          data: {
            data: {
              ...prediction.decoded[0].data.data,
              asinDetail: { asin: "B999999999" },
            },
          },
        },
      ],
    },
    {
      decoded: [
        {
          data: {
            data: {
              ...prediction.decoded[0].data.data,
              asinDetail: { asin: c.product_id, marketplace: "DE" },
            },
          },
        },
      ],
    },
  ])
    assert.equal(
      amazonSalesTrend(c, new Map([["bad", { ...prediction, ...patch }]])),
      null,
    );
  const html = renderAmazonReport(result, { ...meta, sources: input });
  assert.match(html, /请求 ASIN 月销量（估算）/);
  assert.match(html, /不视为子体实际订单/);
  assert.match(html, /未完月/);
  assert.doesNotMatch(
    html,
    /父 ASIN 月销量|当前子 ASIN 月销量|历史月度销量 · 待补充|12,345/,
  );
  assert.match(html, /<th>2026-07<\/th><td>0<\/td>/);
  assert.equal(
    amazonSalesTrend(c, new Map([...input, ...sources])).pointer,
    "/decoded/0/data/data/salesTrendPoints",
  );
});
