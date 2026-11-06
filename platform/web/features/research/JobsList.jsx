import { useEffect, useState } from "react";
import { ArrowUpRight, FileText } from "lucide-react";
import { useLoad } from "../../hooks/useLoad.mjs";
import { Badge, ErrorBox, Loading } from "../../components/ui.jsx";
import { money, datetime, jobLabels } from "../../lib/format.mjs";

export function JobsList({ api, version, onOpen, scope, platform }) {
  const [pollVersion, setPollVersion] = useState(0);
  const { data, error } = useLoad(
    api,
    "/api/jobs" +
      (scope ? `?research_scope=${scope}` : "?") +
      (platform ? `&platform=${platform}` : ""),
    `${version}:${pollVersion}`,
  );
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") setPollVersion((v) => v + 1);
    }, 10000);
    return () => clearInterval(timer);
  }, []);
  return (
    <section className="panel compact">
      <div className="section-line">
        <h2>研究任务</h2>
        <small>队列、证据与费用可追溯</small>
      </div>
      <ErrorBox error={error} />
      {!data && !error ? (
        <Loading />
      ) : !data?.items.length ? (
        <p className="muted">
          还没有研究任务。连接配置就绪后，任务会交给 Agent 执行。
        </p>
      ) : (
        <div className="job-list">
          {data.items.map((j) => (
            <button className="job-row" key={j.id} onClick={() => onOpen(j.id)}>
              <span className="job-symbol">
                <FileText size={18} />
              </span>
              <span>
                <strong>{j.title}</strong>
                <small>
                  {jobLabels[j.kind]} · {datetime(j.created_at)}
                </small>
              </span>
              <Badge value={j.status} />
              <span className="job-cost">
                ¥ {money(j.model_spent)}
                <small>{j.data_spent} 积分</small>
              </span>
              <ArrowUpRight size={16} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
