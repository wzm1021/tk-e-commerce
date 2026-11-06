import { useState, useEffect } from "react";
import { PageTitle } from "../../components/PageTitle.jsx";
import { Button, Empty, Loading, ErrorBox } from "../../components/ui.jsx";
import { TestEditor } from "./TestEditor.jsx";
import { TestReport } from "./TestReport.jsx";
import { statuses, done, markets } from "./model.mjs";
import { errorLabel } from "../../lib/format.mjs";
import { Dialog } from "../../components/Dialog.jsx";
import "./ai-testing.css";
export function AiTestingPage({ api, workspace, selectedId, onSelect }) {
  const [list, setList] = useState(null),
    [error, setError] = useState(""),
    [report, setReport] = useState(null),
    [busy, setBusy] = useState(false),
    [deleting, setDeleting] = useState(null),
    [archived, setArchived] = useState(false),
    [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    const load = () =>
      api("/api/ai-tests" + (archived ? "?archived=1" : ""))
        .then((x) => live && setList(x))
        .catch((e) => live && setError(e.message));
    load();
    const timer = setInterval(load, 6000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [api, version, archived]);
  async function action(path, body, after) {
    setBusy(true);
    setError("");
    try {
      const result = await api(path, { method: "POST", body });
      after?.(result);
      setVersion((x) => x + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="AI PRODUCT TESTING"
        title="AI 测品"
        description="用商品页面比较购买意向，发现顾虑，准备真实市场验证。"
      >
        {!selectedId && (
          <Button
            disabled={busy}
            onClick={() => action("/api/ai-tests", {}, (d) => onSelect(d.id))}
          >
            新建测品
          </Button>
        )}
      </PageTitle>
      <ErrorBox error={error} />
      {selectedId ? (
        <TestEditor
          key={selectedId}
          id={selectedId}
          api={api}
          workspace={workspace}
          onBack={() => {
            onSelect(null);
            setVersion((v) => v + 1);
          }}
          onSubmitted={() => {
            onSelect(null);
            setVersion((v) => v + 1);
          }}
        />
      ) : (
        <div className="ai-testing">
          {!list ? (
            <Loading />
          ) : (
            <>
              <section className="ai-card">
                <div className="ai-card-heading">
                  <h2>{archived ? "已删除草稿" : "测品草稿"}</h2>
                  <Button
                    secondary
                    disabled={busy}
                    onClick={() => {
                      setList(null);
                      setArchived((v) => !v);
                    }}
                  >
                    {archived ? "返回草稿" : "已删除草稿"}
                  </Button>
                </div>
                {!list.drafts.length ? (
                  <Empty
                    title={archived ? "暂无已删除草稿" : "准备第一组页面方案"}
                  >
                    {archived
                      ? "删除的草稿可在这里恢复。"
                      : "可以从候选商品导入，也可以新建测品并手动填写。"}
                  </Empty>
                ) : (
                  list.drafts.map((d) => (
                    <div className="ai-list-row" key={d.id}>
                      <div>
                        <strong>{d.data.name}</strong>
                        <small>
                          {markets[d.data.market] || d.data.market} ·{" "}
                          {d.data.arms.length} 个方案 · 更新于{" "}
                          {new Date(d.updated_at).toLocaleString()}
                        </small>
                      </div>
                      {archived ? (
                        <Button
                          secondary
                          disabled={busy}
                          onClick={() =>
                            action(`/api/ai-tests/${d.id}/restore`, {})
                          }
                        >
                          恢复草稿
                        </Button>
                      ) : (
                        <>
                          <Button
                            secondary
                            disabled={busy}
                            onClick={() => onSelect(d.id)}
                          >
                            编辑与确认
                          </Button>
                          <Button
                            secondary
                            disabled={busy}
                            onClick={() => {
                              setError("");
                              setDeleting(d);
                            }}
                          >
                            删除
                          </Button>
                        </>
                      )}
                    </div>
                  ))
                )}
              </section>
              <section className="ai-card">
                <h2>测试记录</h2>
                {!list.runs.length ? (
                  <p className="muted">提交确认后，进度和报告会出现在这里。</p>
                ) : (
                  list.runs.map((r) => (
                    <div className="ai-list-row" key={r.id}>
                      <div>
                        <strong>{r.configuration?.name}</strong>
                        <small>
                          {statuses[r.status] || "处理中"}
                          {r.progress && !done(r.status)
                            ? " · " +
                              (r.progress.finished ??
                                r.progress.completed ??
                                r.progress.done ??
                                0) +
                              " / " +
                              (r.progress.total ?? "—")
                            : ""}
                          {r.cancel_requested && !done(r.status)
                            ? " · 正在取消"
                            : ""}
                        </small>
                        {r.error_code && (
                          <small>{errorLabel(r.error_code)}</small>
                        )}
                        {r.quota_state && r.quota_state !== "legacy" && (
                          <small>
                            {
                              {
                                reserved: "已预留 1 次测品",
                                charged: "已扣除 1 次测品",
                                released: "预留次数已退回",
                              }[r.quota_state]
                            }
                          </small>
                        )}
                      </div>
                      {r.result ? (
                        <Button onClick={() => setReport(r)}>查看报告</Button>
                      ) : !done(r.status) ? (
                        <Button
                          secondary
                          disabled={busy || r.cancel_requested}
                          onClick={() =>
                            action("/api/ai-tests/runs/" + r.id + "/cancel", {})
                          }
                        >
                          取消测试
                        </Button>
                      ) : (
                        <Button
                          secondary
                          disabled={busy}
                          onClick={() =>
                            action(
                              "/api/ai-tests/runs/" + r.id + "/retest",
                              {},
                              (d) => onSelect(d.id),
                            )
                          }
                        >
                          复制为草稿
                        </Button>
                      )}
                    </div>
                  ))
                )}
              </section>
            </>
          )}
        </div>
      )}
      {deleting && (
        <Dialog title="删除测品草稿" onClose={() => !busy && setDeleting(null)}>
          <ErrorBox error={error} />
          <p>确定删除“{deleting.data.name}”？删除后可在“已删除草稿”中恢复。</p>
          <p className="muted">
            已完成的测试报告和余额流水会保留。有测试进行中时，需先等待结束或取消。
          </p>
          <div className="dialog-actions">
            <Button secondary disabled={busy} onClick={() => setDeleting(null)}>
              保留草稿
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                action(
                  `/api/ai-tests/${deleting.id}/archive`,
                  { version: deleting.version },
                  () => setDeleting(null),
                )
              }
            >
              {busy ? "正在删除…" : "确认删除"}
            </Button>
          </div>
        </Dialog>
      )}
      {report && (
        <TestReport
          run={report}
          api={api}
          workspace={workspace}
          onClose={() => setReport(null)}
          onRetest={() =>
            action("/api/ai-tests/runs/" + report.id + "/retest", {}, (d) => {
              setReport(null);
              onSelect(d.id);
            })
          }
        />
      )}
    </>
  );
}
