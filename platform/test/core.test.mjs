import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  micro,
  cny,
  charges,
  callBound,
  modelCallBudget,
  serializedRequestTokenBound,
  researchAutoCompactLimit,
  passwordHash,
  verifyPassword,
  id,
  digest,
  PriceSchema,
} from "../src/common/core.mjs";
import { signJob, verifyJob } from "../src/research/jobs.mjs";
import { SecretStore, LocalStore } from "../src/infra/storage.mjs";
import { validateBundle, projectBundle } from "../src/skills/skills.mjs";
import { publicAddress, checkedEndpoint } from "../src/infra/network.mjs";
import {
  pointer,
  renderReport,
  ResultSchema,
} from "../src/reports/reports.mjs";
import {
  normalizeRequest,
  normalizeTikTokLinks,
} from "../src/research/requests.mjs";
import { parseEvidenceJson, decodeMcpContent } from "../src/data/evidence.mjs";
import {
  responseEventStream,
  clientToolsOnly,
  adaptClientTools,
} from "../src/data/responses.mjs";
import { agentTask } from "../src/research/agent-task.mjs";
import {
  assessCandidate,
  applyScoutingPolicy,
  ensureScoutingCandidates,
} from "../src/reports/scouting-policy.mjs";
import { calculateEconomics } from "../../skills/tiktok-unit-economics/scripts/calculate.mjs";
const card = PriceSchema.parse({
  currency: "USD",
  fx: "7",
  market: {
    input: "1.26",
    output: "3.96",
    cache_read: "0.23",
    cache_write: "0.23",
  },
  procurement_discount: "1",
  sale_discount: "1.5",
  max_context_tokens: 64000,
  max_output_tokens: 4096,
  note: "实际采购报价，1.5 倍销售",
});
test("serialized model requests are bounded in tokens rather than raw UTF-8 bytes", () => {
  const ascii = { input: "x".repeat(60000), tools: [] };
  const chinese = { input: "收纳".repeat(10000), tools: [] };
  assert.ok(Buffer.byteLength(JSON.stringify(ascii)) > 56000);
  assert.ok(serializedRequestTokenBound(ascii) < 30000);
  assert.ok(serializedRequestTokenBound(chinese) >= 28000);
  assert.equal(
    serializedRequestTokenBound({ input: "ok" }, 0),
    Math.ceil(Buffer.byteLength(JSON.stringify({ input: "ok" })) / 3),
  );
  assert.throws(() => serializedRequestTokenBound({}, -1));
});
test("research auto-compaction leaves one bounded provider reserve", () => {
  assert.equal(researchAutoCompactLimit(64000), 48000);
  assert.equal(researchAutoCompactLimit(128000), 100000);
  assert.equal(researchAutoCompactLimit(256000), 230400);
  assert.equal(researchAutoCompactLimit(32000), 16000);
  assert.equal(researchAutoCompactLimit(8192), 1024);
  assert.equal(researchAutoCompactLimit(1000000), 900000);
  assert.equal(researchAutoCompactLimit(1000000, 360000), 600000);
  assert.throws(() => researchAutoCompactLimit(1000));
});
test("Codex MCP namespaces allow only client tools and reject hosted tools inside groups", () => {
  const group = (tools) => [{ type: "namespace", name: "fastmoss", tools }];
  assert.equal(
    clientToolsOnly(group([{ type: "function", name: "fastmoss_call" }])),
    true,
  );
  assert.equal(
    clientToolsOnly([{ type: "custom", name: "apply_patch" }]),
    true,
  );
  for (const type of [
    "web_search",
    "mcp",
    "file_search",
    "computer",
    "namespace",
  ])
    assert.equal(clientToolsOnly(group([{ type }])), false);
  assert.equal(clientToolsOnly([{ type: "web_search" }]), false);
  assert.equal(clientToolsOnly([null]), false);
});
test("provider tool adaptation round-trips namespaces without changing call IDs or evidence arguments", () => {
  const group = (name) => ({
    type: "namespace",
    name,
    tools: [
      { type: "function", name: "fetch", parameters: { type: "object" } },
    ],
  });
  const body = {
    tools: [
      group("fastmoss"),
      group("other"),
      { type: "function", name: "exec_command" },
    ],
    input: [
      {
        type: "function_call",
        namespace: "fastmoss",
        name: "fetch",
        call_id: "c1",
        arguments: '{"product_id":"1732563767390343216"}',
      },
    ],
    tool_choice: { type: "function", namespace: "fastmoss", name: "fetch" },
  };
  const a = adaptClientTools(body),
    fn = a.request.tools[0].name;
  assert.notEqual(fn, a.request.tools[1].name);
  assert.equal(a.request.input[0].name, fn);
  assert.equal(a.request.input[0].namespace, undefined);
  assert.equal(a.request.tool_choice.name, fn);
  assert.equal(body.input[0].namespace, "fastmoss");
  const response = a.restore({
    usage: { input_tokens: 123, output_tokens: 4 },
    output: [{ ...a.request.input[0], status: "completed" }],
  });
  assert.equal(response.output[0].namespace, "fastmoss");
  assert.equal(response.output[0].name, "fetch");
  assert.equal(response.output[0].call_id, "c1");
  assert.equal(response.output[0].arguments, body.input[0].arguments);
  assert.equal(response.usage.input_tokens, 123);
  assert.throws(() =>
    adaptClientTools({ input: [], tools: [group("x"), group("x")] }),
  );
});
test("money preserves micros and rejects excess precision and negatives", () => {
  assert.equal(micro("1.234567"), 1234567n);
  assert.equal(cny(1234567n), "1.234567");
  assert.throws(() => micro("0.0000001"));
  assert.throws(() => micro("-1"));
});
test("scouting rules cannot substitute lifetime GMV for market size or units for orders", () => {
  const request = {
    category: "家居",
    candidate_count: 1,
    market: "US",
    minimum_rating: 4.2,
    minimum_orders_7d: 100,
    strategies: ["A", "B"],
    lookback_days: 28,
  };
  const productId = "1732563767390343216",
    invocationId = id();
  const sources = new Map([
    [
      invocationId,
      {
        source: "FastMoss",
        tool: "product_detail_info",
        request: { filter: { product_id: productId } },
        decoded: [
          {
            data: {
              product: {
                product_id: productId,
                product_rating: 4,
                total_gmv: 99999999,
                total_units_sold: 99999999,
                launch_time: Date.parse("2026-08-20T00:00:00Z") / 1000,
              },
            },
          },
        ],
      },
    ],
  ]);
  const candidate = {
    product_id: productId,
    title: "Test",
    strategy_a: "passed",
    strategy_b: "passed",
    decision: "shortlist",
    evidence: [],
    limitations: [],
  };
  const a = assessCandidate(
    candidate,
    request,
    sources,
    "2026-09-08T00:00:00Z",
  );
  assert.equal(a.A.criteria[0].status, "unverified");
  assert.equal(a.A.status, "failed");
  assert.equal(a.B.criteria[0].status, "passed");
  assert.equal(a.B.criteria[1].status, "unverified");
  assert.equal(a.B.status, "unverified");
  assert.equal(a.decision, "watch");
  const foreign = assessCandidate(
    { ...candidate, product_id: "other" },
    request,
    sources,
    "2026-09-08T00:00:00Z",
  );
  assert.deepEqual(foreign.facts, {});
  const report = applyScoutingPolicy(
    {
      status: "complete",
      summary: "错误地把策略 B 当市场机会",
      sections: [],
      candidates: [candidate],
      questions: [],
      limitations: [],
      next_actions: [],
    },
    request,
    sources,
    "2026-09-08T00:00:00Z",
  );
  assert.ok(!report.summary.includes("错误地"));
  assert.ok(report.model_draft.summary.includes("错误地"));
  assert.equal(report.candidates[0].decision, "watch");
});
test("source-backed ranked products remain watch candidates when hard-gate evidence is missing", () => {
  const invocation = id();
  const source = {
    source: "FastMoss",
    tool: "product_rank_new_listed",
    captured_at: "2026-09-12T00:00:00.000Z",
    decoded: [
      {
        data: {
          list: [
            {
              product_id: "1732585168554660270",
              title: "Bathroom organizer",
              region: "US",
              launch_time: 1788200000,
              cover_url: "https://example.com/item.jpg",
            },
            {
              product_id: "1732606732775166889",
              title: "Storage rack",
              region: "US",
            },
            {
              product_id: "off-shelf",
              title: "Unavailable item",
              region: "US",
              is_off_shelf: true,
            },
          ],
        },
      },
    ],
  };
  const result = ensureScoutingCandidates(
    {
      status: "partial",
      summary: "",
      sections: [],
      candidates: [],
      questions: [],
      limitations: [],
      next_actions: [],
    },
    { market: "US", candidate_count: 2 },
    new Map([[invocation, source]]),
  );
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(
    result.candidates.map((item) => item.decision),
    ["watch", "watch"],
  );
  assert.equal(result.candidates[0].product_id, "1732585168554660270");
  assert.equal(
    result.candidates[0].evidence[0].pointer,
    "/decoded/0/data/list/0/product_id",
  );
  assert.equal(result.candidates[0].evidence[0].value, "1732585168554660270");
  assert.doesNotThrow(() => ResultSchema.parse(result));
});
test("tenant-controlled task files never contain procurement prices or provider routes", () => {
  const task = {
    id: id(),
    kind: "scouting",
    request: { category: "家居" },
    limits: { data_budget: "3" },
    snapshot: {
      skill: {
        skill_id: "tiktok-product-scouting",
        version: 2,
        digest: "digest",
      },
      model: {
        config: {
          model: "glm-5.2",
          endpoint: "https://platform-private.example/responses",
        },
        price: card,
      },
      data: { id: "private-connection" },
    },
  };
  const safe = agentTask(task),
    raw = JSON.stringify(safe);
  assert.equal(safe.snapshot.model.config.model, "glm-5.2");
  assert.deepEqual(safe.data_access, {
    available: true,
    billing: "shared_workspace_balance",
    live_call_points: null,
    live_tool_points: safe.data_access.live_tool_points,
    snapshot_hit_points: 0.3,
  });
  assert.equal(safe.snapshot.model.price.max_context_tokens, 64000);
  assert.equal(Object.hasOwn(safe.snapshot.model.price, "market"), false);
  assert.equal(safe.data_access.live_tool_points.product_detail_info, 1);
  assert.equal(safe.data_access.live_tool_points.creator_rank_top_ecommerce, 3);
  for (const value of [
    "procurement_discount",
    "sale_discount",
    "private-connection",
    "platform-private",
    "cache_read",
  ])
    assert.ok(!raw.includes(value), value);
});
test("input cache is disjoint and output reasoning is not billed twice", () => {
  const r = charges(
    {
      input_tokens: 1000000,
      input_tokens_details: { cached_tokens: 200000 },
      output_tokens: 100000,
      output_tokens_details: { reasoning_tokens: 90000 },
    },
    card,
  );
  assert.equal(r.sale, 15225000n);
  assert.equal(r.procurement, 10150000n);
  assert.deepEqual(r.normalized, {
    input_uncached: 800000,
    cache_read: 200000,
    output_total: 100000,
  });
});
test("unknown or inconsistent usage cannot settle a successful invocation", () => {
  assert.throws(() =>
    charges({ input_tokens: 0, output_tokens: 0, total_tokens: 0 }, card),
  );
  assert.throws(() => charges({ input_tokens: 1 }, card));
  assert.throws(() =>
    charges(
      {
        input_tokens: 1,
        output_tokens: 1,
        input_tokens_details: { cached_tokens: 2 },
      },
      card,
    ),
  );
  assert.throws(() =>
    charges(
      { input_tokens: 1, output_tokens: 1, cache_write_input_tokens: 1 },
      card,
    ),
  );
});
test("buffered response replay preserves tool arguments, final text and exact provider usage", () => {
  const response = {
    id: "resp_fixture",
    status: "completed",
    usage: { input_tokens: 300, output_tokens: 40 },
    output: [
      {
        id: "fc_1",
        type: "function_call",
        call_id: "call_1",
        name: "exec_command",
        arguments: '{"cmd":"echo proof"}',
        status: "completed",
      },
      {
        id: "msg_1",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "完成", annotations: [] }],
      },
    ],
  };
  const events = responseEventStream(response)
    .trim()
    .split("\n\n")
    .map((e) =>
      JSON.parse(
        e
          .split("\n")
          .find((l) => l.startsWith("data:"))
          .slice(5),
      ),
    );
  assert.deepEqual(events.at(-1).response, response);
  assert.equal(
    events.filter((e) => e.type === "response.output_item.done").length,
    2,
  );
  assert.equal(
    events.find((e) => e.type === "response.function_call_arguments.done")
      .arguments,
    response.output[0].arguments,
  );
  assert.equal(
    events.find((e) => e.type === "response.output_text.delta").delta,
    "完成",
  );
  assert.ok(events.every((e, i) => e.sequence_number === i));
  assert.throws(() =>
    responseEventStream({ ...response, status: "in_progress" }),
  );
});
test("reservation bound covers a cache price above the uncached price", () => {
  const unusual = { ...card, market: { ...card.market, cache_read: "12" } };
  assert.ok(
    callBound(unusual) >=
      charges(
        {
          input_tokens: 64000,
          input_tokens_details: { cached_tokens: 64000 },
          output_tokens: 4096,
        },
        unusual,
      ).sale,
  );
});
test("password verifier rejects a wrong password", async () => {
  const encoded = await passwordHash("long-test-password-01");
  assert.ok(await verifyPassword("long-test-password-01", encoded));
  assert.equal(await verifyPassword("different-test-password", encoded), false);
});
test("job tokens reject expiry, alteration, and a different signing key", () => {
  const key = randomBytes(32),
    scope = {
      job_id: id(),
      workspace_id: id(),
      worker_id: "test",
      fence: "1",
      exp: Date.now() + 100000,
    };
  const signed = signJob(key, scope);
  assert.deepEqual(verifyJob(key, signed), scope);
  assert.throws(() => verifyJob(randomBytes(32), signed));
  assert.throws(() => verifyJob(key, signed + "x"));
  assert.throws(() => verifyJob(key, signJob(key, { ...scope, exp: 0 })));
});
test("lease-bound job credentials stay valid beyond elapsed runtime, while legacy expiry is enforced", (t) => {
  const key = randomBytes(32);
  const scope = {
    job_id: id(),
    workspace_id: id(),
    worker_id: "long-research",
    fence: "1",
    lease_bound: true,
  };
  const token = signJob(key, scope);
  const expiry = Date.now() + 2 * 60 * 60 * 1000;
  t.mock.method(Date, "now", () => expiry + 24 * 60 * 60 * 1000);
  assert.deepEqual(verifyJob(key, token), scope);
  assert.throws(() => verifyJob(key, token + "x"));
  assert.throws(() => verifyJob(randomBytes(32), token));
  assert.throws(() => verifyJob(key, signJob(key, { ...scope, exp: expiry })));
  assert.throws(() =>
    verifyJob(key, signJob(key, { ...scope, lease_bound: undefined })),
  );
});
test("network guard rejects private, mapped and link-local endpoints", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.2.1",
    "169.254.169.254",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "100.100.100.200",
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert.ok(publicAddress("8.8.8.8"));
  await assert.rejects(() => checkedEndpoint("http://example.com"));
  await assert.rejects(() =>
    checkedEndpoint("https://example.com/path?api_key=unsafe"),
  );
});
test("encrypted secrets require matching connection context and detect corruption", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tidelab-secret-test-"));
  try {
    const store = new SecretStore(root, randomBytes(32));
    const ref = await store.write(
      "test-secret-not-production",
      "connection-a:version-1",
    );
    assert.equal(
      await store.read(ref, "connection-a:version-1"),
      "test-secret-not-production",
    );
    await assert.rejects(() => store.read(ref, "connection-b:version-1"));
    const p = path.join(root, "secrets", ref),
      raw = JSON.parse(await readFile(p));
    raw.tag = randomBytes(16).toString("base64");
    await writeFile(p, JSON.stringify(raw));
    await assert.rejects(() => store.read(ref, "connection-a:version-1"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("content addressed artifacts are immutable and verified on read", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tidelab-artifact-test-"));
  try {
    const store = new LocalStore(root),
      workspace = id();
    const a = await store.put(workspace, Buffer.from("report"));
    const b = await store.put(workspace, Buffer.from("report"));
    assert.equal(a.object_key, b.object_key);
    assert.equal(
      (await store.read(a.object_key, a.sha256)).toString(),
      "report",
    );
    assert.throws(() => store.location("../../etc/passwd"));
    await writeFile(store.location(a.object_key), "changed");
    await assert.rejects(() => store.read(a.object_key, a.sha256));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("skill package rejects traversal and preserves distinct release hashes", () => {
  assert.throws(() =>
    validateBundle({ schema_version: 1, files: { "../SKILL.md": "bad" } }),
  );
  assert.throws(() =>
    validateBundle({ schema_version: 1, files: { "/tmp/file": "bad" } }),
  );
  const a = {
    schema_version: 1,
    files: { "skills/example/SKILL.md": "Original" },
  };
  const b = {
    schema_version: 1,
    files: { "skills/example/SKILL.md": "Changed" },
  };
  assert.notEqual(digest(validateBundle(a)), digest(validateBundle(b)));
});
test("all registered project skills can be packaged", async () => {
  const { KINDS } = await import("../src/common/core.mjs");
  for (const skill of Object.values(KINDS)) {
    const bundle = await projectBundle(path.resolve(".."), skill);
    assert.ok(bundle.files[`skills/${skill}/SKILL.md`]);
  }
});
test("evidence JSON Pointer and HTML escaping preserve untrusted content as data", () => {
  assert.equal(pointer({}, "/constructor"), undefined);
  assert.equal(pointer({}, "/__proto__"), undefined);
  assert.equal(
    pointer({ result: { "a/b": { "~x": 3 } } }, "/result/a~1b/~0x"),
    3,
  );
  const html = renderReport(
    {
      status: "partial",
      summary: "<script>alert(1)</script>",
      sections: [],
      candidates: [],
      limitations: [],
      questions: [],
      next_actions: [],
    },
    { title: "<img src=x onerror=alert(1)>", kind: "reviews" },
  );
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
});
test("source JSON preserves long product identifiers and decodes MCP text without inventing fields", () => {
  const text = '{"product_id":1730923344556677889,"orders":101,"price":19.95}';
  assert.deepEqual(parseEvidenceJson(text), {
    product_id: "1730923344556677889",
    orders: 101,
    price: 19.95,
  });
  const result = {
    content: [
      { type: "text", text: "Explanation" },
      { type: "text", text },
    ],
  };
  const decoded = decodeMcpContent(result);
  assert.equal(decoded.length, 1);
  assert.equal(decoded[0].content_index, 1);
  assert.equal(
    pointer({ decoded }, "/decoded/0/data/product_id"),
    "1730923344556677889",
  );
  assert.equal(result.content[1].text, text);
});
test("request normalization accepts optional user rules and bounded counts", () => {
  const r = normalizeRequest("scouting", { category: "家居收纳" });
  assert.equal(r.candidate_count, 5);
  assert.equal(r.selection_rules, "");
  assert.equal(r.strategies, undefined);
  assert.equal(r.minimum_orders_7d, undefined);
  assert.throws(() =>
    normalizeRequest("scouting", { ...r, orders_operator: ">=" }),
  );
  assert.throws(() =>
    normalizeRequest("scouting", { ...r, candidate_count: 201 }),
  );
  assert.throws(() =>
    normalizeRequest("reviews", { target: "商品", question: "" }),
  );
});
test("batch links preserve unresolved links and reject deceptive hosts", () => {
  const items = normalizeTikTokLinks([
    "https://www.tiktok.com/view/product/1730923344556677889",
    "https://www.tiktok.com/shop/pdp/storage-box/1730923344556677889",
    "https://vm.tiktok.com/abc/",
    "https://tiktok.com.example.com/shop/pdp/1730923344556677889",
  ]);
  assert.equal(items[1].product_id, "1730923344556677889");
  assert.equal(items[2].status, "needs_resolution");
  assert.equal(items[3].status, "invalid");
});
test("profit uses actual/volumetric maximum and missing fees block margin", async () => {
  const input = JSON.parse(
    await readFile(
      new URL(
        "../../skills/tiktok-unit-economics/assets/example.json",
        import.meta.url,
      ),
    ),
  );
  const known = calculateEconomics(input);
  assert.ok(known.contribution_margin !== null);
  input.costs.find((x) => x.category === "advertising").status = "unknown";
  const unknown = calculateEconomics(input);
  assert.equal(unknown.contribution_margin, null);
  assert.ok(unknown.blockers.length > 0);
});

test("assistant references require exact values and recognized context or data sources", async () => {
  const { AssistantResult, validateAssistantCitations } =
    await import("../src/assistant/assistant-contract.mjs");
  const cid = id(),
    iid = id();
  const contexts = [
    {
      id: cid,
      source_note: "manual",
      captured_at: "2026-09-09",
      data: { price: 12, "a/b": 0 },
    },
  ];
  const result = AssistantResult.parse({
    status: "complete",
    answer: "价格为 12。[1]",
    citations: [
      {
        source_type: "context",
        source_id: cid,
        pointer: "/data/price",
        value: 12,
        label: "报价",
      },
    ],
    limitations: [],
    followups: [],
  });
  assert.equal(
    validateAssistantCitations(result, contexts, new Map())[0].source,
    "manual",
  );
  assert.throws(
    () =>
      validateAssistantCitations(
        { ...result, citations: [{ ...result.citations[0], value: "12" }] },
        contexts,
        new Map(),
      ),
    /evidence_value_mismatch/,
  );
  assert.throws(
    () => validateAssistantCitations(result, [], new Map()),
    /unrecognized_evidence/,
  );
  const data = {
    ...result,
    citations: [
      {
        source_type: "data",
        source_id: iid,
        pointer: "/decoded/0/data/price",
        value: 0,
        label: "接口价格",
      },
    ],
  };
  const sources = new Map([
    [
      iid,
      {
        artifact_id: id(),
        envelope: {
          source: "FastMoss",
          tool: "test",
          captured_at: "2026-09-09",
          decoded: [{ data: { price: 0 } }],
        },
      },
    ],
  ]);
  assert.ok(validateAssistantCitations(data, [], sources)[0].artifact_id);
  assert.throws(
    () => validateAssistantCitations(data, [], new Map()),
    /unrecognized_evidence/,
  );
});

test("assistant history preserves all completed turns for automatic compression", async () => {
  const { assistantHistory } =
    await import("../src/assistant/assistant-contract.mjs");
  const make = (n, status = "succeeded") => ({
    id: String(n),
    status,
    request: { question: "q", contexts: [] },
    result: { answer: "a", citations: [], limitations: [] },
  });
  const rows = [
    make(9, "failed"),
    make(8, "reconciling"),
    ...[7, 6, 5, 4, 3, 2, 1].map((n) => make(n)),
  ];
  assert.deepEqual(
    assistantHistory(rows).map((x) => x.job_id),
    ["1", "2", "3", "4", "5", "6", "7"],
  );
  const big = make(10);
  big.result.answer = "大".repeat(16000);
  assert.equal(assistantHistory([big, ...rows]).at(-1).answer.length, 16000);
  assert.deepEqual(assistantHistory([big, ...rows], 14000), []);
  assert.deepEqual(assistantHistory(rows, 0), []);
  const one = assistantHistory([make(1)]);
  const bytes = Buffer.byteLength(JSON.stringify(one[0]));
  assert.equal(assistantHistory([make(2), make(1)], bytes).length, 1);
});

test("context compaction preserves originals, resumes memory and invalidates changed sources", async () => {
  const {
    prepareAssistantContext,
    contextChunks,
    contextDigest,
    reusableHistoryMemory,
  } = await import("../src/assistant/assistant-context.mjs");
  const unicode = "🦫测样尺寸不得填零".repeat(1000);
  const parts = contextChunks(unicode, 997);
  assert.equal(parts.join(""), unicode);
  assert.ok(parts.every((p) => Buffer.byteLength(p) <= 997));
  const request = {
    question: "比较商品",
    data_mode: "context_only",
    contexts: [
      { id: id(), title: "验收商品", data: { notes: unicode, price: 6.99 } },
    ],
    history: Array.from({ length: 8 }, (_, i) => ({
      job_id: id(),
      question: `问题${i}`,
      answer: "历史推断待验证。".repeat(250),
      citations: [],
    })),
  };
  const original = JSON.stringify(request),
    calls = [];
  const summarize = async (input) => {
    calls.push(input);
    return "商品和历史已摘要。包装尺寸缺失，历史判断为推断。";
  };
  const first = await prepareAssistantContext(request, summarize, {
    targetBytes: 9000,
  });
  assert.equal(JSON.stringify(request), original);
  assert.ok(first.compaction.context_memory);
  assert.equal(first.input.contexts[0].data.price, 6.99);
  assert.deepEqual(first.input.contexts[0].omitted_fields, ["notes"]);
  assert.ok(first.compaction.history_memory);
  assert.ok(first.compaction.output_bytes <= 9000);
  assert.ok(first.input.history.length < 8);
  assert.ok(calls.length > 1);
  const count = calls.length;
  const second = await prepareAssistantContext(
    { ...request, previous_compaction: first.compaction },
    summarize,
    { targetBytes: 9000 },
  );
  assert.equal(calls.length, count);
  assert.deepEqual(second.compaction.events, []);
  assert.ok(
    reusableHistoryMemory(first.compaction.history_memory, request.history),
  );
  const altered = structuredClone(request.history);
  altered[0].answer = "变更";
  assert.equal(
    reusableHistoryMemory(first.compaction.history_memory, altered),
    null,
  );
  const changed = structuredClone(request);
  changed.contexts[0].data.notes += "新测量";
  await prepareAssistantContext(
    { ...changed, previous_compaction: first.compaction },
    summarize,
    { targetBytes: 9000 },
  );
  assert.ok(calls.length > count);
  assert.notEqual(
    contextDigest(changed.contexts),
    first.compaction.context_memory.digest,
  );
  await assert.rejects(
    prepareAssistantContext(request, async () => "大".repeat(2501), {
      targetBytes: 9000,
    }),
    /assistant_compaction_invalid/,
  );
  await assert.rejects(
    prepareAssistantContext(
      request,
      async () => {
        throw new Error("task_budget_exhausted");
      },
      { targetBytes: 9000 },
    ),
    /task_budget_exhausted/,
  );
});

test("model JSON accepts one fenced object without changing invalid values", async () => {
  const { parseModelJson } =
    await import("../src/assistant/assistant-context.mjs");
  assert.deepEqual(parseModelJson('text\n```json\n{"status":"ok"}\n```'), {
    status: "ok",
  });
  assert.throws(() => parseModelJson("no object"), /assistant_output_invalid/);
  assert.throws(
    () => parseModelJson("```json\n{}\n```\n```json\n{}\n```"),
    /assistant_output_invalid/,
  );
});

test("large output capacity is bounded by context and remaining budget without over-reservation", () => {
  const card = {
    currency: "CNY",
    fx: "1",
    market: { input: "9", output: "27", cache_read: "0.3", cache_write: "0" },
    procurement_discount: "1",
    sale_discount: "1.5",
    max_context_tokens: 1000000,
    max_output_tokens: 360000,
  };
  assert.equal(PriceSchema.parse(card).max_output_tokens, 360000);
  assert.throws(() =>
    PriceSchema.parse({ ...card, max_output_tokens: 384001 }),
  );
  const full = modelCallBudget(card, 50000, 50000000n);
  assert.equal(full.max_output_tokens, 360000);
  const limited = modelCallBudget(card, 50000, 2000000n);
  assert.ok(
    limited.max_output_tokens > 16384 && limited.max_output_tokens < 360000,
  );
  assert.ok(limited.reserved <= 2000000n);
  assert.ok(
    callBound({
      ...card,
      max_context_tokens: 50000,
      max_output_tokens: limited.max_output_tokens + 1,
    }) > 2000000n,
  );
  assert.equal(
    modelCallBudget(card, 900000, 50000000n).max_output_tokens,
    100000,
  );
  assert.equal(
    modelCallBudget(card, 50000, 50000000n, 512).max_output_tokens,
    512,
  );
  assert.throws(
    () => modelCallBudget(card, 50000, 1n),
    (e) => e.code === "task_budget_exhausted",
  );
  assert.throws(
    () => modelCallBudget(card, 1000000, 50000000n),
    (e) => e.code === "model_context_budget_exceeded",
  );
});
