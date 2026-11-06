import test from "node:test";
import assert from "node:assert/strict";
import { reusableResponse } from "../src/data/data-cache.mjs";
import { normalizeRequest } from "../src/research/requests.mjs";
import { freezeTask } from "../src/research/jobs.mjs";
import {
  sellerSpriteTools,
  dataToolsForJob,
} from "../src/data/sellersprite.mjs";
import {
  amazonFacts,
  amazonCurrency,
  assessAmazonScouting,
  recoverAmazonDraft,
  renderAmazonReport,
  amazonProductUrl,
} from "../src/reports/amazon-scouting.mjs";
import { ResultSchema } from "../src/reports/reports.mjs";
import { projectBundle } from "../src/skills/skills.mjs";
import { analyzeAmazon } from "../../skills/amazon-product-scouting/scripts/analyze.mjs";
import { PLATFORMS } from "../src/common/platforms.mjs";
import { PLATFORMS as UI_PLATFORMS } from "../web/lib/platforms.mjs";
import {
  researchPrompt,
  scoutingReviewPrompt,
} from "../src/agent/research-prompt.mjs";
const tool = {
  name: "product_research",
  description: "Products",
  inputSchema: {
    type: "object",
    properties: { market: { type: "string" } },
    required: ["market"],
    additionalProperties: false,
  },
};
const invocation = "e4b5b72c-a14a-4cba-a461-f8bdcc159b7c";
const request = normalizeRequest("scouting", {
  platform: "amazon",
  market: "DE",
  category: "浴室收纳",
  candidate_count: 1,
});
const source = (rows, extra = {}) => ({
  source: "SellerSprite",
  captured_at: "2026-09-20T00:00:00Z",
  result: {
    content: [
      { type: "text", text: JSON.stringify({ data: { items: rows } }) },
    ],
  },
  decoded: [{ content_index: 0, data: { data: { items: rows } } }],
  ...extra,
});
const products = [
  {
    asin: "B012345678",
    parentAsin: "B000000001",
    title: "浴室架 <script>alert(1)</script>",
    monthlySales: 0,
    price: 25,
    currency: "EUR",
    rating: 4.3,
  },
  {
    asin: "B012345679",
    parentAsin: "B000000001",
    title: "同父体变体",
    monthlySales: 100,
    price: 30,
    currency: "EUR",
  },
];
const sources = new Map([[invocation, source(products)]]);
const analysis = {
  summary: "需要验证趋势",
  evidence_ids: [invocation],
  limitations: [],
};
const candidate = (id) => ({
  product_id: id,
  title: "浴室架",
  tk_url: null,
  product_url: null,
  image: null,
  decision: "watch",
  reason: "验证差异化",
  evidence: [],
  limitations: [],
  research: {
    growth: analysis,
    competition: analysis,
    reputation: analysis,
    test_plan: {
      summary: "买样",
      rationale: "验证耐用性",
      assumptions: ["费用待报价"],
      evidence_ids: [invocation],
    },
    links: [],
  },
});
const draft = {
  status: "complete",
  summary: "观察候选",
  sections: [],
  questions: [],
  next_actions: [],
  limitations: [],
  candidates: products.map((p) => candidate(p.asin)),
};

test("platform request validation preserves legacy TK and rejects incompatible Amazon requests", () => {
  assert.equal(
    normalizeRequest("scouting", { category: "浴室收纳" }).lookback_days,
    28,
  );
  assert.equal(request.lookback_days, 30);
  assert.deepEqual(PLATFORMS, UI_PLATFORMS);
  for (const body of [
    { platform: "amazon", market: "TH" },
    { platform: "amazon", lookback_days: 7 },
    { platform: "ebay" },
    { platform: "tiktok", market: "DE" },
  ])
    assert.throws(() =>
      normalizeRequest("scouting", { category: "浴室收纳", ...body }),
    );
  assert.throws(() =>
    normalizeRequest("competitor", {
      platform: "amazon",
      target: "B012345678",
      question: "分析竞品",
    }),
  );
});
test("SellerSprite catalog keeps reviewed read-only tools and requires a real object schema", () => {
  assert.deepEqual(
    sellerSpriteTools([tool, { ...tool, name: "delete_account" }]),
    [tool],
  );
  assert.throws(() => sellerSpriteTools([{ ...tool, inputSchema: null }]));
  assert.throws(() => sellerSpriteTools([{ ...tool, name: "review" }]));
  assert.throws(() => sellerSpriteTools([tool, tool]));
  assert.deepEqual(
    sellerSpriteTools([
      tool,
      { name: "secret_expired" },
      { name: "secret_invalid" },
    ]),
    [tool],
  );
  assert.throws(
    () =>
      sellerSpriteTools([
        { name: "secret_expired", inputSchema: { type: "object" } },
      ]),
    { code: "sellersprite_secret_expired" },
  );
  const j = {
    request: { platform: "amazon" },
    snapshot: { data: { kind: "sellersprite", tools: [tool] } },
  };
  assert.deepEqual(dataToolsForJob(j, [{ name: "product_detail_info" }]), [
    tool,
  ]);
  assert.throws(() =>
    dataToolsForJob(
      { ...j, snapshot: { data: { kind: "fastmoss", tools: [tool] } } },
      [],
    ),
  );
  assert.deepEqual(
    dataToolsForJob({ ...j, snapshot: { data: null } }, [tool]),
    [],
  );
});
test("task freeze selects Amazon skill and source, never falls back to FastMoss", async () => {
  let skillId;
  const conn = [
    { kind: "model", id: "model", config: { model: "test" }, price: {} },
    { kind: "fastmoss", id: "tk" },
    { kind: "sellersprite", id: "az", validation: { tools: [tool] } },
  ];
  const c = {
    query: async (sql, args) =>
      sql.includes("skill_bindings")
        ? ((skillId = args[0]), { rows: [{ skill_id: skillId }] })
        : { rows: conn },
  };
  const out = await freezeTask(c, "space", { kind: "scouting", request });
  assert.equal(skillId, "amazon-product-scouting");
  assert.equal(out.snapshot.data.id, "az");
  assert.deepEqual(out.snapshot.data.tools, [tool]);
  conn.pop();
  assert.deepEqual(
    (await freezeTask(c, "space", { kind: "scouting", request })).missing,
    ["sellersprite"],
  );
  const old = await freezeTask(c, "space", { kind: "scouting", request: {} });
  assert.equal(old.snapshot.data.id, "tk");
  assert.equal(skillId, "tiktok-product-scouting");
});
test("Amazon facts preserve exact source paths, zero and unknowns; discard cross-source/errors/site mismatch", () => {
  assert.equal(
    amazonFacts(
      new Map([[invocation, source([{ ...products[0], marketplace: "UK" }])]]),
      "GB",
    ).size,
    1,
  );
  const facts = amazonFacts(sources, "DE");
  assert.equal(facts.get("B012345678").estimated_units_30d.value, 0);
  assert.equal(
    facts.get("B012345678").estimated_units_30d.pointer,
    "/decoded/0/data/data/items/0/monthlySales",
  );
  assert.equal(facts.get("B012345678").estimated_revenue_30d, undefined);
  for (const extra of [{ source: "FastMoss" }, { result: { isError: true } }])
    assert.equal(
      amazonFacts(new Map([[invocation, source(products, extra)]]), "DE").size,
      0,
    );
  assert.equal(
    amazonFacts(
      new Map([[invocation, source([{ ...products[0], marketplace: "US" }])]]),
      "DE",
    ).size,
    0,
  );
});
test("candidate identity, safe site link, parent dedup and partial recovery are deterministic", () => {
  const result = assessAmazonScouting(
    ResultSchema.parse(draft),
    request,
    sources,
  );
  assert.equal(result.candidates.length, 1);
  assert.equal(
    result.candidates[0].product_url,
    "https://www.amazon.de/dp/B012345678",
  );
  assert.equal(result.candidates[0].tk_url, null);
  assert.throws(() =>
    assessAmazonScouting(
      { ...draft, candidates: [candidate("B999999999")] },
      request,
      sources,
    ),
  );
  const recovered = assessAmazonScouting(
    recoverAmazonDraft(request, sources),
    request,
    sources,
  );
  assert.equal(recovered.status, "partial");
  assert.equal(recovered.candidates.length, 1);
  assert.equal(recoverAmazonDraft(request, new Map()), null);
  assert.throws(() => amazonProductUrl("US", "javascript:alert(1)"));
});
test("Amazon report uses monthly estimate units, escapes source markup and keeps provenance", () => {
  const result = assessAmazonScouting(
    ResultSchema.parse(draft),
    request,
    sources,
  );
  const html = renderAmazonReport(result, {
    title: "测试",
    sources,
    request,
    created_at: "2026-09-20",
  });
  assert.match(html, /月销量（估算）/);
  assert.match(html, /amazon.de\/dp/);
  assert.match(html, /B012345678/);
  assert.match(html, new RegExp(invocation));
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /7 日销量/);
});
test("relative scoring does not replace missing metrics with zero or merge distinct site/currency/period cohorts", () => {
  const input = products.map((p, i) => ({
    asin: p.asin,
    parent_asin: p.parentAsin,
    marketplace: "DE",
    currency: "EUR",
    period: "2026-08",
    estimated_units_30d: i ? 100 : 0,
    price: p.price,
    brand: "A",
  }));
  input.push({
    asin: "B111111111",
    marketplace: "US",
    currency: "USD",
    period: "2026-08",
    estimated_units_30d: 200,
    bsr: 5,
  });
  const result = analyzeAmazon(input);
  assert.equal(result.length, 2);
  assert.equal(result[0].unique_parent_count, 1);
  assert.equal(result[0].ranked[0].score, null);
  assert.equal(result[1].ranked[0].available_components, 2);
  assert.equal(result[1].brand_top3_sample_share, null);
});
test("Amazon pinned skill bundle is self-contained and excludes FastMoss registry", async () => {
  const bundle = await projectBundle(
    new URL("../../", import.meta.url).pathname,
    "amazon-product-scouting",
  );
  assert.ok(bundle.files["docs/amazon-integration-contract.md"]);
  assert.ok(bundle.files["skills/amazon-product-scouting/scripts/analyze.mjs"]);
  assert.equal(bundle.files["schemas/fastmoss-tools.snapshot.json"], undefined);
  const prompt = researchPrompt({
    kind: "scouting",
    request,
    snapshot: { skill: { skill_id: "amazon-product-scouting" } },
  });
  assert.match(prompt, /sellersprite_catalog/);
  assert.doesNotMatch(scoutingReviewPrompt("amazon"), /视频/);
});

test("gateway routes expose only pinned platform tools and reject wrong tool/schema before spending", async () => {
  const { default: Fastify } = await import("fastify");
  const { installGateway } = await import("../src/data/gateway.mjs");
  const scope = {
    workspace_id: "space",
    job_id: "job",
    fence: 1,
    worker_id: "worker",
  };
  const job = {
    id: "job",
    created_by: "user",
    kind: "scouting",
    status: "running",
    fence: 1,
    worker_id: "worker",
    lease_valid: true,
    request,
    snapshot: {
      data: {
        id: "az",
        kind: "sellersprite",
        tools: [tool],
        config: { endpoint: "https://mcp.sellersprite.com/mcp" },
      },
    },
  };
  const queries = [];
  const c = {
    query: async (sql) => {
      queries.push(sql);
      if (sql.includes("FROM jobs")) return { rows: [job] };
      if (sql.includes("FROM workspaces"))
        return {
          rows: [
            { enabled: true, user_enabled: true, subscription_required: false },
          ],
        };
      if (sql.includes("FROM connections"))
        return {
          rows: [{ kind: "sellersprite", config: job.snapshot.data.config }],
        };
      throw new Error("Unexpected database work before authorization: " + sql);
    },
  };
  const app = Fastify();
  app.decorate("jobAuth", async (req) => {
    req.jobScope = scope;
  });
  app.decorate("admin", async () => {});
  app.setErrorHandler((e, req, reply) =>
    reply.code(e.status || 400).send({ error: e.code || e.message }),
  );
  await installGateway(
    app,
    {
      tenant: async (w, fn) => {
        assert.equal(w, "space");
        return fn(c);
      },
    },
    {},
    {},
    new URL("../../", import.meta.url).pathname,
    { dataRpc: async () => assert.fail("must not spend provider calls") },
  );
  try {
    const catalog = await app.inject({
      method: "GET",
      url: "/internal/job/tools",
    });
    assert.deepEqual(catalog.json().tools, [{ ...tool, billing: { live_points: 1, snapshot_points: 0.3 } }]);
    const wrong = await app.inject({
      method: "POST",
      url: "/internal/job/data",
      payload: { name: "product_detail_info", arguments: {} },
    });
    assert.equal(wrong.statusCode, 403);
    assert.equal(wrong.json().error, "data_tool_forbidden");
    const invalid = await app.inject({
      method: "POST",
      url: "/internal/job/data",
      payload: { name: "product_research", arguments: { unknown: 1 } },
    });
    assert.equal(invalid.json().error, "data_input_invalid");
    assert.ok(
      queries.every(
        (sql) => !sql.includes("INSERT") && !sql.includes("UPDATE wallets"),
      ),
    );
  } finally {
    await app.close();
  }
});

test("live SellerSprite list aliases retain monthly metric provenance without reinterpreting other tools", () => {
  const row = {
    asin: "B0F1MY38VR",
    parent: "B0GWMFKN2S",
    units: 11321,
    revenue: 113096.79,
    ratings: 2091,
    sellers: 1,
    price: 9.99,
    rating: 4.7,
    unitsGr: 13.33,
  };
  const live = source([row], { tool: "product_research" });
  const fact = amazonFacts(new Map([[invocation, live]]), "US").get(row.asin);
  assert.equal(fact.currency, undefined);
  assert.equal(amazonCurrency(fact, "US"), "USD");
  assert.equal(amazonCurrency(fact, "GB"), null);
  assert.equal(
    amazonCurrency(
      {
        ...fact,
        currency: { value: "EUR", invocation_id: fact.price.invocation_id },
      },
      "US",
    ),
    "EUR",
  );
  assert.equal(fact.parent_asin.value, row.parent);
  assert.equal(fact.estimated_units_30d.value, 11321);
  assert.equal(
    fact.estimated_units_30d.pointer,
    "/decoded/0/data/data/items/0/units",
  );
  assert.equal(fact.estimated_revenue_30d.value, 113096.79);
  assert.equal(fact.rating_count.value, 2091);
  assert.equal(fact.seller_count.value, 1);
  assert.equal(fact.sales_growth.value, 13.33);
  const other = amazonFacts(
    new Map([[invocation, { ...live, tool: "asin_sales_trend" }]]),
    "US",
  ).get(row.asin);
  assert.equal(other.estimated_units_30d, undefined);
  assert.equal(other.estimated_revenue_30d, undefined);
  const sibling = { ...row, asin: "B012345678" };
  const deduped = assessAmazonScouting(
    { ...draft, candidates: [candidate(row.asin), candidate(sibling.asin)] },
    { ...request, market: "US" },
    new Map([
      [invocation, source([row, sibling], { tool: "product_research" })],
    ]),
  );
  assert.equal(deduped.candidates[0].price_currency, "USD");
  const shown = renderAmazonReport(deduped, {
    request: { ...request, market: "US" },
    sources: new Map([[invocation, live]]),
  });
  assert.match(shown, /9\.99 USD/);
  assert.match(shown, /113,096\.79 USD/);
  assert.equal(deduped.candidates.length, 1);
});

test("SellerSprite OK success envelopes are valid facts/cache candidates only for their source", () => {
  const row = { asin: "B0F1MY38VR", units: 11321 };
  const result = {
    isError: false,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          code: "OK",
          message: "成功",
          data: { items: [row] },
        }),
      },
    ],
  };
  assert.equal(reusableResponse(result, "SellerSprite"), true);
  assert.equal(reusableResponse(result, "FastMoss"), false);
  const envelope = source([row], { tool: "product_research", result });
  assert.equal(
    amazonFacts(new Map([[invocation, envelope]]), "US").get(row.asin)
      .estimated_units_30d.value,
    11321,
  );
  for (const code of ["secret_expired", "UNAUTHORIZED", 500]) {
    const bad = {
      ...result,
      content: [
        {
          type: "text",
          text: JSON.stringify({ code, data: { items: [row] } }),
        },
      ],
    };
    assert.equal(reusableResponse(bad, "SellerSprite"), false);
    assert.equal(
      amazonFacts(new Map([[invocation, { ...envelope, result: bad }]]), "US")
        .size,
      0,
    );
  }
  assert.equal(
    reusableResponse({ ...result, isError: true }, "SellerSprite"),
    false,
  );
});
