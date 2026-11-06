import test from "node:test";
import assert from "node:assert/strict";
import { assessPolicyChecks } from "../src/reports/policy-assessment.mjs";
const sources = new Map([
  ["read", { tool: "policy_fetch", status: "fetched" }],
  ["search", { tool: "policy_search", status: "searched" }],
  ["unavailable", { tool: "policy_fetch", status: "unavailable" }],
  ["commerce", { tool: "product_detail_info" }],
]);
const check = {
  scope: "Claims",
  summary: "Model policy interpretation",
  action: "Check labels",
  status: "reviewed",
  evidence_ids: ["read"],
};
test("policy review labels require only read pages; discovery and unavailable references stay pending", () => {
  assert.deepEqual(assessPolicyChecks([check], sources), {
    policy_checks: [check],
    limitations: [],
  });
  for (const ids of [
    ["read", "search"],
    ["read", "unavailable"],
    ["commerce"],
    [],
  ]) {
    const original = { ...check, evidence_ids: ids };
    const r = assessPolicyChecks([original], sources);
    assert.equal(r.policy_checks[0].status, "pending");
    assert.equal(r.policy_checks[0].summary, check.summary);
    assert.deepEqual(r.policy_checks[0].evidence_ids, ids);
    assert.equal(r.limitations.length, 1);
    assert.match(r.policy_checks[0].action, /先补充/);
    assert.equal(original.status, "reviewed");
  }
});
test("foreign or unknown policy source IDs are still rejected, even for pending checks", () => {
  for (const status of ["reviewed", "pending"])
    assert.throws(
      () =>
        assessPolicyChecks(
          [{ ...check, status, evidence_ids: ["foreign"] }],
          sources,
        ),
      /unrecognized_evidence/,
    );
  const pending = {
    ...check,
    status: "pending",
    evidence_ids: ["unavailable"],
  };
  assert.deepEqual(assessPolicyChecks([pending], sources), {
    policy_checks: [pending],
    limitations: [],
  });
});
