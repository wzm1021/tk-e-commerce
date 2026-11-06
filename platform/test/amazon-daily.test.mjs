import test from "node:test";
import assert from "node:assert/strict";
import {
  amazonDailySales,
  amazonDailyChart,
  dailyDifference,
} from "../src/reports/amazon-daily.mjs";
import { sellerSpriteTools } from "../src/data/sellersprite.mjs";
const candidate = { product_id: "B012345678", market: "US" };
const source = (rows) => ({
  source: "SellerSprite",
  tool: "asin_prediction",
  request: { marketplace: "US", asin: candidate.product_id },
  captured_at: "2026-09-20T10:00:00Z",
  result: { content: [{ type: "text", text: '{"code":"OK"}' }] },
  decoded: [
    {
      data: {
        data: {
          asinDetail: { asin: candidate.product_id },
          dailyItemList: rows,
          monthItemList: [{ date: "2026-09", sales: 1000 }],
        },
      },
    },
  ],
});
const row = (date, sales) => ({ date, sales, bsr: 1234 });
const sources = new Map([
  [
    "daily",
    source([
      row("2026-09-11", 20),
      row("2026-09-12", 10),
      row("2026-09-17", 0),
      row("2026-09-18", 20),
      row("2026-09-19", 30),
      row("2026-09-20", 100),
      row("2026-09-21", 1000),
    ]),
  ],
]);
test("daily comparisons use real adjacent dates, same weekdays, source identity and exclude current/future days", () => {
  const t = amazonDailySales(candidate, sources, 3);
  assert.equal(t.days, 3);
  assert.equal(t.coverage, 3);
  assert.deepEqual(
    t.points.map((p) => p.sales),
    [0, 20, 30],
  );
  assert.deepEqual(t.latest.previous, { units: 10, percent: 50 });
  assert.deepEqual(t.latest.week, { units: 20, percent: 200 });
  assert.equal(t.points[1].previous.percent, null);
  assert.equal(t.points[0].previous, null);
  assert.equal(t.latest.pointer, "/decoded/0/data/data/dailyItemList/4");
  for (const modified of [{ market: "DE" }, { product_id: "B999999999" }])
    assert.equal(
      amazonDailySales({ ...candidate, ...modified }, sources),
      null,
    );
  for (const patch of [
    { source: "FastMoss" },
    { tool: "asin_sales_trend" },
    { request: { marketplace: "DE", asin: candidate.product_id } },
    { result: { isError: true } },
    { captured_at: "invalid" },
  ])
    assert.equal(
      amazonDailySales(
        candidate,
        new Map([["wrong", { ...source([]), ...patch }]]),
      ),
      null,
    );
});
test("missing, invalid and duplicate dates are not zero-filled or compared across a calendar gap", () => {
  const s = new Map([
    [
      "daily",
      source([
        row("2026-09-16", 10),
        row("2026-09-17", 10),
        row("2026-09-17", 12),
        row("2026-09-18", null),
        row("2026-09-19", 30),
        row("2026-02-30", 99),
        row("2026-09-15", -1),
        row("2026-09-14", "40"),
      ]),
    ],
  ]);
  const t = amazonDailySales(candidate, s, 7);
  assert.equal(t.coverage, 2);
  assert.equal(t.duplicates, 1);
  assert.equal(t.latest.previous, null);
  assert.equal(t.points.find((p) => p.date === "2026-09-17").sales, null);
  assert.equal(t.points.find((p) => p.date === "2026-09-18").sales, null);
  assert.equal(dailyDifference(null, 0), null);
  assert.deepEqual(dailyDifference(0, 0), { units: 0, percent: null });
  const monthly = source([]);
  delete monthly.decoded[0].data.data.dailyItemList;
  assert.equal(amazonDailySales(candidate, new Map([["m", monthly]])), null);
});
test("daily HTML is source-linked, escaped, labels prediction scope and preserves source gaps", () => {
  const html = amazonDailyChart(
    candidate,
    sources,
    () => '<a href="#source-1">[1]</a>',
    30,
  );
  assert.match(html, /每日销量对比 · 供应商估算/);
  assert.match(html, /上周同日/);
  assert.match(html, /基期为 0/);
  assert.match(html, /未明确是否合并变体/);
  assert.match(html, /href="#source-1"/);
  assert.equal((html.match(/<tr>/g) || []).length, 31);
  assert.doesNotMatch(html, /NaN|Infinity|y="170-h"/);
  assert.match(
    amazonDailyChart(candidate, new Map(), () => ""),
    /月度数据不能拆算/,
  );
  const bad = {
    ...source([row("2026-09-19", 30)]),
    captured_at: "2026-09-20<script>bad</script>",
  };
  assert.doesNotMatch(
    amazonDailyChart(candidate, new Map([["daily", bad]]), () => ""),
    /<script>/,
  );
});
test("daily prediction is reviewed and exposed only with its validated schema", () => {
  const schema = {
    type: "object",
    properties: { marketplace: { type: "string" }, asin: { type: "string" } },
    required: ["marketplace", "asin"],
    additionalProperties: false,
  };
  const tools = sellerSpriteTools([
    { name: "product_research", inputSchema: { type: "object" } },
    { name: "asin_prediction", inputSchema: schema },
    { name: "keepa_info", inputSchema: schema },
  ]);
  assert.deepEqual(
    tools.map((t) => t.name),
    ["product_research", "asin_prediction"],
  );
  assert.throws(() =>
    sellerSpriteTools([
      { name: "product_research", inputSchema: { type: "object" } },
      { name: "asin_prediction", inputSchema: null },
    ]),
  );
});
