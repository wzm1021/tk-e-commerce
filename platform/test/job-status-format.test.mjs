import test from "node:test";
import assert from "node:assert/strict";
import { errorLabel } from "../web/lib/format.mjs";
import {
  jobStatusExplanation,
  jobEventExplanation,
} from "../web/features/research/job-status.mjs";

test("reconciliation shows actual pending funds and never claims an empty template is a report", () => {
  const job = {
    kind: "scouting",
    status: "reconciling",
    error_code: "agent_execution_failed",
    model_inflight: "3052408",
    data_inflight: "0",
    checkpoint: { pending_finish: true, unverified_result: { candidates: [] } },
    events: [{ kind: "reconciling", data: { code: 23 } }],
  };
  const text = jobStatusExplanation(job);
  assert.match(text, /等待超时/);
  assert.match(text, /¥3\.052408/);
  assert.match(text, /未释放/);
  assert.match(text, /没有有效候选报告/);
  assert.doesNotMatch(text, /预留已释放/);
  assert.match(
    jobEventExplanation(
      { summary: "执行已结束，已保存草稿，等待最后的调用结算后生成报告" },
      job,
    ),
    /尚未形成有效候选报告/,
  );
  assert.match(
    jobStatusExplanation({ ...job, model_inflight: "0", data_inflight: "0.3" }),
    /数据 0\.3 积分/,
  );
  assert.doesNotMatch(
    jobStatusExplanation({
      ...job,
      checkpoint: { unverified_result: { candidates: [{}] } },
    }),
    /没有有效候选报告/,
  );
  assert.equal(jobStatusExplanation({ status: "succeeded" }), null);
  assert.doesNotMatch(errorLabel("agent_execution_failed"), /预留已释放/);
  assert.doesNotMatch(text, /600/); // Historical timeouts retain their original meaning.
  const current = jobStatusExplanation({
    ...job,
    events: [
      {
        kind: "reconciling",
        data: { code: "model_response_timeout", timeout_seconds: 600 },
      },
    ],
  });
  assert.match(current, /模型无反应：超过 600 秒未返回完整结果/);
  assert.match(current, /未释放/);
  assert.match(
    jobStatusExplanation({
      status: "running",
      snapshot: { model: { response_timeout_seconds: 600 } },
    }),
    /600 秒（10 分钟）/,
  );
  assert.match(errorLabel("model_response_timeout"), /600 秒/);
});

test("interrupted settlement and report delivery statuses have readable explanations", () => {
  for (const code of [
    "late_usage_settled",
    "worker_lease_expired",
    "report_delivery_failed",
  ])
    assert.match(errorLabel(code), /[\u4e00-\u9fff]/);
});
