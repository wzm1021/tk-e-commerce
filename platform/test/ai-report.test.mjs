import test from "node:test";
import assert from "node:assert/strict";
import {
  reasonText,
  reportText,
  reportSources,
  labelOf,
  valueLabels,
  confidenceLevel,
} from "../web/features/ai-testing/report-content.mjs";
import {
  translationBatch,
  validateTranslations,
} from "../src/ai-testing/report.mjs";
import { publicResults } from "../src/ai-testing/report-results.mjs";
import { aiFixture } from "./fixtures/ai-testing.mjs";
import { saveArtifact } from "../src/files/artifacts.mjs";
test("SDK confidence levels use percentage units without changing confidence intervals", () => {
  assert.equal(confidenceLevel(0.95), "95%");
  assert.equal(confidenceLevel(0.9), "90%");
  assert.equal(confidenceLevel(0.995), "99.5%");
  assert.equal(confidenceLevel(null), "未提供");
  assert.equal(confidenceLevel(95), "未提供");
});
test("customer feedback uses Chinese, preserves category context and never exposes unknown codes", () => {
  assert.equal(
    reasonText({ category: "positive_fit" }),
    "符合需求，能解决实际问题",
  );
  assert.equal(
    reasonText({ category: "price_budget" }, true),
    "价格或预算方面的顾虑",
  );
  assert.equal(
    reasonText({ category: "information_gap" }),
    "仍需了解部分商品信息",
  );
  assert.equal(
    reasonText({ category: "new_internal_code" }, true),
    "其他顾虑（尚未分类）",
  );
  assert.equal(reasonText({ category: "尺寸需要确认" }, true), "尺寸需要确认");
  assert.equal(
    reportText("Will it fit?", [
      { source: "Will it fit?", zh: "尺寸适合吗？" },
    ]),
    "尺寸适合吗？",
  );
  assert.equal(
    reportText({ question_zh: "会生锈吗？", question: "Will it rust?" }),
    "会生锈吗？",
  );
  assert.equal(reportText("Untranslated text"), "中文内容暂未准备好");
  assert.equal(reportText("商品は丈夫ですか？"), "中文内容暂未准备好");
  assert.equal(reportText("适合 USB-C 接口吗？"), "适合 USB-C 接口吗？");
  assert.equal(reportText("constructor"), "中文内容暂未准备好");
  assert.equal(labelOf(valueLabels, "__proto__", "其他"), "其他");
});
test("translation collects only visible foreign-language feedback, not IDs, model metadata or Chinese narratives", () => {
  const result = {
    sample: { models_used: ["secret-model"] },
    test_id: "private-id",
    arms: {
      A: {
        common_questions: ["Will it fit?", "Will it fit?"],
        top_concerns: [{ category: "information_gap" }],
      },
    },
    narrative: {
      en: { summary: "Do not translate the unused English copy" },
      zh: { summary: "保留中文总结" },
    },
    personas: [
      {
        persona_id: "private-persona",
        profile: { gender: "Female", interests: ["Gardening"] },
        arms: {
          A: {
            primary_reason: "Useful for me",
            questions: ["Will it fit?"],
            decisions: [0, 1],
          },
        },
      },
    ],
    recommendations: {
      page_optimization: [
        {
          title: { en: "Ignored", zh: "中文标题" },
          detail: { en: "Need more detail" },
        },
      ],
    },
    definitions: { en: { buy_rate: "Mean across personas" } },
  };
  assert.deepEqual(reportSources(result), [
    "Will it fit?",
    "Need more detail",
    "Gardening",
    "Useful for me",
    "Mean across personas",
  ]);
  const batch = translationBatch(
    Array.from({ length: 70 }, (_, i) => "Question " + i),
  );
  assert.equal(batch.length, 30);
  assert.equal(
    translationBatch(["Done", "Next"], [{ source: "Done", zh: "已完成" }])[0],
    "Next",
  );
});
test("translation refuses missing IDs, repeated IDs, English-only output and changed numerical claims", () => {
  const source = ["Fits 18–28 mm?", "Is it $16.89?"];
  assert.deepEqual(
    validateTranslations(
      {
        translations: [
          { id: 1, zh: "售价是 $16.89 吗？" },
          { id: 0, zh: "适合 18–28 毫米吗？" },
        ],
      },
      source,
    ).map((x) => x.source),
    source,
  );
  for (const value of [
    { translations: [{ id: 0, zh: "适合 18–28 毫米吗？" }] },
    {
      translations: [
        { id: 0, zh: "适合 18–28 毫米吗？" },
        { id: 0, zh: "售价是16.89吗？" },
      ],
    },
    {
      translations: [
        { id: 0, zh: "Fits 18–28 mm?" },
        { id: 1, zh: "售价16.89？" },
      ],
    },
    {
      translations: [
        { id: 0, zh: "适合 18–30 毫米吗？" },
        { id: 1, zh: "售价16.89？" },
      ],
    },
  ])
    assert.throws(() => validateTranslations(value, source));
});
test("complete SDK report survives normalization without changing numerical evidence", () => {
  const r = {
    schema_version: "1",
    is_simulation: true,
    arms: {
      A: {
        buy_rate: { value: 0.4, ci95: [0.2, 0.6] },
        buy_sessions: 4,
        valid_sessions: 10,
      },
    },
    comparisons: [],
    narrative: { zh: { summary: "中文总结" } },
    decision: { code: "insufficient", label_zh: "样本不足" },
    recommendations: { page_optimization: [] },
    personas: [{ persona_id: "synthetic", arms: { A: { decisions: [1, 0] } } }],
    segment_insights: { age: { zh: "小样本" } },
    definitions: { zh: { ci: "区间说明" } },
    private_vendor_key: "must-not-leak",
  };
  const out = publicResults(r, ["A"]);
  for (const k of [
    "arms",
    "narrative",
    "decision",
    "recommendations",
    "personas",
    "segment_insights",
    "definitions",
  ])
    assert.deepEqual(out[k], r[k]);
  assert.equal(out.private_vendor_key, undefined);
});
test(
  "historical report enrichment is tenant-isolated, idempotent, cached, and never charges another test",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const f = await aiFixture();
    try {
      let d = await f.ok("/api/ai-tests", {});
      const data = d.data;
      data.name = "中文报告本地测试";
      data.shopper_problem = "Organize a room";
      data.arms[0].product.name = "Rack";
      data.arms[0].product.use = "Storage";
      data.arms[0].pricing.current_price = 16.89;
      data.arms[0].url = f.candidates[0].tk_url;
      d = await f.ok(
        "/api/ai-tests/" + d.id,
        { version: d.version, data },
        "PUT",
      );
      for (const arm of ["A", "B"])
        d = await f.ok("/api/ai-tests/" + d.id + "/image", {
          version: d.version,
          arm,
          data: f.png.toString("base64"),
        });
      const review = await f.ok("/api/ai-tests/" + d.id + "/review");
      const submitted = await f.ok("/api/ai-tests/" + d.id + "/submit", {
        version: review.version,
        digest: review.digest,
        confirmed: true,
      });
      await f.tick();
      await f.tick();
      const r = await f.db.tenant(
        f.workspace,
        async (c) =>
          (
            await c.query("SELECT * FROM ai_test_runs WHERE id=$1", [
              submitted.id,
            ])
          ).rows[0],
      );
      assert.equal(r.status, "completed");
      const full = {
        ...r.result,
        narrative: { zh: { summary: "保留的中文摘要" } },
        recommendations: {
          page_optimization: [
            { title: { zh: "补充尺寸" }, detail: { zh: "增加尺寸图示" } },
          ],
        },
        personas: [
          {
            persona_id: "synthetic",
            profile: { gender: "Female" },
            arms: {
              A: {
                primary_reason: "Useful for storage",
                primary_concern: "Will it fit?",
                questions: ["Will it fit?"],
                decisions: [1, 0, 1],
              },
            },
          },
        ],
        arms: {
          ...r.result.arms,
          A: {
            ...r.result.arms.A,
            common_questions: ["Will it fit?"],
            top_buy_reasons: [
              { category: "positive_fit", sessions: 3, share_of_buy: 1 },
            ],
          },
        },
      };
      await f.db.tenant(f.workspace, async (c) => {
        const a = await saveArtifact(
          c,
          f.store,
          f.workspace,
          Buffer.from(JSON.stringify({ results: full })),
          { name: "local-sdk-report.json", kind: "evidence" },
        );
        await c.query(
          "UPDATE ai_test_runs SET result_artifact_id=$2 WHERE id=$1",
          [r.id, a.id],
        );
      });
      const wallet = () =>
        f.db.tenant(
          f.workspace,
          async (c) =>
            (
              await c.query(
                "SELECT currency,available,reserved FROM wallets ORDER BY currency",
              )
            ).rows,
        );
      const before = await wallet(),
        sdkCalls = f.calls.length;
      let translationCalls = 0;
      f.engine.reportTranslator = async (_engine, _run, batch) => {
        translationCalls++;
        return {
          translations: batch.map((source) => ({
            source,
            zh: source === "Will it fit?" ? "尺寸适合吗？" : "适合收纳使用",
          })),
          usage: { input_tokens: 20, output_tokens: 12 },
          procurement_micro_cny: "0",
          raw: { fixture: true },
        };
      };
      const path = "/api/ai-tests/runs/" + r.id + "/report";
      assert.equal(
        (await f.request(path, undefined, "GET", f.otherAuth, f.other))
          .statusCode,
        404,
      );
      assert.equal(
        (await f.request(path, {}, "POST", f.otherAuth, f.other)).statusCode,
        404,
      );
      const first = await f.ok(path, {});
      assert.equal(first.result.personas.length, 1);
      assert.equal(first.result.narrative.zh.summary, "保留的中文摘要");
      await f.ok(path, {});
      await f.tick();
      const ready = await f.ok(path);
      assert.equal(ready.result.presentation_zh.status, "ready");
      assert.equal(ready.result.presentation_zh.translations.length, 2);
      assert.equal(ready.result.presentation_zh.usage, undefined);
      assert.equal(ready.result.presentation_zh.source_digest, undefined);
      assert.deepEqual(ready.result.arms.A.buy_rate, full.arms.A.buy_rate);
      assert.equal(translationCalls, 1);
      await f.ok(path, {});
      assert.equal(await f.tick(), false);
      assert.equal(translationCalls, 1);
      assert.deepEqual(await wallet(), before);
      assert.equal(f.calls.length, sdkCalls);
      // Ambiguous interrupted translation must not replay, demote the successful test, or charge.
      await f.db.tenant(f.workspace, async (c) => {
        await c.query(
          `UPDATE ai_test_runs SET result=jsonb_set(result,'{presentation_zh,status}','"translating"'::jsonb) WHERE id=$1`,
          [r.id],
        );
        await c.query(
          "INSERT INTO ai_test_dispatch(id,workspace_id,kind) VALUES($1,$2,'run')",
          [r.id, f.workspace],
        );
      });
      await f.tick();
      const failed = await f.ok(path);
      assert.equal(failed.status, "completed");
      assert.equal(failed.quota_state, "charged");
      assert.equal(failed.result.presentation_zh.status, "failed");
      assert.equal(translationCalls, 1);
      assert.deepEqual(await wallet(), before);
      assert.equal(f.calls.length, sdkCalls);
    } finally {
      await f.close();
    }
  },
);
