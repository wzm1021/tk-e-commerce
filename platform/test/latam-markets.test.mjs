import test from "node:test";
import assert from "node:assert/strict";
import {
  PLATFORMS,
  TIKTOK_CURRENCIES,
  MARKET_NAMES,
} from "../src/common/platforms.mjs";
import * as web from "../web/lib/platforms.mjs";
import { normalizeRequest } from "../src/research/requests.mjs";
import { MonitorInput } from "../src/monitoring/contract.mjs";
import { candidateMonitorTarget } from "../src/monitoring/candidate-shop.mjs";
import {
  overviewPlan,
  overviewData,
} from "../src/reports/candidate-overview.mjs";
import { scoutingProductFacts } from "../src/reports/scouting-facts.mjs";
import { applyScoutingPolicy } from "../src/reports/scouting-policy.mjs";
import { renderScoutingReport } from "../src/reports/scouting-report.mjs";
import { pointer } from "../src/reports/reports.mjs";
import {
  productPriceWarning,
  PRICE_UNIT_WARNING,
} from "../src/reports/product-price.mjs";
import { normalizeSnapshot } from "../src/monitoring/engine.mjs";
import { monitorSources, monitorConfig } from "./fixtures/monitoring.mjs";

test("Latin American markets work through research, monitoring and candidate handoff; platform boundaries remain", () => {
  assert.deepEqual(web.PLATFORMS, PLATFORMS);
  assert.deepEqual(web.MARKET_NAMES, MARKET_NAMES);
  assert.deepEqual(web.TIKTOK_CURRENCIES, TIKTOK_CURRENCIES);
  for (const market of PLATFORMS.tiktok.markets) {
    assert.ok(MARKET_NAMES[market]);
    assert.ok(TIKTOK_CURRENCIES[market]);
    for (const kind of [
      "scouting",
      "competitor",
      "content",
      "reviews",
      "ads",
      "diagnostics",
    ])
      assert.equal(
        normalizeRequest(
          kind,
          kind === "scouting"
            ? { market, category: "家居收纳", selection_rules: "" }
            : { market, target: "123456789", question: "分析市场机会" },
        ).market,
        market,
      );
    assert.equal(
      MonitorInput.parse({ name: "竞店", seller_id: "123456789", market })
        .market,
      market,
    );
    const facts = {
      shop_id: {
        value: "123456789",
        invocation_id: "source",
        pointer: "/decoded/0/data/shop/shop_id",
      },
      region: { value: market },
    };
    assert.equal(
      candidateMonitorTarget({ assessment: { facts } }, market).market,
      market,
    );
  }
  for (const market of ["CO", "AR", "CL", "XX"])
    assert.throws(() =>
      normalizeRequest("scouting", { market, category: "收纳" }),
    );
  assert.throws(() =>
    normalizeRequest("scouting", {
      platform: "amazon",
      market: "BR",
      category: "收纳",
    }),
  );
});

test("MXN and BRL pass overview and monitor checks without weakening currency or region validation", () => {
  for (const market of ["MX", "BR"]) {
    const target = { market, seller_id: "123" },
      productId = "456";
    const call = overviewPlan(target, productId, {
      section: "product_advertising",
    })[0];
    const source = {
      tool: call.name,
      request: call.arguments,
      decoded: [
        {
          data: {
            region: market,
            currency_code: TIKTOK_CURRENCIES[market],
            product_id: productId,
          },
        },
      ],
    };
    assert.equal(
      overviewData(source, call, target, productId).data.currency_code,
      TIKTOK_CURRENCIES[market],
    );
    source.decoded[0].data.currency_code = "USD";
    assert.throws(
      () => overviewData(source, call, target, productId),
      /overview_currency_mismatch/,
    );
    const sources = structuredClone(monitorSources());
    for (const envelope of sources.values()) {
      const shop = envelope.decoded[0].data.shop;
      shop.region = market;
      shop.currency_code = TIKTOK_CURRENCIES[market];
    }
    const snapshot = normalizeSnapshot(
      sources,
      { ...monitorConfig, market },
      "2026-09-19T12:00:00.000Z",
    );
    assert.equal(snapshot.identity_valid, true);
    assert.equal(snapshot.currency, TIKTOK_CURRENCIES[market]);
    assert.deepEqual(snapshot.issues, []);
  }
});

function priceFixture(product) {
  const source = {
    source: "FastMoss",
    tool: "product_search",
    captured_at: "2026-10-22T10:37:07Z",
    request: { filter: { region: "BR" } },
    decoded: [
      {
        data: {
          list: [
            {
              product: {
                product_id: "456",
                region: "BR",
                currency_code: "BRL",
                ...product,
              },
            },
          ],
        },
      },
    ],
  };
  return { source, sources: new Map([["sample", source]]) };
}

test("Brazil centavo mismatch is excluded from computed prices and HTML, while raw citations remain exact", () => {
  const { source, sources } = priceFixture({
    floor_price: 2990,
    ceiling_price: 2990,
    price_display: "R$ 29,90",
  });
  const candidate = {
    product_id: "456",
    title: "护发产品",
    decision: "watch",
    reason: "待验证",
    evidence: [],
    limitations: [],
  };
  const facts = scoutingProductFacts(candidate, sources, "BR");
  assert.equal(facts.floor_price, undefined);
  assert.equal(facts.unverified_floor_price.value, 2990);
  assert.equal(facts.price_display.value, "R$ 29,90");
  for (const fact of Object.values(facts))
    assert.deepEqual(pointer(source, fact.pointer), fact.value);
  const request = {
    market: "BR",
    category: "护发",
    selection_rules: "",
    candidate_count: 1,
  };
  const result = applyScoutingPolicy(
    {
      status: "complete",
      summary: "等待价格核验",
      sections: [],
      questions: [],
      next_actions: [],
      limitations: [],
      candidates: [candidate],
    },
    request,
    sources,
    "2026-10-22T11:00:00Z",
  );
  assert.equal(result.candidates[0].price, null);
  assert.equal(result.candidates[0].price_max, null);
  assert.ok(result.candidates[0].limitations.includes(PRICE_UNIT_WARNING));
  const html = renderScoutingReport(result, { request, sources });
  assert.ok(html.includes("售价区间 · 快照</dt><dd>待核验"));
  assert.ok(!html.includes("BRL 2,990"));
  assert.equal(source.decoded[0].data.list[0].product.floor_price, 2990);

  const call = overviewPlan({ seller_id: "123", market: "BR" }, "456", {})[0];
  const envelope = {
    tool: call.name,
    request: call.arguments,
    decoded: [{ data: source.decoded[0].data.list[0] }],
  };
  const panel = overviewData(
    envelope,
    call,
    { seller_id: "123", market: "BR" },
    "456",
  );
  assert.equal(panel.data.product.floor_price, null);
  assert.equal(panel.data.product.price_status, "unverified");
  assert.deepEqual(panel.warnings, [PRICE_UNIT_WARNING]);
  assert.equal(envelope.decoded[0].data.product.floor_price, 2990);
});

test("Brazil matching decimal prices and ranges are retained; missing units and changed snapshots cannot revive stale prices", () => {
  assert.equal(
    productPriceWarning(
      {
        floor_price: 29.9,
        ceiling_price: 29.9,
        floor_price_display: "R$29.90",
        ceiling_price_display: "R$29.90",
      },
      "BR",
    ),
    null,
  );
  assert.equal(
    productPriceWarning(
      { floor_price: 2990, floor_price_display: "R$29.90" },
      "BR",
    ),
    PRICE_UNIT_WARNING,
  );
  for (const [floor_price, ceiling_price, price_display] of [
    [29.9, 29.9, "R$ 29,90"],
    [1234.56, 2345.67, "R$ 1.234,56 – R$ 2.345,67"],
    [0, 0, "R$ 0,00"],
  ])
    assert.equal(
      productPriceWarning({ floor_price, ceiling_price, price_display }, "BR"),
      null,
    );
  for (const price_display of [
    undefined,
    "29.90",
    "R$ 29,90",
    "R$ 2.990,00 – R$ 1.000,00",
  ])
    assert.equal(
      productPriceWarning({ floor_price: 2990, price_display }, "BR"),
      PRICE_UNIT_WARNING,
    );
  assert.equal(
    productPriceWarning(
      { floor_price: 142.2, price_display: "MX$142.20 - 158.10" },
      "MX",
    ),
    null,
  );
  const { sources, source } = priceFixture({
    floor_price: 29.9,
    price_display: "R$ 29,90",
  });
  const newer = structuredClone(source);
  newer.captured_at = "2026-10-22T11:00:00Z";
  newer.decoded[0].data.list[0].product.floor_price = 2990;
  sources.set("newer", newer);
  let facts = scoutingProductFacts({ product_id: "456" }, sources, "BR");
  assert.equal(facts.floor_price, undefined);
  assert.equal(facts.unverified_floor_price.invocation_id, "newer");
  newer.decoded[0].data.list[0].product.floor_price = 29.9;
  facts = scoutingProductFacts({ product_id: "456" }, sources, "BR");
  assert.equal(facts.floor_price.value, 29.9);
  assert.equal(facts.unverified_floor_price, undefined);
});
