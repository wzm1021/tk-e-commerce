import { useState, useEffect, useRef } from "react";
import {
  Button,
  Field,
  Badge,
  ErrorBox,
  Loading,
  JsonView,
} from "../../components/ui.jsx";
import { Dialog } from "../../components/Dialog.jsx";
import { jobStatusExplanation, jobEventExplanation } from "./job-status.mjs";
import { money, datetime, jobLabels } from "../../lib/format.mjs";

export function JobDetail({
  api,
  jobId,
  onClose,
  onRefresh,
  onViewReport,
  onReportReady,
}) {
  const [job, setJob] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const reported = useRef(null);
  useEffect(() => {
    const id = job?.result?.report_id;
    if (job?.id === jobId && id && reported.current !== id) {
      reported.current = id;
      onReportReady?.(id, job.kind);
    }
  }, [job, jobId, onReportReady]);
  useEffect(() => {
    let alive = true;
    setJob(null);
    async function poll() {
      try {
        const r = await api("/api/jobs/" + jobId);
        if (alive) setJob(r);
      } catch (e) {
        if (alive) setError(e.message);
      }
    }
    poll();
    const timer = setInterval(poll, 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [api, jobId]);
  async function act(action, body = {}) {
    setBusy(true);
    setError("");
    try {
      await api(`/api/jobs/${jobId}/${action}`, { method: "POST", body });
      setJob(await api("/api/jobs/" + jobId));
      onRefresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={job?.title || "任务详情"} onClose={onClose} wide>
      <ErrorBox error={error} />
      {!job ? (
        <Loading />
      ) : (
        <>
          <div className="section-line">
            <Badge value={job.status} />
            <span>{datetime(job.created_at)}</span>
          </div>
          <div className="metric-grid three">
            <div>
              <small>模型实际费用</small>
              <strong>¥ {money(job.model_spent)}</strong>
              <small>使用模型：{job.snapshot?.model?.name || "等待连接"}</small>
              <small>
                {job.kind === "monitoring"
                  ? "单次预算内结算，结束退回未用额度"
                  : "按工作区共享余额结算"}
              </small>
            </div>
            <div>
              <small>数据调用</small>
              <strong>
                {job.data_spent} <em>积分</em>
              </strong>
              <small>按实际调用扣除</small>
            </div>
            <div>
              <small>技能固定版本</small>
              <strong>
                {job.snapshot?.skill?.version
                  ? "v" + job.snapshot.skill.version
                  : "待解析"}
              </strong>
              <small>{jobLabels[job.kind]}</small>
            </div>
          </div>
          {jobStatusExplanation(job) && (
            <div className="notice">
              当前状态说明：{jobStatusExplanation(job)}
            </div>
          )}
          <h3>研究过程</h3>
          <ol className="timeline">
            {job.events.map((ev) => (
              <li key={ev.id}>
                <time>{datetime(ev.created_at)}</time>
                <p>{jobEventExplanation(ev, job)}</p>
              </li>
            ))}
          </ol>
          {(job.result?.summary || job.result?.answer) && (
            <section className="panel">
              <h3>研究结果</h3>
              <p className={job.result.answer ? "chat-answer" : undefined}>
                {job.result.answer || job.result.summary}
              </p>
              {job.result.report_id && onViewReport && (
                <Button
                  onClick={() => onViewReport(job.result.report_id, job.kind)}
                >
                  查看本次报告
                </Button>
              )}
              {job.result.limitations?.length > 0 && (
                <ul>
                  {job.result.limitations.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {job.status === "waiting_input" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                act("resume", {
                  input: {
                    response: new FormData(e.currentTarget).get("response"),
                  },
                });
              }}
            >
              <Field label={job.result?.questions?.join("；") || "补充资料"}>
                <textarea name="response" rows={4} required />
              </Field>
              <Button disabled={busy}>补充并继续</Button>
            </form>
          )}
          <details>
            <summary>本次研究条件</summary>
            <JsonView value={job.request} />
          </details>
          <div className="dialog-actions">
            {job.status === "awaiting_connection" && (
              <Button disabled={busy} onClick={() => act("resume")}>
                检查连接并开始
              </Button>
            )}
            {[
              "queued",
              "running",
              "waiting_input",
              "awaiting_connection",
            ].includes(job.status) && (
              <Button
                secondary
                disabled={busy || job.cancel_requested}
                onClick={() => act("cancel")}
              >
                {job.cancel_requested ? "正在停止" : "停止任务"}
              </Button>
            )}
          </div>
        </>
      )}
    </Dialog>
  );
}
