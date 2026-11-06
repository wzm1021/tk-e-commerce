import test from "node:test";
import assert from "node:assert/strict";
import { emptyDraft } from "../src/ai-testing/contract.mjs";
import {
  suggestionInput,
  validateSuggestions,
  applySuggestions,
} from "../src/ai-testing/suggestion-contract.mjs";
import { searchCandidates } from "../web/features/ai-testing/candidate-search.mjs";
import { aiFixture } from "./fixtures/ai-testing.mjs";
const item = (path, value, quote = "", source = value) => ({
  source_value: source,
  path,
  value,
  source_quote: quote,
  reason: "结合商品资料，供用户核对",
});

test("candidate search matches Chinese, ASIN, multi-keywords and small spelling errors", () => {
  const items = [
    {
      title: "Bamboo Storage Rack 竹制收纳架",
      product_id: "B0ABC123",
      keywords: ["entryway organizer"],
    },
    { title: "Metal Rack", product_id: "123456", keywords: ["shoe stand"] },
  ];
  for (const q of [
    "竹制",
    "b0abc",
    "ＲＡＣＫ bamboo",
    "entryway bamboo",
    "bambo rack",
  ])
    assert.deepEqual(searchCandidates(items, q), [items[0]]);
  assert.deepEqual(searchCandidates(items, "rack"), items);
  assert.deepEqual(searchCandidates(items, "999999"), []);
  assert.deepEqual(searchCandidates(items, "  "), items);
});
test("suggestion contract protects factual fields and does not overwrite existing answers", () => {
  const d = {
    data: emptyDraft(),
    sources: {
      A: {
        candidate: { title: "Bamboo Storage Rack", dimensions: "25 × 12 cm" },
        product_evidence: [{ data: { material: "Bamboo" } }],
      },
    },
  };
  const request = suggestionInput(d, "A");
  const suggestions = validateSuggestions(
    {
      suggestions: [
        item("product.use", "收纳鞋子与随身物品"),
        item("product.material", "竹材", "Bamboo", "Bamboo"),
        item("product.dimensions", "40 × 20 cm", "25 × 12 cm"),
        item("pricing.current_price", 99, "不存在的资料"),
        item("question", "覆盖已有问题"),
      ],
    },
    request,
  );
  assert.deepEqual(
    suggestions.map((s) => s.path),
    ["product.use", "product.material"],
  );
  const row = {
    state: "ready",
    arm: "A",
    source_digest: request.source_digest,
    result: { suggestions },
  };
  d.data.arms[0].product.use = "用户先填写的用途";
  const result = applySuggestions(d, row, {
    "product.use": "待验证用途",
    "product.material": "用户核实的材质",
  });
  assert.deepEqual(result.skipped, ["product.use"]);
  assert.equal(d.data.arms[0].product.use, "用户先填写的用途");
  assert.equal(d.data.arms[0].product.material, "用户核实的材质");
  d.data.arms[0].url = "https://example.com/different";
  assert.throws(
    () => applySuggestions(d, row, { "product.material": "test" }),
    { code: "ai_suggestion_stale" },
  );
});

test(
  "import suggestion lifecycle: both entrypoints, context, persistence, isolation and explicit confirmation",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const f = await aiFixture();
    try {
      // Fixture owns an isolated workspace. Run just its suggestion tasks, leaving other work untouched.
      async function work(id) {
        const token = crypto.randomUUID();
        await f.db.query(
          "UPDATE ai_test_dispatch SET lease_token=$2,lease_until=now()+interval '10 minutes' WHERE id=$1",
          [id, token],
        );
        const { suggestionJob } =
          await import("../src/ai-testing/suggestions.mjs");
        await suggestionJob(f.engine, {
          id,
          workspace_id: f.workspace,
          lease_token: token,
        });
      }
      let calls = 0;
      f.engine.suggestionGenerator = async (engine, row) => {
        calls++;
        assert.ok(row.request.product_background.candidate.product_id);
        const suggestions =
          row.arm === "A"
            ? [
                item("product.use", "收纳鞋子与衣物"),
                item("usage_context", "小户型玄关收纳"),
                item(
                  "product.material",
                  "竹材",
                  "Bamboo Storage Rack",
                  "Bamboo",
                ),
              ]
            : [item("product.use", "独立整理鞋子")];
        return {
          raw: { status: "completed" },
          text: JSON.stringify({ suggestions }),
          usage: {
            input_tokens: 120,
            output_tokens: 30,
            normalized: {
              input_uncached: 100,
              cache_read: 20,
              output_total: 30,
            },
          },
          procurement_micro_cny: "7",
        };
      };
      const refs = {
        items: [
          { report_id: f.report, product_id: f.candidates[0].product_id },
        ],
      };
      const a = await f.ok("/api/ai-tests/import", refs),
        b = await f.ok("/api/ai-tests/import", refs);
      assert.equal(a.items[0].id, b.items[0].id);
      const base = "/api/ai-tests/" + a.items[0].id;
      let x = await f.ok(base),
        row = x.suggestions[0];
      assert.equal(row.state, "queued");
      assert.equal(
        (
          await f.db.tenant(f.workspace, (c) =>
            c.query("SELECT * FROM ai_test_suggestions WHERE draft_id=$1", [
              x.draft.id,
            ]),
          )
        ).rowCount,
        1,
      );
      const stored = (
        await f.db.tenant(f.workspace, (c) =>
          c.query("SELECT * FROM ai_test_suggestions WHERE id=$1", [row.id]),
        )
      ).rows[0];
      assert.deepEqual(
        stored.request.product_background.candidate,
        f.candidates[0],
      );
      assert.ok(
        Object.hasOwn(stored.request.product_background, "product_evidence"),
      );
      assert.ok(
        Object.hasOwn(stored.request.product_background, "supplements"),
      );
      assert.equal(
        (await f.db.query("SELECT * FROM ai_test_suggestions")).rowCount,
        0,
      );
      await work(row.id);
      x = await f.ok(base);
      row = x.suggestions[0];
      assert.equal(row.state, "ready");
      assert.equal(x.draft.data.arms[0].product.use, ""); // never auto-applied
      assert.equal(calls, 1);
      const artifact = (
        await f.db.tenant(f.workspace, (c) =>
          c.query(
            "SELECT a.* FROM ai_test_suggestions s JOIN artifacts a ON a.id=s.artifact_id WHERE s.id=$1",
            [row.id],
          ),
        )
      ).rows[0];
      const evidence = JSON.parse(
        (await f.store.read(artifact.object_key, artifact.sha256)).toString(),
      );
      assert.equal(
        evidence.request.product_background.candidate.custom_product_fact
          .important,
        "保留完整商品资料",
      );
      assert.equal(evidence.usage.input_tokens, 120);
      x.draft.data.usage_context = "用户填写的房间";
      let d = await f.ok(
        base,
        { version: x.draft.version, data: x.draft.data },
        "PUT",
      );
      const applied = await f.ok(base + "/apply-suggestions", {
        version: d.version,
        suggestion_id: row.id,
        values: {
          "product.use": "用户修正后的用途",
          usage_context: "建议场景",
        },
      });
      assert.equal(applied.draft.data.arms[0].product.use, "用户修正后的用途");
      assert.equal(applied.draft.data.usage_context, "用户填写的房间");
      assert.deepEqual(applied.skipped, ["usage_context"]);
      assert.equal(applied.draft.confirmed_digest, null);
      const repeat = await f.ok(base + "/apply-suggestions", {
        version: applied.draft.version,
        suggestion_id: row.id,
        values: { "product.use": "不应覆盖" },
      });
      assert.equal(repeat.draft.version, applied.draft.version);
      assert.equal(
        (
          await f.request(
            base + "/apply-suggestions",
            {
              version: repeat.draft.version,
              suggestion_id: row.id,
              values: { "product.use": "cross" },
            },
            "POST",
            f.otherAuth,
            f.other,
          )
        ).statusCode,
        404,
      );
      // B imports only B's product; A's scenario is not a target.
      d = await f.ok(base + "/arm-import", {
        version: repeat.draft.version,
        arm: "B",
        report_id: f.report,
        product_id: f.candidates[1].product_id,
      });
      x = await f.ok(base);
      const brow = x.suggestions.find((s) => s.arm === "B");
      const bstored = (
        await f.db.tenant(f.workspace, (c) =>
          c.query("SELECT * FROM ai_test_suggestions WHERE id=$1", [brow.id]),
        )
      ).rows[0];
      assert.equal(
        bstored.request.product_background.candidate.product_id,
        f.candidates[1].product_id,
      );
      assert.ok(bstored.request.missing_fields.every((p) => p.includes(".")));
      assert.equal(d.data.arms[0].product.use, "用户修正后的用途");
      await work(brow.id);
      d = await f.ok(base + "/arm-import", {
        version: d.version,
        arm: "B",
        report_id: f.report,
        product_id: f.candidates[0].product_id,
      });
      const stale = await f.request(base + "/apply-suggestions", {
        version: d.version,
        suggestion_id: brow.id,
        values: { "product.use": "旧商品建议" },
      });
      assert.equal(stale.statusCode, 409);
      assert.match(stale.body, /ai_suggestion_stale/);
      assert.equal(
        (
          await f.db.tenant(f.workspace, (c) =>
            c.query(
              "SELECT available::text FROM wallets WHERE currency='ai_test_uses'",
            ),
          )
        ).rows[0].available,
        "100",
      );
      assert.equal(f.calls.length, 0);
      // A late old-product completion must not hide the new product's queued suggestions.
      await f.db.tenant(f.workspace, (c) =>
        c.query(
          "UPDATE ai_test_suggestions SET updated_at=now()+interval '1 minute' WHERE id=$1",
          [brow.id],
        ),
      );
      x = await f.ok(base);
      assert.notEqual(x.suggestions.find((s) => s.arm === "B").id, brow.id);
      // A failed response is retained, and an explicit retry is a new auditable attempt.

      const pendingB = x.suggestions.find((s) => s.arm === "B");
      f.engine.suggestionGenerator = async () => ({
        raw: {
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
        },
        text: "",
        usage: {
          input_tokens: 4,
          output_tokens: 2,
          normalized: { input_uncached: 4, cache_read: 0, output_total: 2 },
        },
        procurement_micro_cny: "1",
      });
      await work(pendingB.id);
      x = await f.ok(base);
      assert.equal(x.suggestions.find((s) => s.arm === "B").state, "failed");
      assert.equal(
        x.suggestions.find((s) => s.arm === "B").error_code,
        "ai_suggestion_output_limit",
      );
      assert.equal(
        (
          await f.db.query("SELECT id FROM ai_test_dispatch WHERE id=$1", [
            pendingB.id,
          ])
        ).rowCount,
        0,
      );
      const tooSoon = await f.request(base + "/suggestions", {
        version: x.draft.version,
        arm: "B",
      });
      assert.equal(tooSoon.statusCode, 429);
      await f.db.tenant(f.workspace, (c) =>
        c.query(
          "UPDATE ai_test_suggestions SET updated_at=now()-interval '31 seconds' WHERE id=$1",
          [pendingB.id],
        ),
      );
      const retry = await f.ok(base + "/suggestions", {
        version: x.draft.version,
        arm: "B",
      });
      assert.notEqual(
        retry.suggestions.find((s) => s.arm === "B").id,
        pendingB.id,
      );
      assert.ok(
        (
          await f.db.tenant(f.workspace, (c) =>
            c.query("SELECT artifact_id FROM ai_test_suggestions WHERE id=$1", [
              pendingB.id,
            ]),
          )
        ).rows[0].artifact_id,
      );
      const usage = await f.ok("/api/settings");
      assert.equal(usage.usage.own.input_tokens, "244");
      assert.equal(usage.usage.own.output_tokens, "62");
    } finally {
      await f.db.query("DELETE FROM ai_test_dispatch WHERE workspace_id=$1", [
        f.workspace,
      ]);
      await f.close();
    }
  },
);
