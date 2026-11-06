import { requireThat } from "../common/core.mjs";

// Source authorization remains fatal. A model's overly strong review label is
// downgraded instead of discarding an otherwise usable research report.
export function assessPolicyChecks(checks, sources) {
  const limitations = [];
  const policy_checks = checks.map((check) => {
    for (const id of check.evidence_ids)
      requireThat(sources.has(id), "unrecognized_evidence", 409);
    const allRead =
      check.evidence_ids.length > 0 &&
      check.evidence_ids.every(
        (id) =>
          sources.get(id).tool === "policy_fetch" &&
          sources.get(id).status === "fetched",
      );
    if (check.status !== "reviewed" || allRead) return check;
    limitations.push(
      `政策「${check.scope}」的引用包含未读页面、搜索线索或其他非政策页面来源，尚不足以确认已完成查阅，保留待核验。`,
    );
    return {
      ...check,
      status: "pending",
      action: `先补充并核对可读的官方页面；当前引用尚未全部完成页面读取。\n${check.action}`,
    };
  });
  return { policy_checks, limitations };
}
