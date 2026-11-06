import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  RESULT_JSON_SCHEMA,
  ResultSchema,
  renderReport,
} from "../src/reports/reports.mjs";
import {
  validateResearchResult,
  ensureResearchResult,
} from "../src/agent/research-result.mjs";
import {
  researchPrompt,
  specialistReviewPrompt,
} from "../src/agent/research-prompt.mjs";
import { reportPage } from "../web/features/research/report-navigation.mjs";
import { researchKinds, SPECIALIST_KINDS } from "../src/research/scope.mjs";
import { reportBody } from "../src/reports/specialist-report.mjs";

const source = "cdc0f30c-0166-4f65-9738-b1668f62210b";
const analysis = {
  summary: "原始分析",
  evidence_ids: [source],
  limitations: [],
};
const result = () => ({
  status: "complete",
  summary: "主样本有 12 条可分析评论。",
  sections: [
    {
      title: "买家痛点",
      body: "FastMoss 原文 <script>alert(1)</script>\n评论日期：2026-07-29",
      kind: "observed",
      evidence_ids: [source],
    },
  ],
  candidates: [],
  questions: [],
  limitations: ["近期样本缺失，使用历史样本。"],
  next_actions: [{ title: "核对密封步骤", reason: "评论提到漏气。" }],
});
const candidate = () => ({
  product_id: "1732150942467199345",
  title: "收纳袋",
  tk_url: null,
  image: null,
  decision: "watch",
  reason: "需检查封边。",
  evidence: [],
  limitations: [],
  research: {
    growth: analysis,
    competition: analysis,
    reputation: { summary: "真实评论分析", evidence_ids: [source] },
    test_plan: {
      summary: "抽检",
      rationale: "漏气反馈",
      evidence_ids: [source],
      assumptions: [],
    },
    links: [],
  },
});

test("real review failure: missing reputation limitations is diagnosed and repaired once without discarding analysis", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "research-schema-"));
  try {
    const draft = { ...result(), candidates: [candidate()] };
    assert.equal(ResultSchema.safeParse(draft).success, false);
    await writeFile(
      path.join(root, "result.schema.json"),
      JSON.stringify(RESULT_JSON_SCHEMA),
    );
    await writeFile(path.join(root, "result.json"), JSON.stringify(draft));
    const errors = await validateResearchResult(root);
    assert.equal(errors[0].path, "/candidates/0/research/reputation");
    assert.equal(errors[0].params.missingProperty, "limitations");
    let calls = 0;
    await ensureResearchResult(async (prompt) => {
      calls++;
      assert.match(prompt, /禁止调用任何数据或政策工具/);
      draft.candidates[0].research.reputation.limitations = [];
      await writeFile(path.join(root, "result.json"), JSON.stringify(draft));
    }, root);
    assert.equal(calls, 1);
    const saved = JSON.parse(
      await readFile(path.join(root, "result.json"), "utf8"),
    );
    assert.equal(
      ResultSchema.parse(saved).candidates[0].research.reputation.summary,
      "真实评论分析",
    );
    await ensureResearchResult(
      () => assert.fail("valid result must not trigger more model calls"),
      root,
    );
    // The diagnostics failure used the Analysis shape for test_plan.
    draft.candidates[0].research.test_plan = analysis;
    await writeFile(path.join(root, "result.json"), JSON.stringify(draft));
    calls = 0;
    await assert.rejects(
      ensureResearchResult(async () => {
        calls++;
      }, root),
      /research_output_invalid/,
    );
    assert.equal(calls, 1);
    const invalid = await validateResearchResult(root);
    assert.ok(invalid.some((e) => e.params.missingProperty === "rationale"));
    assert.ok(invalid.some((e) => e.params.missingProperty === "assumptions"));
    assert.equal(
      JSON.parse(await readFile(path.join(root, "result.json"), "utf8"))
        .sections[0].title,
      "买家痛点",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("specialist prompts and navigation follow the research kind, without required scouting sections", () => {
  assert.equal(researchKinds(undefined), null);
  assert.deepEqual(researchKinds("scouting"), ["scouting"]);
  assert.deepEqual(researchKinds("specialist"), SPECIALIST_KINDS);
  assert.throws(() => researchKinds("other"));
  for (const kind of SPECIALIST_KINDS) {
    const prompt = researchPrompt({
      kind,
      snapshot: { skill: { skill_id: "test" } },
      request: { target: "真实对象" },
    });
    assert.doesNotMatch(prompt, /选品报告须包含/);
    assert.match(prompt, /candidates 可以为空数组/);
    assert.match(prompt, /未开放政策网页工具/);
    assert.equal(reportPage(kind), "research");
    const review = specialistReviewPrompt(kind);
    assert.match(review, /本轮没有数据或政策 MCP 工具/);
    assert.match(review, /从每组原始列表重算/);
    assert.match(review, /不得把未完成任务改成 complete/);
  }
  assert.match(
    researchPrompt({
      kind: "scouting",
      snapshot: { skill: { skill_id: "test" } },
      request: {},
    }),
    /选品报告须包含/,
  );
  assert.equal(reportPage("scouting"), "scouting");
});

test("specialist report retains analysis and citations, with concise summary and no eligibility columns", () => {
  const draft = result();
  draft.candidates = [
    { ...candidate(), strategy_a: "failed", strategy_b: "unverified" },
  ];
  const html = renderReport(draft, {
    kind: "reviews",
    title: "评论验收",
    skill_version: 1,
    created_at: "2026-09-14",
    sources: new Map([[source, { captured_at: "2026-09-14T10:00:00Z" }]]),
  });
  assert.match(html, /先给结论/);
  assert.match(html, /展开完整摘要/);
  assert.match(html, /主样本有 12 条可分析评论。/);
  assert.match(html, /href="#source-1"/);
  assert.match(html, /id="source-1"/);
  assert.match(html, /需检查封边/);
  assert.match(html, /数据API/);
  assert.doesNotMatch(html, /FastMoss|策略 A|未通过|unverified|<script>/);
  assert.match(html, /&lt;script&gt;/);
  const empty = renderReport(result(), { kind: "reviews", title: "评论验收" });
  assert.doesNotMatch(empty, /0 个候选|相关商品分析/);
  const table = reportBody(
    "实际样本\n\n| 主题 | n/N |\n| --- | --- |\n| <img src=x onerror=alert(1)> | 3/6 |\n\n仅代表本批评论。",
  );
  assert.match(table, /<th>主题<\/th>/);
  assert.match(table, /<td>3\/6<\/td>/);
  assert.doesNotMatch(table, /<img/);
  assert.match(table, /仅代表本批评论/);
  assert.match(
    reportBody("| 窗口 | GMV |\n| 基期 | 17,362.97 |\n| 本期 | 37,626.35 |"),
    /<td>37,626.35<\/td>/,
  );
});
