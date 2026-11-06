import test from "node:test";
import assert from "node:assert/strict";
import { productAdvertisingEvidence } from "../src/reports/product-advertising.mjs";

const zero = {
  estimated_ad_spend: 0,
  ad_gmv: 0,
  ad_units_sold: 0,
  ad_play_count: 0,
  ad_video_count: 0,
};
const classify = (summary, daily = []) =>
  productAdvertisingEvidence(
    { ad_performance_summary: summary, daily_ad_performance_trend: daily },
    "1732585168554660270",
    28,
  );

test("product ad activity can be observed without attributed sales or spend", () => {
  for (const field of Object.keys(zero)) {
    const result = classify({ ...zero, [field]: 1 });
    assert.equal(result.status, "observed", field);
    assert.deepEqual(result.evidence, [{ field, value: 1, source: "summary" }]);
  }
  assert.equal(classify({ ad_video_count: "23" }).status, "observed");
  assert.equal(classify({ ...zero, roas: 3 }).status, "not_observed");
  assert.equal(
    classify({ roas: 3, product_total_gmv: 999, promoted_product_count: 100 })
      .status,
    "unknown",
  );
});

test("only complete explicit zero metrics mean not observed; missing and malformed values stay unknown", () => {
  assert.equal(classify(zero).status, "not_observed");
  assert.equal(classify({}).status, "unknown");
  for (const field of Object.keys(zero))
    for (const value of [
      null,
      undefined,
      "",
      " ",
      "NaN",
      "Infinity",
      Infinity,
      NaN,
      -1,
      false,
      true,
      {},
      [],
    ])
      assert.equal(
        classify({ ...zero, [field]: value }).status,
        "unknown",
        `${field}: ${value}`,
      );
});

test("daily ad evidence is retained when summary is absent or zero, without interpreting empty daily rows as no ads", () => {
  const row = { date: "2026-10-15", ad_video_count: 2 };
  for (const summary of [{}, zero]) {
    const result = classify(summary, [null, row]);
    assert.equal(result.status, "observed");
    assert.deepEqual(result.evidence, [
      { field: "ad_video_count", value: 2, source: "daily", date: row.date },
    ]);
  }
  assert.equal(
    classify({}, [{ ...zero, date: "2026-10-15" }]).status,
    "unknown",
  );
  assert.equal(classify({}, [{ ad_video_count: 1 }]).status, "unknown");
});
