import { errorLabel, stateLabels } from "../../lib/format.mjs";

const emptyScoutingDraft = (job) =>
  job.kind === "scouting" &&
  job.checkpoint?.pending_finish &&
  !(job.checkpoint?.unverified_result?.candidates?.length > 0);

export function jobStatusExplanation(job) {
  if (job.status === "running" && job.snapshot?.model?.response_timeout_seconds)
    return `研究进行中。单次模型响应最多等待 ${job.snapshot.model.response_timeout_seconds} 秒（${job.snapshot.model.response_timeout_seconds / 60} 分钟）；若仍未返回完整结果，会提示“模型无反应”并核对该次调用费用。`;
  if (job.status !== "reconciling")
    return job.error_code ? errorLabel(job.error_code) : null;
  const timeout = job.events?.findLast(
    (event) =>
      event.kind === "reconciling" &&
      (event.data?.code === 23 ||
        event.data?.code === "model_response_timeout"),
  );
  const reservations = [];
  if (Number(job.model_inflight) > 0)
    reservations.push(`模型 ¥${(Number(job.model_inflight) / 1e6).toFixed(6)}`);
  // Job API already converts data_inflight to public points.
  if (Number(job.data_inflight) > 0)
    reservations.push(`数据 ${job.data_inflight} 积分`);
  return [
    timeout
      ? timeout.data?.code === "model_response_timeout" &&
        Number(timeout.data?.timeout_seconds) > 0
        ? `模型无反应：超过 ${timeout.data.timeout_seconds} 秒未返回完整结果，已停止等待。结果与费用尚未确认。`
        : "模型无反应：本次调用等待超时，未返回完整结果，结果与费用尚未确认。"
      : "有调用的结果与费用尚未确认。",
    reservations.length
      ? `本任务待核对预留：${reservations.join("、")}；这是暂时预留，尚未计入实际费用，也未释放。`
      : "请以费用核对记录为准，当前状态不表示预留已释放。",
    emptyScoutingDraft(job)
      ? "已采集的证据已保留，目前没有有效候选报告，需核对费用后恢复研究。"
      : "已有执行记录已保留；费用确认后仍需校验结果，才能确定是否可生成报告。",
  ].join("");
}

export function jobEventExplanation(event, job) {
  if (
    emptyScoutingDraft(job) &&
    event.summary === "执行已结束，已保存草稿，等待最后的调用结算后生成报告"
  )
    return "执行已中断，已保留采集证据；尚未形成有效候选报告，等待费用核对后恢复研究。";
  return event.summary === `任务状态：${event.kind}` && stateLabels[event.kind]
    ? `任务状态：${stateLabels[event.kind]}`
    : event.summary;
}
