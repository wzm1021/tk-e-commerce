import test from "node:test";
import assert from "node:assert/strict";
import { scoutingProductFacts } from "../src/reports/scouting-facts.mjs";
import { applyScoutingPolicy } from "../src/reports/scouting-policy.mjs";
import { renderReport, pointer } from "../src/reports/reports.mjs";
import { rerenderScoutingReport } from "../scripts/rerender-report.mjs";

const request = {
  market: "US",
  category: "收纳",
  minimum_rating: 4.2,
  lookback_days: 28,
  minimum_orders_7d: 100,
  strategies: ["A", "B"],
  candidate_count: 1,
};
function fixture() {
  const candidate = {
    product_id: "123",
    title: "Storage",
    reason: "draft",
    evidence: [],
    limitations: [],
    strategy_a: "passed",
    strategy_b: "passed",
    decision: "shortlist",
  };
  const source = {
    source: "FastMoss",
    tool: "product_search",
    captured_at: "2026-09-12T07:47:43Z",
    decoded: [
      {
        data: {
          list: [
            {
              product: {
                product_id: "123",
                region: "US",
                floor_price: 29.99,
                ceiling_price: 130.99,
                currency_code: "USD",
                product_rating: 4.5,
                sku_count: 30,
                commission_rate_percent: 10,
                is_free_shipping: true,
                is_cross_border: false,
                launch_time: 1770084297,
                category: { l3: { name: "Storage Boxes" } },
              },
              sales_summary: {
                last_7d_units_sold: 1577,
                last_28d_units_sold: 6408,
                total_units_sold: 18014,
                total_gmv: 769423,
              },
              shop: {
                shop_name: "ONAIL HOME",
                product_rating: 1,
                total_units_sold: 157614,
              },
              distribution_summary: {
                linked_creator_count: 410,
                linked_video_count: 707,
              },
            },
          ],
        },
      },
    ],
  };
  const sources = new Map([["search", source]]);
  const result = {
    status: "partial",
    summary: "draft",
    sections: [],
    questions: [],
    next_actions: [],
    limitations: ["collection gap"],
    candidates: [candidate],
  };
  return { candidate, source, sources, result };
}

test("search snapshot supplies product facts, not shop metrics, with resolvable citations", () => {
  const { candidate, sources } = fixture();
  const facts = scoutingProductFacts(candidate, sources, "US");
  assert.equal(facts.product_rating.value, 4.5);
  assert.equal(facts.total_units_sold.value, 18014);
  assert.equal(facts.shop_name.value, "ONAIL HOME");
  assert.equal(facts.is_cross_border.value, false);
  assert.equal(facts.review_count, undefined);
  for (const f of Object.values(facts))
    assert.deepEqual(pointer(sources.get(f.invocation_id), f.pointer), f.value);
  assert.deepEqual(
    scoutingProductFacts({ product_id: "different" }, sources, "US"),
    {},
  );
  assert.deepEqual(scoutingProductFacts(candidate, sources, "GB"), {});
});

test("newest matching snapshot wins; price bounds/currency stay in one snapshot and invalid values stay unknown", () => {
  const { candidate, sources, source } = fixture();
  const newer = {
    source: "FastMoss",
    tool: "product_detail_info",
    captured_at: "2026-09-12T08:00:00Z",
    request: { filter: { product_id: "123" } },
    decoded: [
      {
        data: {
          product: { product_rating: 4.8, floor_price: 25, review_count: 0 },
          shop: { total_units_sold: 999 },
        },
      },
    ],
  };
  sources.set("detail", newer);
  let facts = scoutingProductFacts(
    candidate,
    new Map([...sources].reverse()),
    "US",
  );
  assert.equal(facts.product_rating.value, 4.8);
  assert.equal(facts.review_count.value, 0);
  assert.equal(facts.floor_price.value, 25);
  assert.equal(facts.ceiling_price, undefined);
  assert.equal(facts.currency_code, undefined);
  assert.equal(facts.total_units_sold.value, 18014);
  newer.decoded[0].data.product.product_id = "other";
  assert.equal(
    scoutingProductFacts(candidate, sources, "US").product_rating.value,
    4.5,
  );
  const p = source.decoded[0].data.list[0].product;
  Object.assign(p, {
    product_rating: 8,
    floor_price: null,
    review_count: null,
    commission_rate_percent: 101,
    stock_count: -1,
    sku_count: "",
  });
  facts = scoutingProductFacts(candidate, sources, "US");
  for (const key of [
    "product_rating",
    "floor_price",
    "review_count",
    "commission_rate_percent",
    "stock_count",
    "sku_count",
  ])
    assert.equal(facts[key], undefined);
});

test("model opportunity reasons survive rule checks and historical rerender", () => {
  const {sources, result} = fixture();
  result.candidates[0].reason = "逐品模型判断：销量回落，先测试尺寸差异";
  const checked = applyScoutingPolicy(result, request, sources, "2026-09-12T07:46:00Z");
  assert.equal(checked.candidates[0].reason, result.candidates[0].reason);
  assert.ok(checked.candidates[0].assessment_summary.includes("市场机会"));
  const historical = structuredClone(checked);
  historical.candidates[0].reason = "旧版统一规则提示";
  const rerendered = applyScoutingPolicy(historical, request, sources, "2026-09-12T07:46:00Z");
  assert.equal(rerendered.candidates[0].reason, result.candidates[0].reason);
  assert.equal(rerendered.candidates[0].decision, checked.candidates[0].decision);
});

test("report and candidate JSON gain price, rating and sales while preserving source periods and decision gates", () => {
  const { sources, result } = fixture();
  const enriched = applyScoutingPolicy(
      result,
      request,
      sources,
      "2026-09-12T07:46:00Z",
    ),
    c = enriched.candidates[0];
  assert.equal(c.price, 29.99);
  assert.equal(c.price_max, 130.99);
  assert.equal(c.rating, 4.5);
  assert.equal(c.assessment.A.criteria[3].status, "passed");
  assert.equal(c.assessment.B.criteria[0].status, "failed");
  assert.equal(c.assessment.B.criteria[1].status, "unverified");
  assert.equal(c.decision, "watch");
  assert.equal(
    applyScoutingPolicy(enriched, request, sources, "2026-09-12T07:46:00Z")
      .model_draft,
    enriched.model_draft,
  );
  const html = renderReport(enriched, { kind: "scouting", request, sources });
  for (const text of [
    "USD 29.99 – 130.99",
    "4.5",
    "1,577 件",
    "6,408 件",
    "18,014 件",
    "USD 769,423",
    "ONAIL HOME",
    "Storage Boxes",
    "10 %",
    "2026-09-12 07:47:43 UTC",
    "来源滚动周期",
    "贡献利润率</dt><dd>待核验",
  ])
    assert.ok(html.includes(text), text);
  assert.ok(!html.includes("157,614"));
  assert.ok(!html.includes("部分引用无法与本次归档来源对应"));
});

test("rerender revises HTML and candidates together, keeps immutable originals and never changes billing or job result", async () => {
  const { result, sources } = fixture();
  const job = {
    id: "job",
    kind: "scouting",
    title: "Test",
    result,
    request,
    snapshot: { created_at: "2026-09-12T07:46:00Z", skill: { version: 3 } },
  };
  const report = {
    id: "report",
    created_by: "actor",
    data: {
      source_kind: "fastmoss_agent_research",
      job_id: "job",
      artifact_id: "old-html",
      candidates_artifact_id: "old-json",
    },
  };
  const bytes = new Map([
      ["source", Buffer.from(JSON.stringify(sources.get("search")))],
    ]),
    writes = [];
  const store = {
    read: async (key) => bytes.get(key),
    put: async (wid, buf) => {
      const key = "blob-" + bytes.size;
      bytes.set(key, buf);
      return { object_key: key, sha256: key, size_bytes: buf.length };
    },
  };
  const c = {
    query: async (sql, args) => {
      if (sql.startsWith("SELECT * FROM records")) return { rows: [report] };
      if (sql.startsWith("SELECT * FROM jobs")) return { rows: [job] };
      if (sql.startsWith("SELECT i.id"))
        return { rows: [{ id: "search", object_key: "source" }] };
      writes.push({ sql, args });
      if (sql.startsWith("INSERT INTO artifacts"))
        return { rows: [{ id: args[0], object_key: args[2] }] };
      return { rows: [] };
    },
  };
  const db = {
    tenant: async (wid, fn) => {
      assert.equal(wid, "workspace");
      return fn(c);
    },
  };
  await rerenderScoutingReport(db, store, "workspace", "report");
  const updated = writes.find((w) => w.sql.startsWith("UPDATE records"))
    .args[1];
  assert.notEqual(updated.artifact_id, "old-html");
  assert.notEqual(updated.candidates_artifact_id, "old-json");
  assert.deepEqual(updated.previous_artifact_ids, ["old-html"]);
  assert.deepEqual(updated.previous_candidates_artifact_ids, ["old-json"]);
  assert.equal(result.candidates[0].price, undefined);
  assert.ok(
    writes.every(
      (w) =>
        !w.sql.startsWith("UPDATE jobs") &&
        !/wallet|ledger|invocations/.test(w.sql),
    ),
  );
  const savedCandidates = [...bytes.values()]
    .map((b) => b.toString())
    .find((s) => s.startsWith("[{"));
  assert.equal(JSON.parse(savedCandidates)[0].rating, 4.5);
});

test("completed research is distinct from unresolved product gates and never promotes interrupted or short research", () => {
  const { result, sources } = fixture();
  result.status = "complete";
  const done = applyScoutingPolicy(
    result,
    request,
    sources,
    "2026-09-12T08:00:00Z",
  );
  assert.equal(done.status, "complete");
  assert.equal(done.candidates[0].decision, "watch");
  assert.equal(done.model_draft.status, "complete");
  assert.ok(done.limitations.some((x) => x.includes("逐项证据")));
  for (const changed of [
    { status: "partial" },
    { recovery: { reason: "task_budget_exhausted" } },
    { candidates: [] },
  ]) {
    assert.equal(
      applyScoutingPolicy(
        { ...result, ...changed },
        request,
        sources,
        "2026-09-12T08:00:00Z",
      ).status,
      "partial",
    );
  }
  assert.equal(
    applyScoutingPolicy(
      { ...result, status: "waiting_input" },
      request,
      sources,
      "2026-09-12T08:00:00Z",
    ).status,
    "waiting_input",
  );
});
