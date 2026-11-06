import { useLoad } from "../../hooks/useLoad.mjs";
import { Dialog } from "../../components/Dialog.jsx";
import { Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  ErrorBox,
  Loading,
  Empty,
} from "../../components/ui.jsx";
import { datetime, errorLabel } from "../../lib/format.mjs";

export function MonitorDetail({
  api,
  id,
  version,
  onClose,
  onJob,
  onEdit,
  onDelete,
}) {
  const { data, error } = useLoad(api, `/api/monitors/${id}`, version);
  return (
    <Dialog title={data?.item.name || "竞店巡检详情"} onClose={onClose} wide>
      <ErrorBox error={error} />
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="section-line">
            <span>
              {data.item.market} · {data.item.seller_id}
            </span>
            {data.item.status === "archived" ? (
              <span className="muted">监控已删除，历史记录保留</span>
            ) : (
              <div className="actions">
                <Button secondary onClick={() => onEdit(data.item)}>
                  编辑规则
                </Button>
                <Button
                  className="button secondary monitor-delete"
                  onClick={() => onDelete(data.item)}
                >
                  <Trash2 size={14} />
                  删除监控
                </Button>
              </div>
            )}
          </div>
          <div className="metric-grid three">
            <div>
              <small>本月模型已用与预留</small>
              <strong>¥ {Number(data.usage.model).toFixed(2)}</strong>
              <small>上限 ¥ {data.item.config.monthly_model_budget}</small>
            </div>
            <div>
              <small>本月数据已用与预留</small>
              <strong>
                {data.usage.data} <em>积分</em>
              </strong>
              <small>上限 {data.item.config.monthly_data_budget} 积分</small>
            </div>
            <div>
              <small>巡检周期</small>
              <strong>
                {data.item.config.interval_hours} <em>小时</em>
              </strong>
              <small>{data.usage.period}</small>
            </div>
          </div>
          <h3>最近 30 轮巡检</h3>
          {!data.runs.length ? (
            <Empty title="正在等待首次巡检">
              首轮完成后显示店铺身份、基线和实际费用。
            </Empty>
          ) : (
            <div className="monitor-runs">
              {data.runs.map((run) => (
                <article className="monitor-run" key={run.job_id}>
                  <div className="section-line">
                    <span>
                      {datetime(run.created_at)} ·{" "}
                      {run.trigger === "manual" ? "手动" : "定时"}
                    </span>
                    <Badge value={run.status} />
                  </div>
                  <p className="muted">
                    模型 ¥ {Number(run.model_spent).toFixed(4)} · 数据{" "}
                    {run.data_spent} 积分
                  </p>
                  {run.error_code && (
                    <p className="notice">{errorLabel(run.error_code)}</p>
                  )}
                  {run.snapshot && (
                    <>
                      <p>
                        {run.snapshot.shop_name || "身份待核验"} ·{" "}
                        {run.snapshot.currency || "币种待核验"}
                      </p>
                      <p className="muted">
                        采集记录时间：{datetime(run.snapshot.captured_at)}
                        <br />
                        来源更新时间：{run.snapshot.source_updated_at || "未知"}
                        （源时区未知）
                      </p>
                      {run.snapshot.window && (
                        <p>
                          日趋势：{run.snapshot.window.start} 至{" "}
                          {run.snapshot.window.end} · GMV{" "}
                          {run.snapshot.window.current_gmv}{" "}
                          {run.snapshot.currency} · 销量{" "}
                          {run.snapshot.window.current_units} 件
                        </p>
                      )}
                      {run.snapshot.issues.length > 0 && (
                        <ul className="monitor-issues">
                          {run.snapshot.issues.map((x, i) => (
                            <li key={i}>{x}</li>
                          ))}
                        </ul>
                      )}
                      <details>
                        <summary>本轮证据与商品快照</summary>
                        <ul>
                          {Object.entries(run.snapshot.sources).map(
                            ([tool, source]) => (
                              <li key={tool}>
                                <span>
                                  {tool} · {datetime(source.captured_at)}
                                </span>
                                <br />
                                <code>{source.invocation_id}</code>
                              </li>
                            ),
                          )}
                        </ul>
                        {run.snapshot.products?.length ? (
                          <ol>
                            {run.snapshot.products.map((p) => (
                              <li key={p.product_id}>
                                {p.title} <small>（{p.product_id}）</small>
                              </li>
                            ))}
                          </ol>
                        ) : (
                          <p>本轮没有可展示的商品榜单。</p>
                        )}
                      </details>
                    </>
                  )}
                  <Button secondary onClick={() => onJob(run.job_id)}>
                    任务与完整报告
                  </Button>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}
