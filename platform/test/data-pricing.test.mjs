import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { liveDataPrice, publicDataPricing } from "../src/data/pricing.mjs";
import { fastmossOutcome } from "../src/data/response-outcome.mjs";

test("all 55 approved tool prices use exact units and unknown prices never fall back to one point", async () => {
  for (const [tool, expected] of [
    ["search_category_by_words", 0n],
    ["product_detail_info", 10n],
    ["product_sales_trend", 20n],
    ["creator_rank_top_ecommerce", 30n],
  ])
    assert.equal(liveDataPrice("fastmoss", tool).units, expected);
  assert.throws(() => liveDataPrice("fastmoss", "new_unknown_tool"), {
    code: "data_tool_price_unconfirmed",
  });
  assert.equal(liveDataPrice("sellersprite", "product_research").units, 10n);
  const price = publicDataPricing();
  const { tools } = JSON.parse(
    await readFile(
      new URL("../../schemas/fastmoss-tools.snapshot.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(
    Object.keys(price.tools).sort(),
    tools.map((t) => t.name).sort(),
  );
  assert.equal(price.points_per_snapshot, 0.3);
  assert.equal(price.points_per_call, null);
  const counts = [0, 0, 0, 0];
  for (const [tool, value] of Object.entries(price.tools)) {
    assert.ok([0, 1, 2, 3].includes(value), tool);
    assert.equal(liveDataPrice("fastmoss", tool).units, BigInt(value * 10));
    counts[value]++;
  }
  assert.deepEqual(counts, [4, 32, 11, 8]);
  assert.deepEqual(price.tiers.map((tier) => tier.count), counts);
});

test("empty results and business failures are free without mistaking valid zero metrics for no data", () => {
  const mcp = (value) => ({
    content: [{ type: "text", text: JSON.stringify(value) }],
  });
  for (const value of [
    null,
    [],
    {},
    { data: null },
    { code: 0, data: [] },
    { list: [], total: 0 },
    { list: [], total: 100, page: 20 },
    {
      result: { items: [], pagination: { total: 0 } },
      params: { query: "x" },
      tool_id: "x",
    },
  ])
    assert.equal(fastmossOutcome(mcp(value)), "empty", JSON.stringify(value));
  for (const value of [
    { code: 429 },
    { status: "failed" },
    { success: false },
    { data: { code: 500 } },
    { error: "unavailable" },
  ])
    assert.equal(fastmossOutcome(mcp(value)), "failed");
  assert.equal(
    fastmossOutcome({
      structuredContent: { code: 500 },
      content: mcp({ product: { id: "x" } }).content,
    }),
    "failed",
  );
  assert.equal(
    fastmossOutcome({
      isError: true,
      content: [{ type: "text", text: "error" }],
    }),
    "failed",
  );
  for (const value of [
    { period_gmv: 0 },
    { product: { stock: 0, is_ad: false } },
    { list: [], summary: { gmv: 0 } },
    { list: [{ id: "1" }] },
  ])
    assert.equal(fastmossOutcome(mcp(value)), "success");
  assert.equal(
    fastmossOutcome({
      content: [{ type: "text", text: "unrecognized response" }],
    }),
    "unknown",
  );
});
