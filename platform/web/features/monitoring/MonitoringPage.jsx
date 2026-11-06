import { useEffect, useRef, useState } from "react";
import { Plus, RefreshCw, Radar, Play, Pause, Trash2 } from "lucide-react";
import { PageTitle } from "../../components/PageTitle.jsx";
import {
  Badge,
  Button,
  Empty,
  ErrorBox,
  Loading,
} from "../../components/ui.jsx";
import { useLoad } from "../../hooks/useLoad.mjs";
import { datetime, errorLabel } from "../../lib/format.mjs";
import { MonitorForm } from "./MonitorForm.jsx";
import { MonitorDetail } from "./MonitorDetail.jsx";
import { DeleteMonitorDialog } from "./DeleteMonitorDialog.jsx";
import { Reports } from "../scouting/Reports.jsx";
import { randomId } from "../../lib/client-id.mjs";

export function MonitoringPage({
  api,
  catalog,
  workspace,
  version,
  reload,
  onJob,
  onResearch,
  focusReport,
  focusMonitor,
  onFocusHandled,
}) {
  const [poll, setPoll] = useState(0),
    [tab, setTab] = useState("shops"),
    [form, setForm] = useState(null),
    [detail, setDetail] = useState(null),
    [deleting, setDeleting] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [unreadOnly, setUnreadOnly] = useState(false),
    [message, setMessage] = useState("");
  const keys = useRef(new Map());
  const revision = `${version}:${poll}`;
  const { data, error: listError } = useLoad(api, "/api/monitors", revision);
  const { data: feed, error: feedError } = useLoad(
    api,
    "/api/monitors/events",
    revision,
  );
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") setPoll((x) => x + 1);
    }, 15000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (focusReport?.id) setTab("reports");
  }, [focusReport?.id]);
  useEffect(() => {
    if (!focusMonitor?.id) return;
    setTab("shops");
    setDetail(focusMonitor.id);
    onFocusHandled?.();
  }, [focusMonitor, onFocusHandled]);
  async function act(fn) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
      reload();
      setPoll((x) => x + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function run(m) {
    if (!keys.current.has(m.id)) keys.current.set(m.id, randomId());
    await act(async () => {
      const result = await api(`/api/monitors/${m.id}/run`, {
        method: "POST",
        body: { idempotency_key: keys.current.get(m.id) },
      });
      keys.current.delete(m.id);
      onJob(result.job.id);
    });
  }
  const items = data?.items || [],
    events = (feed?.items || []).filter((x) => !unreadOnly || !x.read_at);
  return (
    <>
      <PageTitle
        eyebrow="COMPETITOR MONITORING"
        title="竞店监控"
        description="定时查看竞店变化，保留每轮证据，只提醒值得跟进的新事件。"
      >
        <Button
          secondary
          aria-label="刷新竞店监控"
          onClick={() => setPoll((x) => x + 1)}
        >
          <RefreshCw size={16} />
          刷新
        </Button>
        <Button onClick={() => setForm({})}>
          <Plus size={16} />
          添加竞店
        </Button>
      </PageTitle>
      <ErrorBox error={error || listError || feedError} />
      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}
      <div className="metric-grid three monitor-stats">
        <div>
          <small>正在监控</small>
          <strong>
            {items.filter((x) => x.status === "active").length}
            <em> / {items.length} 家</em>
          </strong>
        </div>
        <div>
          <small>未读变化事件</small>
          <strong>{items.reduce((n, x) => n + x.unread_count, 0)}</strong>
        </div>
        <div>
          <small>巡检范围</small>
          <strong className="monitor-scope">GMV · 销量 · 商品前 10</strong>
          <small>基于数据API来源报告值</small>
        </div>
      </div>
      <div className="tabs" role="tablist" aria-label="竞店监控视图">
        {[
          ["shops", "监控店铺"],
          ["events", "变化事件"],
          ["reports", "巡检报告"],
        ].map(([key, title]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? "active" : ""}
            onClick={() => setTab(key)}
          >
            {title}
          </button>
        ))}
      </div>
      {tab === "shops" &&
        (!data ? (
          <Loading />
        ) : !items.length ? (
          <Empty title="添加第一家要盯的竞店">
            每天检查完整日趋势和商品榜单。首次建立基线，后续变化自动进入事件列表。
          </Empty>
        ) : (
          <div className="monitor-grid">
            {items.map((m) => (
              <article className="panel monitor-card" key={m.id}>
                <div className="section-line">
                  <Radar size={20} />
                  <Badge
                    value={m.status}
                    label={m.status === "active" ? "监控中" : "已暂停"}
                  />
                </div>
                <h2>
                  <button
                    className="text-button"
                    onClick={() => setDetail(m.id)}
                  >
                    {m.name}
                  </button>
                </h2>
                <p className="muted">
                  {m.market} · {m.seller_id}
                </p>
                <dl className="monitor-meta">
                  <div>
                    <dt>下次巡检</dt>
                    <dd>
                      {m.status === "paused"
                        ? "已暂停"
                        : datetime(m.next_run_at)}
                    </dd>
                  </div>
                  <div>
                    <dt>最近完成</dt>
                    <dd>{datetime(m.last_completed_at)}</dd>
                  </div>
                  <div>
                    <dt>最近任务</dt>
                    <dd>
                      {m.last_status ? (
                        <Badge value={m.last_status} />
                      ) : (
                        "等待首次巡检"
                      )}
                    </dd>
                  </div>
                </dl>
                {m.last_error && (
                  <p className="notice">{errorLabel(m.last_error)}</p>
                )}
                {!!m.unread_count && (
                  <button
                    className="text-button"
                    onClick={() => setTab("events")}
                  >
                    {m.unread_count} 条未读变化
                  </button>
                )}
                <div className="actions monitor-card-actions">
                  <Button disabled={busy} onClick={() => run(m)}>
                    立即巡检
                  </Button>
                  <Button
                    secondary
                    disabled={busy}
                    onClick={() =>
                      act(() =>
                        api(`/api/monitors/${m.id}/status`, {
                          method: "POST",
                          body: {
                            status: m.status === "active" ? "paused" : "active",
                          },
                        }),
                      )
                    }
                  >
                    {m.status === "active" ? (
                      <Pause size={14} />
                    ) : (
                      <Play size={14} />
                    )}
                    {m.status === "active" ? "暂停" : "启用"}
                  </Button>
                  <button
                    className="text-button"
                    onClick={() => setDetail(m.id)}
                  >
                    历史与规则
                  </button>
                  <Button
                    className="button secondary monitor-delete"
                    disabled={busy}
                    onClick={() => setDeleting({ item: m })}
                  >
                    <Trash2 size={14} />
                    删除监控
                  </Button>
                </div>
              </article>
            ))}
          </div>
        ))}
      {tab === "events" && (
        <section className="panel">
          <div className="section-line">
            <h2>最近 100 条变化</h2>
            <label className="monitor-check">
              <input
                type="checkbox"
                checked={unreadOnly}
                onChange={(e) => setUnreadOnly(e.target.checked)}
              />
              只看未读
            </label>
          </div>
          {!feed ? (
            <Loading />
          ) : !events.length ? (
            <Empty title="暂无新的变化事件">
              首轮数据用于基线；未达到阈值或重复异常不会反复提醒。采集问题可在店铺的巡检记录中查看。
            </Empty>
          ) : (
            events.map((e) => (
              <article
                className={"monitor-event" + (!e.read_at ? " unread" : "")}
                key={e.id}
              >
                <div className="section-line">
                  <span>
                    {e.monitor_name} · {e.market}
                  </span>
                  <small>{datetime(e.created_at)}</small>
                </div>
                <h3>{e.data.title}</h3>
                <p>{e.data.body}</p>
                <details>
                  <summary>判断依据</summary>
                  <p>
                    规则 v{e.data.rule_version} · 源时区未知 · 数据API来源报告值
                  </p>
                  {e.data.facts?.start && (
                    <p>
                      本期：{e.data.facts.start}—{e.data.facts.end}；基期：
                      {e.data.facts.previous_start}—{e.data.facts.previous_end}
                    </p>
                  )}
                  <ul>
                    {e.data.evidence_ids.map((s, i) => (
                      <li key={s}>
                        <code>{s}</code>
                        <br />
                        <code>{e.data.paths[i]}</code>
                      </li>
                    ))}
                  </ul>
                </details>
                <div className="actions">
                  <Button secondary onClick={() => onJob(e.job_id)}>
                    查看巡检与解读
                  </Button>
                  <Button secondary onClick={() => onResearch(e)}>
                    深入研究
                  </Button>
                  {!e.read_at && (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        act(() =>
                          api(`/api/monitors/events/${e.id}/read`, {
                            method: "POST",
                            body: {},
                          }),
                        )
                      }
                    >
                      标记已读
                    </button>
                  )}
                </div>
              </article>
            ))
          )}
        </section>
      )}
      {tab === "reports" && (
        <Reports
          api={api}
          workspace={workspace}
          version={revision}
          scope="monitoring"
          focusReport={focusReport}
        />
      )}
      {form && (
        <MonitorForm
          api={api}
          catalog={catalog}
          item={form.id ? form : null}
          onClose={() => setForm(null)}
          onSaved={() => {
            setMessage(
              form.id ? "巡检规则已保存。" : "监控已启用，首次巡检即将开始。",
            );
            setForm(null);
            reload();
          }}
        />
      )}
      {detail && (
        <MonitorDetail
          api={api}
          id={detail}
          version={revision}
          onClose={() => setDetail(null)}
          onJob={(id) => {
            setDetail(null);
            onJob(id);
          }}
          onEdit={(item) => {
            setDetail(null);
            setForm(item);
          }}
          onDelete={(item) => {
            setDetail(null);
            setDeleting({ item, returnToDetail: true });
          }}
        />
      )}
      {deleting && (
        <DeleteMonitorDialog
          api={api}
          item={deleting.item}
          onClose={() => {
            if (deleting.returnToDetail) setDetail(deleting.item.id);
            setDeleting(null);
          }}
          onDeleted={() => {
            setMessage(
              `已删除“${deleting.item.name}”的监控，历史报告与费用记录已保留。`,
            );
            setDeleting(null);
            reload();
            setPoll((x) => x + 1);
          }}
        />
      )}
    </>
  );
}
