import test from "node:test";
import assert from "node:assert/strict";
import { candidateMonitorTarget } from "../src/monitoring/candidate-shop.mjs";

const candidate = () => ({
  product_id: "1732536825905385902",
  assessment: {
    facts: {
      shop_id: {
        value: "7494103726733493678",
        invocation_id: "source",
        pointer: "/decoded/0/data/list/0/shop/shop_id",
      },
      shop_name: { value: "Findry", invocation_id: "source" },
      region: { value: "US", invocation_id: "source" },
    },
  },
});

test("candidate monitoring uses the source shop ID without losing precision, never the product ID", () => {
  assert.deepEqual(candidateMonitorTarget(candidate(), "US"), {
    seller_id: "7494103726733493678",
    name: "Findry",
    market: "US",
  });
  const c = candidate();
  c.assessment.facts.shop_id.pointer = "/decoded/0/data/shop/shop_id";
  delete c.assessment.facts.region;
  assert.equal(candidateMonitorTarget(c, "US").market, "US");
  assert.equal(candidateMonitorTarget(c), null);
  c.assessment.facts.shop_name.invocation_id = "older-source";
  assert.equal(
    candidateMonitorTarget(c, "US").name,
    "竞店 7494103726733493678",
  );
});

test("missing, rounded, conflicting or unsupported shop identities cannot create a monitor", () => {
  assert.equal(
    candidateMonitorTarget({ product_id: "123", shop_id: "456" }, "US"),
    null,
  );
  assert.equal(candidateMonitorTarget(candidate(), "GB"), null);
  for (const shop_id of [
    { value: 7494103726733493678 },
    { value: "not-a-shop" },
    { value: "123", pointer: "/decoded/0/data/product/product_id" },
    { value: "123", invocation_id: null },
  ]) {
    const c = candidate();
    Object.assign(c.assessment.facts.shop_id, shop_id);
    assert.equal(candidateMonitorTarget(c, "US"), null);
  }
  const c = candidate();
  c.assessment.facts.region.value = "XX";
  assert.equal(candidateMonitorTarget(c), null);
});
