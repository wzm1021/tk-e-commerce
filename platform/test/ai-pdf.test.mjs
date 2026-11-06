import test from "node:test";
import assert from "node:assert/strict";
import { reportDocument } from "../src/ai-testing/pdf-document.mjs";
import {
  pdfName,
  pdfDigest,
  renderPdf,
  publicPdf,
  PDF_VERSION,
} from "../src/ai-testing/pdf.mjs";
import { emptyDraft } from "../src/ai-testing/contract.mjs";
import { aiFixture } from "./fixtures/ai-testing.mjs";
import { saveArtifact } from "../src/files/artifacts.mjs";

function documentFixture() {
  const data = emptyDraft();
  data.name = "完整中文报告排版验收";
  data.arms[0].url = "https://www.tiktok.com/shop/pdp/1729613111070136690";
  data.arms[0].product.name = "竹制收纳架";
  data.arms[1].other_product = true;
  data.arms[1].product.name = "金属收纳架";
  data.arms[1].change_summary = "另一款商品使用独立截图";
  const run = {
    snapshot: { data, confirmed_at: "2026-10-18T00:00:00Z", images: [] },
  };
  const result = {
    sample: { personas_completed: 10, personas_planned: 10 },
    arms: Object.fromEntries(
      ["A", "B"].map((id) => [
        id,
        {
          buy_rate: { value: 0.733, ci95: [0.567, 0.9] },
          buy_sessions: 22,
          valid_sessions: 30,
          top_buy_reasons: [
            { category: "positive_fit", sessions: 22, share_of_buy: 1 },
          ],
          top_concerns: [
            { category: "fit_size", sessions: 8, share_of_non_buy: 1 },
          ],
          common_questions: ["Will it fit?"],
        },
      ]),
    ),
    comparisons: [
      {
        arm: "B",
        vs: "A",
        difference: 0.033,
        ci: [-0.167, 0.233],
        ci_level: 0.95,
        stability: "no_difference",
      },
    ],
    narrative: {
      zh: {
        headline: "未发现明确差异",
        summary: "应先补充尺寸说明。",
        main_concerns: ["消费者担心尺寸不合适"],
        audience_insights: ["小户型家庭有收纳需求"],
        next_steps: [{ action: "补充测量图", based_on: "消费者提出尺寸问题" }],
        limitations: ["模拟不能预测实际销量"],
      },
    },
    recommendations: Object.fromEntries(
      [
        "test_design",
        "rollout",
        "page_optimization",
        "risk_mitigation",
        "success_metrics",
      ].map((k, i) => [
        k,
        [
          {
            title: { zh: `建议标题 ${i}` },
            detail: { zh: `完整建议正文 ${i}` },
          },
        ],
      ]),
    ),
    segments: [
      {
        dimension: "gender",
        value: "Female",
        personas: 4,
        buy_rate: { A: 0.5, B: 0.6 },
        buy_rate_ci: { A: [0.3, 0.7], B: [0.4, 0.8] },
        small_sample: true,
      },
    ],
    personas: Array.from({ length: 10 }, (_, i) => ({
      persona_id: "private-persona-" + i,
      profile: { age: "20-30", gender: "Female" },
      arms: {
        A: {
          buy_rate: 0.667,
          decisions: [1, 0, 1],
          primary_reason: "适合整理日常用品",
          primary_concern: "担心尺寸不够",
          questions: ["Will it fit?"],
        },
        B: {
          buy_rate: 0,
          decisions: [0, 0, 0],
          primary_reason: "尚未决定购买",
          primary_concern: "希望了解材质",
          questions: ["是否有保修？"],
        },
      },
    })),
    data_gaps: ["缺少内尺寸"],
    scope_warnings: ["整体方案比较"],
    presentation_zh: {
      status: "ready",
      translations: [{ source: "Will it fit?", zh: "尺寸合适吗？" }],
    },
  };
  return { run, result };
}
test("PDF includes every report section, all personas, comparison units and confirmed product inputs", async () => {
  const { run, result } = documentFixture();
  const html = await reportDocument(
    run,
    result,
    [],
    new Date("2026-10-18T00:00:00Z"),
  );
  for (const value of [
    "探阔 Tanviko",
    "看清机会，行动有据。",
    "01 测品结论",
    "09 本次确认的信息与截图",
    "95% 区间",
    "B 对比 A",
    "3.3 个百分点",
    "-16.7 个百分点 至 23.3 个百分点",
    "尺寸合适吗？",
    "符合需求，能解决实际问题",
    "担心尺寸或适配性",
    "虚拟消费者 10",
    "完整建议正文 4",
    "另一款商品",
    "另一款商品使用独立截图",
    run.snapshot.data.arms[0].url,
  ])
    assert.ok(html.includes(value), value);
  assert.equal((html.match(/class="persona"/g) || []).length, 10);
  for (const hidden of [
    "positive_fit",
    "fit_size",
    "Will it fit?",
    "private-persona-",
    "<details",
    "<script",
  ])
    assert.ok(!html.includes(hidden), hidden);
  assert.match(html, /购买 \/ 不购买 \/ 购买/);
  assert.match(html, /0\.0%/);
  assert.equal(
    pdfDigest(run, result),
    pdfDigest(run, { ...result, pdf_zh: { status: "ready" } }),
  );
});
test("PDF downloads invalidate old branded exports while preserving current exports", () => {
  const { run } = documentFixture();
  run.result = {
    pdf_zh: {
      version: PDF_VERSION - 1,
      status: "ready",
      artifact_id: "old-pdf",
    },
  };
  assert.deepEqual(publicPdf(run), { status: "not_requested" });
  run.result.pdf_zh = {
    version: PDF_VERSION,
    status: "ready",
    artifact_id: "current-pdf",
  };
  assert.equal(publicPdf(run).artifact_id, "current-pdf");
  run.result.pdf_zh.status = "rendering";
  assert.equal(publicPdf(run).artifact_id, null);
});
test("PDF escapes text, refuses executable product links and sanitizes download names", async () => {
  const { run, result } = documentFixture();
  run.snapshot.data.name = "坏标题/\\\r\n<script>alert(1)</script>";
  run.snapshot.data.arms[0].url = "javascript:alert(1)";
  result.personas[0].arms.A.primary_reason =
    '<img src="https://attacker.invalid/secret">中文';
  const html = await reportDocument(run, result, []);
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(!html.includes('<img src="https://'));
  assert.ok(html.includes("&lt;img"));
  assert.ok(!/[\x00-\x1f/\\]/.test(pdfName(run)));
  assert.ok(pdfName(run).endsWith(".pdf"));
});
test(
  "offline renderer produces a real PDF",
  { skip: !process.env.AI_TEST_BROWSER_PATH },
  async () => {
    const { run, result } = documentFixture();
    const bytes = await renderPdf(await reportDocument(run, result, []));
    assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
    assert.ok(bytes.length > 10000 && bytes.length < 12 * 1024 * 1024);
  },
);
test(
  "PDF export is tenant-isolated, cached, retryable and never changes test billing",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const f = await aiFixture();
    try {
      let d = await f.ok("/api/ai-tests", {});
      const data = d.data;
      data.name = "PDF下载本地测试";
      data.shopper_problem = "收纳日常物品";
      data.arms[0].product.name = "收纳架";
      data.arms[0].product.use = "整理物品";
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
      const getRun = () =>
        f.db.tenant(
          f.workspace,
          async (c) =>
            (
              await c.query("SELECT * FROM ai_test_runs WHERE id=$1", [
                submitted.id,
              ])
            ).rows[0],
        );
      const before = await getRun(),
        sdkCalls = f.calls.length;
      const balances = () =>
        f.db.tenant(f.workspace, async (c) => ({
          wallets: (await c.query("SELECT * FROM wallets ORDER BY currency"))
            .rows,
          ledger: (await c.query("SELECT * FROM ledger ORDER BY id")).rows,
        }));
      const billing = await balances();
      const path = `/api/ai-tests/runs/${submitted.id}/report/pdf`;
      for (const method of ["GET", "POST"])
        assert.equal(
          (
            await f.request(
              path,
              method === "POST" ? {} : undefined,
              method,
              f.otherAuth,
              f.other,
            )
          ).statusCode,
          404,
        );
      let renders = 0;
      f.engine.pdfRenderer = async (html) => {
        renders++;
        assert.equal(
          (html.match(/<img src="data:image\/jpeg;base64,/g) || []).length,
          2,
        );
        return Buffer.from("%PDF-1.7\nlocal-test-only");
      };
      const prepared = await Promise.all([f.ok(path, {}), f.ok(path, {})]);
      assert.ok(prepared.every((p) => p.status === "queued"));
      await f.tick();
      const ready = await f.ok(path);
      assert.equal(ready.status, "ready");
      assert.ok(ready.artifact_id);
      const download = await f.request(
        `/api/artifacts/${ready.artifact_id}?download=1`,
      );
      assert.equal(download.statusCode, 200);
      assert.equal(download.headers["content-type"], "application/pdf");
      assert.ok(
        download.headers["content-disposition"].startsWith("attachment;"),
      );
      assert.equal(
        (
          await f.request(
            `/api/artifacts/${ready.artifact_id}`,
            undefined,
            "GET",
            f.otherAuth,
            f.other,
          )
        ).statusCode,
        404,
      );
      assert.deepEqual(await f.ok(path, {}), ready);
      assert.equal(await f.tick(), false);
      assert.equal(renders, 1);
      await f.db.tenant(f.workspace, (c) =>
        c.query(
          "UPDATE ai_test_runs SET result=jsonb_set(result,'{pdf_zh,status}','\"failed\"'::jsonb) WHERE id=$1",
          [submitted.id],
        ),
      );
      f.engine.pdfRenderer = async () => {
        throw Error("local renderer unavailable");
      };
      await f.ok(path, {});
      await f.tick();
      assert.equal((await f.ok(path)).status, "failed");
      f.engine.pdfRenderer = async () =>
        Buffer.from("%PDF-1.7\nlocal-retry-only");
      await f.ok(path, {});
      await f.tick();
      assert.equal((await f.ok(path)).status, "ready");
      const after = await getRun();
      assert.equal(after.status, "completed");
      assert.equal(after.quota_state, before.quota_state);
      assert.deepEqual(after.result.arms, before.result.arms);
      assert.deepEqual(await balances(), billing);
      assert.equal(f.calls.length, sdkCalls);
      // An incomplete translation must not be published as a complete Chinese PDF.
      await f.db.tenant(f.workspace, async (c) => {
        const results = structuredClone(before.result);
        results.arms.A.common_questions = ["Is it durable?"];
        const a = await saveArtifact(
          c,
          f.store,
          f.workspace,
          Buffer.from(JSON.stringify({ results })),
          { name: "translation-pending-fixture.json", kind: "evidence" },
        );
        await c.query(
          "UPDATE ai_test_runs SET result_artifact_id=$2 WHERE id=$1",
          [submitted.id, a.id],
        );
      });
      const blocked = await f.request(path, {});
      assert.equal(blocked.statusCode, 409);
      assert.equal(blocked.json().error, "ai_pdf_translation_pending");
    } finally {
      await f.close();
    }
  },
);
