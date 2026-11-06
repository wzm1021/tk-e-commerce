import test from "node:test";
import assert from "node:assert/strict";
import { emptyDraft } from "../src/ai-testing/contract.mjs";
import {
  suggestionInput,
  validateSuggestions,
} from "../src/ai-testing/suggestion-contract.mjs";
import { validateSuggestionTranslation } from "../src/ai-testing/suggestion-language.mjs";
import { needsChineseSuggestions } from "../web/features/ai-testing/suggestion-language.mjs";
import { aiFixture } from "./fixtures/ai-testing.mjs";

const original = [
  {
    path: "product.material",
    value: "Stainless Steel",
    kind: "source",
    reason: "材质来自商品资料",
    source_quote: "Material: Stainless Steel",
  },
  {
    path: "product.key_features",
    value: ["3-in-1 organizer", "No drilling required"],
    kind: "source",
    reason: "卖点来自商品资料",
    source_quote: "3-in-1 organizer; No drilling required",
  },
];
const translations = [
  { path: "product.material", value: "不锈钢" },
  { path: "product.key_features", value: ["3合1收纳架", "无需打孔"] },
];
test("Chinese facts retain exact original evidence, arrays, numbers and units", () => {
  const d = {
    data: emptyDraft(),
    sources: {
      A: {
        material: "Material: Stainless Steel",
        features: "3-in-1 organizer; No drilling required",
        dimensions: "25 × 12 cm",
      },
    },
  };
  const input = suggestionInput(d, "A");
  const suggestions = original.map((s, i) => ({
    path: s.path,
    value: translations[i].value,
    source_value: s.value,
    source_quote: s.source_quote,
    reason: s.reason,
  }));
  const checked = validateSuggestions({ suggestions }, input);
  assert.equal(checked[0].value, "不锈钢");
  assert.equal(checked[0].source_value, "Stainless Steel");
  assert.equal(checked[1].source_quote, original[1].source_quote);
  assert.equal(needsChineseSuggestions(checked), false);
  assert.equal(needsChineseSuggestions(original), true);
  assert.equal(
    needsChineseSuggestions([
      { path: "product.dimensions", value: "25 × 12 cm" },
    ]),
    false,
  );
  assert.deepEqual(
    validateSuggestions(
      { suggestions: [{ ...suggestions[0], source_value: "Aluminum" }] },
      input,
    ),
    [],
  );
  assert.deepEqual(
    validateSuggestions(
      { suggestions: [{ ...suggestions[0], source_quote: "invented" }] },
      input,
    ),
    [],
  );
  assert.throws(() =>
    validateSuggestions(
      { suggestions: [{ ...suggestions[0], value: "304不锈钢" }] },
      input,
    ),
  );
  assert.throws(() =>
    validateSuggestions(
      { suggestions: [{ ...suggestions[0], value: "Stainless Steel" }] },
      input,
    ),
  );
  const translated = validateSuggestionTranslation({ translations }, original);
  assert.equal(translated[0].source_value, "Stainless Steel");
  assert.equal(translated[1].source_quote, original[1].source_quote);
  assert.equal(original[0].value, "Stainless Steel");
  for (const bad of [
    translations.slice(0, 1),
    [translations[0], translations[0]],
    [
      translations[0],
      { path: "product.key_features", value: ["4合1收纳架", "无需打孔"] },
    ],
    [
      translations[0],
      { path: "product.key_features", value: ["3合1收纳架，无需打孔"] },
    ],
  ])
    assert.throws(() =>
      validateSuggestionTranslation({ translations: bad }, original),
    );
});
test(
  "legacy translation is deduplicated, tenant scoped, auditable and never overwrites form edits",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const f = await aiFixture();
    try {
      const imported = await f.ok("/api/ai-tests/import", {
        items: [
          { report_id: f.report, product_id: f.candidates[0].product_id },
        ],
      });
      const base = "/api/ai-tests/" + imported.items[0].id;
      let x = await f.ok(base);
      const oldId = x.suggestions[0].id;
      // Simulate the stored result shape produced before Chinese suggestions were introduced.
      await f.db.tenant(f.workspace, (c) =>
        c.query(
          "UPDATE ai_test_suggestions SET state='ready',request=request-'format_version',result=$2 WHERE id=$1",
          [oldId, { suggestions: original }],
        ),
      );
      await f.db.query("DELETE FROM ai_test_dispatch WHERE id=$1", [oldId]);
      x = await f.ok(base);
      assert.equal(x.suggestions[0].needs_translation, true);
      x.draft.data.arms[0].product.use = "用户已确认的用途";
      const d = await f.ok(
        base,
        { version: x.draft.version, data: x.draft.data },
        "PUT",
      );
      const results = await Promise.all([
        f.ok(base + "/translate-suggestions", { suggestion_id: oldId }),
        f.ok(base + "/translate-suggestions", { suggestion_id: oldId }),
      ]);
      const row = results[0].suggestions[0];
      assert.equal(row.id, results[1].suggestions[0].id);
      assert.equal(row.translation_of, oldId);
      assert.equal(
        (
          await f.request(
            base + "/translate-suggestions",
            { suggestion_id: oldId },
            "POST",
            f.otherAuth,
            f.other,
          )
        ).statusCode,
        404,
      );
      f.engine.suggestionGenerator = async (engine, stored) => {
        assert.deepEqual(stored.request.original_suggestions, original);
        assert.ok(stored.request.product_background.candidate);
        return {
          raw: { status: "completed", output: "retained translation response" },
          text: JSON.stringify({ translations }),
          usage: {
            input_tokens: 30,
            output_tokens: 15,
            normalized: { input_uncached: 30, cache_read: 0, output_total: 15 },
          },
          procurement_micro_cny: "1",
        };
      };
      const token = crypto.randomUUID();
      await f.db.query(
        "UPDATE ai_test_dispatch SET lease_token=$2,lease_until=now()+interval '10 minutes' WHERE id=$1",
        [row.id, token],
      );
      const { suggestionJob } =
        await import("../src/ai-testing/suggestions.mjs");
      await suggestionJob(f.engine, {
        id: row.id,
        workspace_id: f.workspace,
        lease_token: token,
      });
      x = await f.ok(base);
      assert.equal(x.suggestions[0].state, "ready");
      assert.equal(x.suggestions[0].needs_translation, false);
      assert.equal(x.draft.version, d.version);
      assert.equal(x.draft.data.arms[0].product.material, "");
      assert.equal(x.draft.data.arms[0].product.use, "用户已确认的用途");
      const stored = (
        await f.db.tenant(f.workspace, (c) =>
          c.query(
            "SELECT * FROM ai_test_suggestions WHERE draft_id=$1 ORDER BY created_at",
            [d.id],
          ),
        )
      ).rows;
      assert.equal(stored.length, 2);
      assert.deepEqual(
        stored.find((r) => r.id === oldId).result.suggestions,
        original,
      );
      assert.ok(stored.find((r) => r.id === row.id).artifact_id);
      const applied = await f.ok(base + "/apply-suggestions", {
        version: d.version,
        suggestion_id: row.id,
        values: {
          "product.material": "不锈钢（已核对）",
          "product.key_features": translations[1].value,
        },
      });
      assert.equal(
        applied.draft.data.arms[0].product.material,
        "不锈钢（已核对）",
      );
      applied.draft.data.arms[0].url = "https://example.com/changed-product";
      await f.ok(
        base,
        { version: applied.draft.version, data: applied.draft.data },
        "PUT",
      );
      assert.equal(
        (
          await f.request(base + "/translate-suggestions", {
            suggestion_id: oldId,
          })
        ).statusCode,
        409,
      );
      assert.equal(f.calls.length, 0);
    } finally {
      await f.db.query("DELETE FROM ai_test_dispatch WHERE workspace_id=$1", [
        f.workspace,
      ]);
      await f.close();
    }
  },
);
