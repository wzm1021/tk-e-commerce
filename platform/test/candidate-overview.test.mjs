import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Ajv from "ajv";
import {
  OverviewInput,
  overviewPlan,
  overviewData,
} from "../src/reports/candidate-overview.mjs";
const target = { seller_id: "7494419524321642200", market: "GB" },
  product = "1729613111070136690";
test("overview plans use schema-approved periods, pagination and precise entity identifiers", async () => {
  const { tools } = JSON.parse(
    await readFile(
      new URL("../../schemas/fastmoss-tools.snapshot.json", import.meta.url),
    ),
  );
  const ajv = new Ajv({ strict: false });
  for (const section of [
    "overview",
    "sales",
    "products",
    "creators",
    "videos",
    "lives",
    "product_advertising",
    "advertising",
    "sku",
  ])
    for (const days of [7, 28, 90]) {
      if (section === "sku" && days === 90) continue;
      for (const call of overviewPlan(target, product, {
        section,
        days,
        page: 2,
      })) {
        const validate = ajv.compile(
          tools.find((t) => t.name === call.name).inputSchema,
        );
        assert.equal(
          validate(call.arguments),
          true,
          JSON.stringify(validate.errors),
        );
        assert.equal(
          typeof (
            call.arguments.filter.seller_id || call.arguments.filter.product_id
          ),
          "string",
        );
        assert.ok(!call.arguments.filter.publish_time_range_days);
      }
    }
  assert.throws(() => OverviewInput.parse({ seller_id: "forged" }));
  assert.throws(() => OverviewInput.parse({ page: 501 }));
  assert.throws(() => overviewPlan(target, Number(product), {}));
  assert.throws(() =>
    overviewPlan(target, product, { section: "sku", days: 90 }),
  );
});

test("product advertising uses one product-bound call and validates returned identity and currency", () => {
  for (const days of [7, 28, 90]) {
    const plan = overviewPlan(target, product, {
      section: "product_advertising",
      days,
    });
    assert.deepEqual(plan, [
      {
        name: "product_investment",
        arguments: { filter: { product_id: product, time_range_days: days } },
      },
    ]);
    const call = plan[0];
    const data = {
      currency_code: "GBP",
      ad_performance_summary: { estimated_ad_spend: 12, ad_gmv: 30 },
    };
    const source = {
      tool: call.name,
      request: call.arguments,
      decoded: [{ data }],
    };
    const panel = overviewData(source, call, target, product);
    assert.equal(panel.advertising_evidence.status, "observed");
    assert.equal(panel.advertising_evidence.product_id, product);
    assert.equal(panel.advertising_evidence.days, days);
    for (const invalid of [
      { ...data, product_id: "999" },
      { ...data, product_id: Number(product) },
      { ...data, product_id: product, product: { product_id: "999" } },
      { ...data, currency_code: "USD" },
      { ...data, region: "US" },
    ])
      assert.throws(() =>
        overviewData(
          { ...source, decoded: [{ data: invalid }] },
          call,
          target,
          product,
        ),
      );
    assert.throws(() =>
      overviewData(
        { ...source, tool: "shop_investment_analysis" },
        call,
        target,
        product,
      ),
    );
    assert.throws(() =>
      overviewData(
        {
          ...source,
          request: { filter: { product_id: "999", time_range_days: days } },
        },
        call,
        target,
        product,
      ),
    );
  }
  const shopCall = overviewPlan(target, product, { section: "advertising" })[0];
  const shopPanel = overviewData(
    {
      tool: shopCall.name,
      request: shopCall.arguments,
      decoded: [
        { data: { ad_performance_summary: { estimated_ad_spend: 999 } } },
      ],
    },
    shopCall,
    target,
    product,
  );
  assert.equal(shopPanel.advertising_evidence, undefined);
});
test("overview rejects changed shops, cross-market snapshots, rounded IDs and unbound payloads; preserves zero vs missing", () => {
  const call = overviewPlan(target, product, {})[0];
  const source = {
    tool: call.name,
    request: call.arguments,
    decoded: [
      {
        data: {
          product: { region: "GB", total_units_sold: 0 },
          shop: { shop_id: target.seller_id },
        },
      },
    ],
  };
  assert.equal(
    overviewData(source, call, target, product).data.product.total_units_sold,
    0,
  );
  assert.equal(
    overviewData(source, call, target, product).data.product.total_gmv,
    undefined,
  );
  for (const shop of [
    { shop_id: "999" },
    { shop_id: Number(target.seller_id) },
    { shop_id: target.seller_id, region: "US" },
  ])
    assert.throws(() =>
      overviewData(
        { ...source, decoded: [{ data: { shop } }] },
        call,
        target,
        product,
      ),
    );
  assert.throws(() =>
    overviewData({ ...source, request: {} }, call, target, product),
  );
  assert.throws(() =>
    overviewData({ ...source, decoded: [] }, call, target, product),
  );
});

test("video summary with conflicting market is excluded while verified rows remain", () => {
  const call = overviewPlan(target, product, { section: "videos" })[0];
  const envelope = {
    tool: call.name,
    request: call.arguments,
    decoded: [
      {
        data: {
          summary: { region: "US", total_video_gmv: 999 },
          videos: {
            total: 2,
            items: [
              { region: "GB", video_id: "1" },
              { region: "US", video_id: "2" },
            ],
          },
        },
      },
    ],
  };
  const view = overviewData(envelope, call, target, product);
  assert.equal(view.data.summary, undefined);
  assert.equal(view.data.videos.items.length, 1);
  assert.equal(view.warnings.length, 2);
});
