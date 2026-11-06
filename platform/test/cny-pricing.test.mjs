import test from "node:test";
import assert from "node:assert/strict";
import { PriceSchema, PublishedPriceSchema, charges, callBound, publicPrice } from "../src/common/core.mjs";

const legacy = PriceSchema.parse({
  currency: "USD", fx: "7",
  market: { input: "1.26", output: "3.96", cache_read: "0.23", cache_write: "0.23" },
  procurement_discount: "1", sale_discount: "1.5",
  max_context_tokens: 64000, max_output_tokens: 4096,
});
const current = { ...legacy, currency: "CNY", fx: "1",
  market: { input: "8.82", output: "27.72", cache_read: "1.61", cache_write: "1.61" } };

test("new publications require CNY while historical USD snapshots remain readable", () => {
  assert.equal(PublishedPriceSchema.safeParse(legacy).success, false);
  assert.equal(PublishedPriceSchema.safeParse(current).success, true);
  assert.equal(PublishedPriceSchema.safeParse({ ...current, fx: "7" }).success, false);
  assert.equal(PriceSchema.safeParse(legacy).success, true);
});

test("CNY conversion preserves reservations and settlement down to the final microyuan", () => {
  for (const schedule of [undefined, { schedule: "deepseek_business_hours_v1", off_peak_discount: "0.5" }]) {
    const before = { ...legacy, time_pricing: schedule }, after = { ...current, time_pricing: schedule };
    assert.equal(callBound(before), callBound(after));
    for (const at of ["2026-09-10T09:00:00+08:00", "2026-09-12T10:00:00+08:00"])
      for (const [input_tokens, output_tokens, cached_tokens] of [[1, 0, 0], [12345, 654, 789], [64000, 4096, 64000]]) {
        const usage = { input_tokens, output_tokens, input_tokens_details: { cached_tokens } };
        assert.deepEqual(charges(usage, before, at), charges(usage, after, at));
      }
  }
});

test("user-facing legacy and new price cards both show equivalent CNY rates without mutation", () => {
  const snapshot = structuredClone(legacy);
  for (const schedule of [undefined, { schedule: "deepseek_business_hours_v1", off_peak_discount: "0.5" }]) {
    const before = { ...legacy, time_pricing: schedule }, after = { ...current, time_pricing: schedule };
    for (const at of ["2026-09-10T09:00:00+08:00", "2026-09-12T10:00:00+08:00"]) {
      const shown = publicPrice(before, at);
      assert.deepEqual(shown, publicPrice(after, at));
      assert.equal(shown.currency, "CNY");
      assert.equal(shown.fx, "1");
    }
  }
  assert.equal(publicPrice(legacy).rates.input, "13.230000");
  assert.deepEqual(legacy, snapshot);
});
