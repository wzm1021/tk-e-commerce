import test from "node:test";
import assert from "node:assert/strict";
import {
  nextReportSelection,
  orderedReports,
  recommendationLabel,
} from "../web/features/scouting/report-selection.mjs";
import { publicReportHtml } from "../src/common/public-report.mjs";

const row = (id, captured, updated = captured) => ({
  id,
  created_at: captured,
  updated_at: updated,
  data: { captured_at: captured },
});
const first = row("old", "2026-09-14T01:00:00Z", "2026-09-14T08:00:00Z");
const second = row("latest", "2026-09-14T02:00:00Z");
const completed = row("completed", "2026-09-14T03:00:00Z");
const initial = { id: null, newestId: null, focus: null };

test("new completion replaces a stale report; a maintenance revision cannot become latest", () => {
  assert.deepEqual(
    orderedReports([first, second]).map((r) => r.id),
    ["latest", "old"],
  );
  let selection = nextReportSelection([first, second], initial);
  assert.equal(selection.id, "latest");
  selection = { ...selection, id: "old" };
  assert.equal(nextReportSelection([first, second], selection).id, "old");
  selection = nextReportSelection([first, second, completed], selection);
  assert.equal(selection.id, "completed");
  assert.equal(
    nextReportSelection([first, second, completed], selection).id,
    "completed",
  );
});

test("view this report opens the task's exact result, including after an in-flight list response", () => {
  const focus = { id: "completed" };
  let selection = nextReportSelection([first, second], initial, focus);
  assert.equal(selection.focus, null);
  selection = nextReportSelection([first, second, completed], selection, focus);
  assert.equal(selection.id, "completed");
  assert.equal(selection.focus, focus);
  const older = { id: "old" };
  selection = nextReportSelection([first, second, completed], selection, older);
  assert.equal(selection.id, "old");
  assert.equal(
    nextReportSelection([first, second, completed], selection, older).id,
    "old",
  );
  assert.equal(nextReportSelection([], selection).id, null);
});

test("retired A/B badges disappear from archived HTML and do not override candidate recommendations", () => {
  assert.equal(
    recommendationLabel({ decision: "shortlist", strategy_a: "failed" }),
    "优先研究",
  );
  assert.equal(recommendationLabel({ decision: "reject" }), "暂不推进");
  const raw =
    '<meta name="report-template" content="scouting-editorial-v5"><div class="strategy-row"><span>A · 未通过</span><span>B · 待核验</span></div><details><summary>证据</summary><div class="criteria-grid"><div>FastMoss 评分门槛 <strong>未通过</strong></div></div><p>来源评分 3.8；接口值保持不变。</p></details><div class="strategy-row">模型建议：继续观察</div><a href="#source-1">证据 [1]</a>';
  const html = publicReportHtml(raw);
  assert.ok(!html.includes("A · 未通过"));
  assert.ok(!html.includes("B · 待核验"));
  assert.ok(!html.includes("评分门槛"));
  assert.ok(html.includes("来源评分 3.8；接口值保持不变。"));
  assert.ok(
    html.includes('<div class="strategy-row">模型建议：继续观察</div>'),
  );
  assert.ok(html.includes('<a href="#source-1">证据 [1]</a>'));
  assert.equal(publicReportHtml(html), html);
});
