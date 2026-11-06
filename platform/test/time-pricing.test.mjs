import test from "node:test";
import assert from "node:assert/strict";
import {
  PriceSchema,
  charges,
  callBound,
  publicPrice,
  pricingPeriod,
} from "../src/common/core.mjs";

const card = PriceSchema.parse({
  currency: "CNY",
  fx: "1",
  market: { input: "9", output: "27", cache_read: "0.3", cache_write: "0" },
  procurement_discount: "1",
  sale_discount: "1.5",
  max_context_tokens: 64000,
  max_output_tokens: 4096,
  time_pricing: {
    schedule: "deepseek_business_hours_v1",
    off_peak_discount: "0.5",
  },
});

test("RMB pricing rejects double conversion and invalid schedules", () => {
  for (const bad of [
    { ...card, fx: "7" },
    { ...card, currency: "EUR" },
    ...["0", "1.1", "-1"].map((off_peak_discount) => ({
      ...card,
      time_pricing: { ...card.time_pricing, off_peak_discount },
    })),
    { ...card, time_pricing: { ...card.time_pricing, schedule: "unknown" } },
  ])
    assert.equal(PriceSchema.safeParse(bad).success, false);
});

test("Shanghai weekday and lunch boundaries use exact inclusive start / exclusive end", () => {
  for (const [time, period] of [
    ["2026-09-10T08:59:59+08:00", "off_peak"],
    ["2026-09-10T09:00:00+08:00", "peak"],
    ["2026-09-10T11:59:59+08:00", "peak"],
    ["2026-09-10T12:00:00+08:00", "off_peak"],
    ["2026-09-10T13:59:59+08:00", "off_peak"],
    ["2026-09-10T14:00:00+08:00", "peak"],
    ["2026-09-10T17:59:59+08:00", "peak"],
    ["2026-09-10T18:00:00+08:00", "off_peak"],
    ["2026-09-12T10:00:00+08:00", "off_peak"],
    ["2026-09-13T15:00:00+08:00", "off_peak"],
    ["2026-09-14T01:00:00Z", "peak"],
  ])
    assert.equal(pricingPeriod(card, time).period, period, time);
  assert.throws(() => pricingPeriod(card, "invalid"));
});

test("procurement, sales and cached input are settled once at the invocation time", () => {
  const usage = {
    input_tokens: 1000,
    input_tokens_details: { cached_tokens: 400 },
    output_tokens: 100,
  };
  const peak = charges(usage, card, "2026-09-10T09:00:00+08:00");
  const idle = charges(usage, card, "2026-09-10T18:00:00+08:00");
  assert.equal(peak.procurement, 8220n);
  assert.equal(peak.sale, 12330n);
  assert.equal(idle.procurement, 4110n);
  assert.equal(idle.sale, 6165n);
  assert.deepEqual(peak.normalized, idle.normalized);
  // Currency decimal rounding occurs after rate/discount multiplication.
  assert.equal(
    charges({ input_tokens: 1, output_tokens: 0 }, card, "2026-09-12").sale,
    7n,
  );
  const fixed = { ...card, currency: "USD", fx: "7", time_pricing: undefined };
  assert.equal(charges(usage, fixed, "2026-09-12").sale, 86310n);
});

test("budget reservations cover peak rates even when a job starts off peak", () => {
  assert.equal(callBound(card), 1029888n);
  for (const cached of [0, 64000]) {
    const unusual = { ...card, market: { ...card.market, cache_read: "12" } };
    const usage = {
      input_tokens: 64000,
      input_tokens_details: { cached_tokens: cached },
      output_tokens: 4096,
    };
    assert.ok(
      callBound(unusual) >=
        charges(usage, unusual, "2026-09-10T14:00:00+08:00").sale,
    );
  }
});

test("public prices show current and peak sales rates without procurement fields", () => {
  const result = publicPrice(card, "2026-09-12T10:00:00+08:00");
  assert.equal(result.currency, "CNY");
  assert.equal(result.rates.input, "6.750000");
  assert.equal(result.peak_rates.output, "40.500000");
  assert.equal(result.time_pricing.current_period, "off_peak");
  for (const key of ["market", "procurement_discount", "sale_discount", "note"])
    assert.equal(result[key], undefined);
  assert.equal(card.market.input, "9");
});
