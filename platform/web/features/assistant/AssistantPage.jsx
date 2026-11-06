import { ModelPicker, effectiveModel } from "../accounts/ModelPicker.jsx";
import { randomId } from "../../lib/client-id.mjs";
import { displayText } from "../../lib/presentation.mjs";
import { useEffect, useRef, useState } from "react";
import {
  Plus,
  Send,
  MessageSquare,
  X,
  Paperclip,
  RefreshCw,
} from "lucide-react";
import { useLoad } from "../../hooks/useLoad.mjs";
import { PageTitle } from "../../components/PageTitle.jsx";
import {
  Button,
  Field,
  ErrorBox,
  Loading,
  Empty,
  Badge,
} from "../../components/ui.jsx";
import { Dialog } from "../../components/Dialog.jsx";
import { Select } from "../../components/Select.jsx";
import { money, datetime, errorLabel } from "../../lib/format.mjs";

export function AssistantAttach({ api, refs, onClose, onDone }) {
  const { data, error: loadError } = useLoad(
    api,
    "/api/assistant/conversations",
  );
  const [target, setTarget] = useState("new"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const createId = useRef(null);
  createId.current ||= randomId();
  async function attach(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      let row;
      if (target === "new")
        row = await api("/api/assistant/conversations", {
          method: "POST",
          body: {
            id: createId.current,
            title: `商品讨论 · ${refs.length} 项资料`,
            contexts: refs,
          },
        });
      else {
        row = await api(`/api/assistant/conversations/${target}`);
        row = await api(`/api/assistant/conversations/${target}/contexts`, {
          method: "PUT",
          body: { version: row.version, additions: refs },
        });
      }
      onDone(row.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="添加到商品助手" onClose={onClose}>
      <form onSubmit={attach}>
        <p>
          已选择 {refs.length}{" "}
          件商品。添加时保存资料快照，之后的追问可按需补查新数据。
        </p>
        <Field label="添加至对话">
          <Select
            variant="box"
            value={target}
            onChange={setTarget}
            options={[
              { value: "new", title: "新建对话" },
              ...(data?.items || []).map((x) => ({
                value: x.id,
                title: x.title,
              })),
            ]}
          />
        </Field>
        <ErrorBox error={error || loadError} />
        <Button disabled={busy || !data}>
          {busy ? "正在添加…" : "添加并打开助手"}
        </Button>
      </form>
    </Dialog>
  );
}

function ContextPicker({ api, onClose, onAdd }) {
  const [type, setType] = useState("opportunity"),
    [reportId, setReportId] = useState(""),
    [checked, setChecked] = useState([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const { data: reports } = useLoad(api, "/api/records?kind=report");
  const { data: opportunities, error: opportunityError } = useLoad(
    api,
    "/api/records?kind=opportunity",
  );
  const selectedReport =
    reportId || reports?.items.find((r) => !r.data.superseded_by)?.id;
  const { data: candidates, error: candidateError } = useLoad(
    api,
    type === "candidate" && selectedReport
      ? `/api/reports/${selectedReport}/candidates`
      : null,
  );
  const items =
    type === "opportunity"
      ? opportunities?.items.map((r) => ({
          id: r.id,
          title: r.data.title,
          product_id: r.data.product_id,
        }))
      : candidates?.items.map((x) => ({
          id: x.product_id,
          title: x.title,
          product_id: x.product_id,
        }));
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const f = new FormData(e.currentTarget);
      const refs =
        type === "manual"
          ? [
              {
                kind: "manual",
                title: f.get("title"),
                notes: f.get("notes"),
                ...(f.get("product_id")
                  ? { product_id: f.get("product_id") }
                  : {}),
                ...(f.get("tk_url") ? { tk_url: f.get("tk_url") } : {}),
              },
            ]
          : checked.map((key) =>
              type === "candidate"
                ? { kind: type, report_id: selectedReport, product_id: key }
                : { kind: type, record_id: key },
            );
      await onAdd(refs);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="添加商品资料" onClose={onClose} wide>
      <form onSubmit={submit}>
        <Field label="资料来源">
          <Select
            variant="box"
            value={type}
            onChange={(v) => {
              setType(v);
              setChecked([]);
            }}
            options={[
              { value: "opportunity", title: "机会池" },
              { value: "candidate", title: "选品报告" },
              { value: "manual", title: "手工补充" },
            ]}
          />
        </Field>
        {type === "manual" ? (
          <div className="form-grid">
            <Field label="商品名称" wide>
              <input name="title" required maxLength={300} />
            </Field>
            <Field label="TikTok 商品 ID（选填）">
              <input name="product_id" pattern="[0-9]{10,30}" />
            </Field>
            <Field label="TikTok 商品链接（选填）">
              <input name="tk_url" type="url" maxLength={2000} />
            </Field>
            <Field label="商品信息或需要补充的事实" wide>
              <textarea
                name="notes"
                required
                maxLength={6000}
                rows={5}
                placeholder="例如采购报价、实测包装、商品特点；请说明单位、来源和日期。"
              />
            </Field>
          </div>
        ) : (
          <>
            {type === "candidate" && (
              <Field label="来源报告">
                <Select
                  variant="box"
                  value={selectedReport || ""}
                  onChange={(v) => {
                    setReportId(v);
                    setChecked([]);
                  }}
                  options={(reports?.items || []).map((x) => ({
                    value: x.id,
                    title: x.data.title,
                  }))}
                />
              </Field>
            )}
            <div className="chat-picker-list">
              {items?.length ? (
                items.map((x) => (
                  <label className="chat-pick" key={x.id}>
                    <input
                      type="checkbox"
                      aria-label={`添加 ${x.title}`}
                      checked={checked.includes(x.id)}
                      onChange={(e) =>
                        setChecked((old) =>
                          e.target.checked
                            ? [...old, x.id]
                            : old.filter((v) => v !== x.id),
                        )
                      }
                    />
                    <span>
                      {x.title}
                      <small>{x.product_id}</small>
                    </span>
                  </label>
                ))
              ) : (
                <p className="muted">此来源暂无商品，可切换来源或手工补充。</p>
              )}
            </div>
          </>
        )}
        <ErrorBox
          error={
            error || (type === "candidate" ? candidateError : opportunityError)
          }
        />
        <Button
          disabled={
            busy ||
            (type !== "manual" && (!checked.length || checked.length > 10))
          }
        >
          {busy ? "正在添加…" : "添加资料"}
        </Button>
      </form>
    </Dialog>
  );
}

const busyStatuses = [
  "queued",
  "running",
  "awaiting_connection",
  "waiting_input",
];
const toolNames = {
  product_detail_info: "查询商品详情",
  product_sales_trend: "查询销售趋势",
};
function ChatTurn({ turn, api, workspace, reload }) {
  const [error, setError] = useState("");
  async function action(name) {
    try {
      await api(`/api/jobs/${turn.id}/${name}`, { method: "POST", body: {} });
      reload();
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <article className="chat-turn">
      <div className="chat-message user">
        <small>你 · {datetime(turn.created_at)}</small>
        <p>{turn.request.question}</p>
        <div className="chat-chips">
          {turn.request.contexts.map((x) => (
            <span key={x.id} title={x.title}>
              {x.title}
            </span>
          ))}
        </div>
      </div>
      <div className="chat-message assistant">
        <div className="section-line">
          <strong>
            商品助手{turn.model_name ? ` · ${turn.model_name}` : ""}
          </strong>
          <Badge value={turn.status} />
        </div>
        {turn.result?.answer ? (
          <>
            {(turn.result.compaction?.history_memory ||
              turn.result.compaction?.context_memory) && (
              <details className="chat-sources">
                <summary>已自动压缩上下文 · 原始资料和完整记录已保留</summary>
                <p>
                  已压缩{" "}
                  {turn.result.compaction.history_memory?.covered_turns || 0}{" "}
                  轮历史、
                  {turn.result.compaction.context_memory?.context_count ||
                    0}{" "}
                  项商品资料；摘要用于理解对话，事实引用仍核对原文。
                </p>
                {turn.result.compaction.history_memory && (
                  <p>{turn.result.compaction.history_memory.summary}</p>
                )}
                {turn.result.compaction.context_memory && (
                  <p>{turn.result.compaction.context_memory.summary}</p>
                )}
              </details>
            )}
            <div className="chat-answer">
              {turn.result.answer.replace(/\[(\d{1,2})\]/g, (mark, n) =>
                Number(n) > 0 &&
                Number(n) <= (turn.result.citations?.length || 0)
                  ? ""
                  : mark,
              )}
            </div>
            {!!turn.result.citations?.length && (
              <details className="chat-sources">
                <summary>
                  查看 {turn.result.citations.length} 条回答依据
                </summary>
                {turn.result.citations.map((cite, index) => (
                  <div key={index} className="chat-source">
                    <strong>{cite.label}</strong>
                    <small>
                      {cite.source} · {datetime(cite.captured_at)}
                    </small>
                    <pre>
                      {displayText(
                        typeof cite.value === "string"
                          ? cite.value
                          : JSON.stringify(cite.value, null, 2),
                      )}
                    </pre>
                    {cite.artifact_id && (
                      <a
                        href={`/api/artifacts/${cite.artifact_id}?workspace=${workspace}&download=1`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        查看原始数据
                      </a>
                    )}
                  </div>
                ))}
              </details>
            )}
            {!!turn.result.limitations?.length && (
              <div className="chat-limitations">
                {turn.result.limitations.map((x, i) => (
                  <p key={i}>{x}</p>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="muted">
            {{
              queued: "问题已排队，轮到后开始回答。",
              running: turn.calls.some(
                (x) =>
                  x.purpose === "context_compaction" && x.state === "started",
              )
                ? "正在自动压缩较长上下文，原始资料和完整记录会保留…"
                : "正在分析商品资料，并判断是否需要补查数据…",
              awaiting_connection: "问题已保存，等待平台完成模型或技能配置。",
              reconciling:
                "供应商用量待核对，本轮回答尚未发布。可以继续提出新问题。",
              cancelled: turn.calls.some((x) => x.bound_breached === "true")
                ? "供应商返回异常用量，平台已停止本轮并暂停模型连接，超额部分由平台承担。"
                : "本轮已停止。",
              failed: "本轮未完成，可以重新提问。",
            }[turn.status] || "等待处理。"}
          </p>
        )}
        {!!turn.calls.length && (
          <details className="chat-calls">
            <summary>
              执行记录 · {turn.calls.filter((x) => x.kind === "model").length}{" "}
              次模型调用 · {turn.calls.filter((x) => x.kind === "data").length}{" "}
              次数据请求
            </summary>
            {turn.calls.map((call) => (
              <p key={call.id}>
                {call.kind === "model"
                  ? call.purpose === "context_compaction"
                    ? "自动压缩上下文"
                    : call.purpose === "format_repair"
                      ? "校正回答格式"
                      : "模型分析"
                  : toolNames[call.tool] || "数据API 检索"}{" "}
                ·{" "}
                {call.state === "succeeded"
                  ? "已返回"
                  : call.state === "reconciling"
                    ? "待核对"
                    : "处理中"}
                {call.kind === "data" &&
                  call.state === "succeeded" &&
                  ` · ${call.cache_hit === "true" ? "快照命中" : "实时取数"} · ${call.charged} 积分`}
                {call.kind === "data" &&
                  call.captured_at &&
                  ` · 采集于 ${datetime(call.captured_at)}`}
              </p>
            ))}
          </details>
        )}
        <small className="chat-cost">
          已确认模型费用 ¥{money(turn.model_spent)} · 数据 {turn.data_spent}{" "}
          积分
          {busyStatuses.includes(turn.status) || turn.status === "reconciling"
            ? " · 在途调用结算后更新余额"
            : ""}
        </small>
        {turn.error_code && <ErrorBox error={errorLabel(turn.error_code)} />}
        <ErrorBox error={error} />
        <div className="chat-actions">
          {busyStatuses.includes(turn.status) && (
            <button className="text-button" onClick={() => action("cancel")}>
              停止本轮
            </button>
          )}
          {turn.status === "awaiting_connection" && (
            <button className="text-button" onClick={() => action("resume")}>
              重新检查连接
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

export function AssistantPage({
  api,
  catalog,
  workspace,
  selectedId,
  onSelect,
}) {
  const [version, setVersion] = useState(0),
    [picker, setPicker] = useState(false),
    [question, setQuestion] = useState(""),
    [mode, setMode] = useState("auto"),
    [modelId, setModelId] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const submission = useRef(null),
    end = useRef(null),
    createId = useRef(null);
  const { data: list, error: listError } = useLoad(
    api,
    "/api/assistant/conversations",
    version,
  );
  const { data: conversation, error: loadError } = useLoad(
    api,
    selectedId ? `/api/assistant/conversations/${selectedId}` : null,
    version,
  );
  const reload = () => setVersion((v) => v + 1);
  const active = conversation?.turns.some((t) =>
    busyStatuses.includes(t.status),
  );
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setVersion((v) => v + 1), 4000);
    return () => clearInterval(timer);
  }, [active, selectedId]);
  useEffect(() => {
    setQuestion("");
    setError("");
    submission.current = null;
  }, [selectedId]);
  useEffect(() => {
    const timeline = end.current?.parentElement;
    timeline?.scrollTo({ top: timeline.scrollHeight, behavior: "smooth" });
  }, [
    selectedId,
    conversation?.turns.length,
    conversation?.turns.at(-1)?.status,
  ]);
  async function create() {
    setBusy(true);
    setError("");
    try {
      createId.current ||= randomId();
      const row = await api("/api/assistant/conversations", {
        method: "POST",
        body: {
          id: createId.current,
          title: "商品对话 · " + new Date().toLocaleDateString("zh-CN"),
          contexts: [],
        },
      });
      createId.current = null;
      onSelect(row.id);
      reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function add(refs) {
    await api(`/api/assistant/conversations/${selectedId}/contexts`, {
      method: "PUT",
      body: { version: conversation.version, additions: refs },
    });
    reload();
  }
  async function remove(id) {
    try {
      await api(`/api/assistant/conversations/${selectedId}/contexts`, {
        method: "PUT",
        body: { version: conversation.version, remove_ids: [id] },
      });
      reload();
    } catch (e) {
      setError(e.message);
    }
  }
  async function send(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const body = {
      question: question.trim(),
      context_version: conversation.version,
      data_mode: mode,
      model_connection_id: effectiveModel(catalog, modelId) || undefined,
    };
    const fingerprint = JSON.stringify({ selectedId, ...body });
    if (submission.current?.fingerprint !== fingerprint)
      submission.current = { fingerprint, key: randomId() };
    try {
      await api(`/api/assistant/conversations/${selectedId}/messages`, {
        method: "POST",
        body: { ...body, idempotency_key: submission.current.key },
      });
      setQuestion("");
      submission.current = null;
      reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="PRODUCT ASSISTANT"
        title="商品助手"
        description="把商品放进对话，比较机会、追问依据，或按需补查最新数据。"
      >
        <Button secondary onClick={reload}>
          <RefreshCw size={15} />
          刷新
        </Button>
        <Button onClick={create} disabled={busy}>
          <Plus size={16} />
          新建对话
        </Button>
      </PageTitle>
      <ErrorBox error={error || listError || loadError} />
      <div className="assistant-layout">
        <aside className="chat-history">
          <h2>本空间对话</h2>
          {list?.items.length ? (
            list.items.map((x) => (
              <button
                key={x.id}
                className={selectedId === x.id ? "selected" : ""}
                onClick={() => onSelect(x.id)}
              >
                <MessageSquare size={16} />
                <span>
                  {x.title}
                  <small>
                    {x.context_count} 项商品资料 · {datetime(x.updated_at)}
                  </small>
                </span>
              </button>
            ))
          ) : (
            <p className="muted">从选品清单添加商品，或新建对话。</p>
          )}
        </aside>
        <section className="chat-main" aria-label="商品对话">
          {!selectedId ? (
            <Empty title="围绕商品，问得更深入">
              选择一件或多件商品，比较它们的证据和不足，也可以补充采购与实测信息。
              <br />
              <Button onClick={create} disabled={busy}>
                开始对话
              </Button>
            </Empty>
          ) : !conversation ? (
            <Loading />
          ) : (
            <>
              <div className="chat-context">
                <div className="section-line">
                  <strong>
                    当前资料 · {conversation.data.contexts.length}/10
                  </strong>
                  <button
                    className="text-button"
                    onClick={() => setPicker(true)}
                  >
                    <Paperclip size={15} />
                    添加商品资料
                  </button>
                </div>
                <div className="chat-context-cards">
                  {conversation.data.contexts.map((x) => (
                    <div key={x.id}>
                      <span title={x.title}>{x.title}</span>
                      <small>
                        {x.source_note} · {datetime(x.captured_at)}
                      </small>
                      <button
                        className="icon-button"
                        aria-label={`移除 ${x.title}`}
                        onClick={() => remove(x.id)}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                {!conversation.data.contexts.length && (
                  <p className="muted">
                    尚未添加商品资料。可以手工补充，或从报告和机会池选择。
                  </p>
                )}
              </div>
              <div className="chat-timeline" role="log" aria-label="对话记录">
                {conversation.turns.length ? (
                  conversation.turns.map((turn) => (
                    <ChatTurn
                      key={turn.id}
                      turn={turn}
                      api={api}
                      workspace={workspace}
                      reload={reload}
                    />
                  ))
                ) : (
                  <div className="chat-welcome">
                    <MessageSquare size={28} />
                    <h2>这些商品，下一步该怎么判断？</h2>
                    <p>
                      已有资料足够时直接回答；需要更新事实时，助手会按需选择数据接口。
                    </p>
                    {[
                      "比较这些商品的机会和主要风险。",
                      "哪些结论还缺证据，应该优先查什么？",
                      "基于已有信息，设计一个低成本测试方案。",
                    ].map((q) => (
                      <button key={q} onClick={() => setQuestion(q)}>
                        {q}
                      </button>
                    ))}
                  </div>
                )}
                <div ref={end} />
              </div>
              {!!conversation.turns.at(-1)?.result?.followups?.length &&
                !active && (
                  <div className="chat-followups">
                    {conversation.turns.at(-1).result.followups.map((q, i) => (
                      <button key={i} onClick={() => setQuestion(q)}>
                        {q}
                      </button>
                    ))}
                  </div>
                )}
              <form className="chat-composer" onSubmit={send}>
                <label className="sr-only" htmlFor="assistant-question">
                  向商品助手提问
                </label>
                <textarea
                  id="assistant-question"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  maxLength={3000}
                  rows={3}
                  required
                  placeholder="针对当前商品提问，例如：这两件商品哪个更适合先买样？"
                />
                <div className="chat-budget">
                  <label>
                    资料使用
                    <Select
                      variant="box"
                      size="sm"
                      ariaLabel="资料使用"
                      value={mode}
                      onChange={setMode}
                      options={[
                        { value: "auto", title: "按需补查数据" },
                        { value: "context_only", title: "仅用已有资料" },
                      ]}
                    />
                  </label>
                  <ModelPicker
                    catalog={catalog}
                    value={modelId}
                    onChange={setModelId}
                  />
                  <Button disabled={busy || active || !question.trim()}>
                    <Send size={16} />
                    {busy ? "正在提交…" : active ? "等待本轮回答" : "发送"}
                  </Button>
                </div>
                <small>
                  接近上限时自动压缩较早对话和较长资料，原文保留，摘要可查看。压缩与回答均计入实际用量，使用当前空间的共享额度，可在设置中查看。
                </small>
              </form>
            </>
          )}
        </section>
      </div>
      {picker && conversation && (
        <ContextPicker api={api} onClose={() => setPicker(false)} onAdd={add} />
      )}
    </>
  );
}
