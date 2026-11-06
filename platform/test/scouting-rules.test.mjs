import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRequest } from "../src/research/requests.mjs";
import { applyScoutingPolicy } from "../src/reports/scouting-policy.mjs";
import { renderScoutingReport } from "../src/reports/scouting-report.mjs";
import { ResultSchema } from "../src/reports/reports.mjs";

const request = normalizeRequest("scouting", {
  category: "浴室用品",
  candidate_count: 1,
  selection_rules:
    "优先评分 4.9 以上的新品，允许有差异化的老品。\n<script>规则是用户文本</script>",
});
const invocation = "e4b5b72c-a14a-4cba-a461-f8bdcc159b7c";
const sources = new Map([
  [
    invocation,
    {
      source: "FastMoss",
      tool: "product_detail_info",
      request: { filter: { product_id: "item-1" } },
      decoded: [
        {
          data: {
            product: {
              product_id: "item-1",
              product_rating: 3.9,
              launch_time: 1600000000,
            },
          },
        },
      ],
    },
  ],
]);
const draft = {
  status: "complete",
  summary: "老品仍有差异化机会，建议小测。",
  sections: [
    {
      title: "机会与局限",
      body: "评分不达预期但有差异化；缺少成本与订单数据。",
      kind: "inferred",
      evidence_ids: [invocation],
    },
  ],
  candidates: [
    {
      product_id: "item-1",
      title: "浴室收纳",
      image: null,
      tk_url: null,
      decision: "shortlist",
      reason: "结构有差异，建议先验证买家接受度。",
      limitations: ["成本未知"],
      evidence: [],
    },
  ],
  limitations: ["订单数未知"],
  questions: [],
  next_actions: [{ title: "买样测试", reason: "核对结构" }],
};
test("free-text rules preserve model decisions and narrative despite low ratings, old launches and missing metrics", () => {
  const parsed = ResultSchema.parse(draft);
  const result = applyScoutingPolicy(
    parsed,
    request,
    sources,
    "2026-09-14T00:00:00Z",
  );
  assert.equal(result.status, "complete");
  for (const key of [
    "summary",
    "sections",
    "limitations",
    "questions",
    "next_actions",
  ])
    assert.deepEqual(result[key], draft[key]);
  const c = result.candidates[0];
  assert.equal(c.decision, "shortlist");
  assert.equal(c.reason, draft.candidates[0].reason);
  assert.deepEqual(c.limitations, ["成本未知"]);
  assert.equal(c.rating, 3.9);
  assert.equal(c.assessment.mode, "user_rules");
  assert.equal(c.assessment.A, undefined);
  assert.equal(c.strategy_a, undefined);
  const html = renderScoutingReport(result, { request, sources });
  assert.ok(html.includes(draft.sections[0].body));
  assert.ok(html.includes("优先研究"));
  assert.ok(html.includes("&lt;script&gt;规则是用户文本&lt;/script&gt;"));
  for (const forbidden of [
    "STRATEGY A",
    "A · 待核验",
    "查看逐项条件",
    "市场 GMV 门槛",
    "规则核验与证据缺口",
    "<script>",
  ])
    assert.ok(!html.includes(forbidden), forbidden);
  assert.ok(html.includes("来源评分 / 5</dt><dd>3.9"));
  c.assessment.facts.product_rating.value = 999;
  assert.ok(
    !renderScoutingReport(result, { request, sources }).includes(">999<"),
  );
});
test("user rules never turn interrupted or under-delivered research into complete", () => {
  for (const input of [
    { ...draft, status: "partial" },
    { ...draft, recovery: { reason: "interrupted" } },
    { ...draft, candidates: [] },
  ]) {
    assert.equal(
      applyScoutingPolicy(input, request, sources, "2026-09-14T00:00:00Z")
        .status,
      "partial",
    );
  }
});
test("empty rules add no default thresholds; legacy client preferences convert to guidance", () => {
  const empty = normalizeRequest("scouting", { category: "浴室用品" });
  assert.equal(empty.selection_rules, "");
  assert.ok(!Object.hasOwn(empty, "minimum_rating"));
  const legacy = normalizeRequest("scouting", {
    category: "浴室用品",
    strategies: ["B"],
    minimum_orders_7d: 300,
    lookback_days: 14,
  });
  assert.match(legacy.selection_rules, /300/);
  assert.match(legacy.selection_rules, /14/);
  assert.ok(!legacy.selection_rules.includes("市场机会"));
  assert.equal(legacy.strategies, undefined);
  assert.throws(() =>
    normalizeRequest("scouting", {
      ...empty,
      selection_rules: "a".repeat(6001),
    }),
  );
  assert.throws(() =>
    normalizeRequest("scouting", { ...empty, selection_rules: 42 }),
  );
});
