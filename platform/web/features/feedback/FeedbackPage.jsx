import { useRef, useState } from "react";
import { Upload, FileText, X, MessageSquare } from "lucide-react";
import { useLoad } from "../../hooks/useLoad.mjs";
import { PageTitle } from "../../components/PageTitle.jsx";
import {
  Button,
  Field,
  ErrorBox,
  Loading,
  Empty,
} from "../../components/ui.jsx";
import { Dialog } from "../../components/Dialog.jsx";
import { Select } from "../../components/Select.jsx";
import { datetime } from "../../lib/format.mjs";
export const categories = {
  problem: "问题反馈",
  data: "数据异常",
  suggestion: "功能建议",
  other: "其他",
};
export const statuses = {
  new: "待处理",
  processing: "处理中",
  resolved: "已解决",
  closed: "已关闭",
};
export const mailStates = {
  pending_configuration: "等待邮件配置",
  pending: "等待发送",
  sending: "发送中",
  accepted: "已提交邮件服务器",
  failed: "发送失败",
  uncertain: "发送结果待确认",
};
export const pageNames = {
  scouting: "选品中心",
  opportunities: "机会池",
  "ai-testing": "AI 测品",
  assistant: "商品助手",
  research: "专项研究",
  monitoring: "竞店监控",
  supply: "货源与测样",
  economics: "利润测算",
  experiments: "实验与行动",
  wallet: "余额与账单",
  team: "团队与订阅",
  settings: "设置",
  feedback: "反馈与建议",
};
export function Pager({ page, hasMore, onPage }) {
  return (
    <div className="customer-pager">
      <Button secondary disabled={page <= 1} onClick={() => onPage(page - 1)}>
        上一页
      </Button>
      <span>第 {page} 页</span>
      <Button secondary disabled={!hasMore} onClick={() => onPage(page + 1)}>
        下一页
      </Button>
    </div>
  );
}
export function FeedbackPage({ api, context }) {
  const [tab, setTab] = useState("new"),
    [revision, setRevision] = useState(0);
  return (
    <>
      <PageTitle
        eyebrow="FEEDBACK"
        title="反馈与建议"
        description="问题、建议，都可以告诉我们。"
      />
      <div className="customer-tabs">
        <button
          className={tab === "new" ? "active" : ""}
          onClick={() => setTab("new")}
        >
          提交反馈
        </button>
        <button
          className={tab === "history" ? "active" : ""}
          onClick={() => setTab("history")}
        >
          我的反馈
        </button>
      </div>
      {tab === "new" ? (
        <FeedbackForm
          api={api}
          initialContext={context}
          onDone={() => {
            setRevision((v) => v + 1);
            setTab("history");
          }}
        />
      ) : (
        <FeedbackHistory api={api} revision={revision} />
      )}
    </>
  );
}
function FeedbackForm({ api, initialContext, onDone }) {
  const [category, setCategory] = useState("problem"),
    [title, setTitle] = useState(""),
    [description, setDescription] = useState(""),
    [context, setContext] = useState(initialContext || null),
    [files, setFiles] = useState([]),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useState("");
  const [locked, setLocked] = useState(false);
  const submission = useRef(null),
    input = useRef(null),
    uploadLock = useRef(false);
  const { data } = useLoad(api, "/api/account/profile", 0);
  async function upload(list) {
    if (uploadLock.current || busy || locked) return;
    uploadLock.current = true;
    setUploading(true);
    setError("");
    try {
      const next = [...list];
      if (next.length + files.length > 5) throw new Error("最多上传 5 个附件");
      if (
        next.some((f) => f.size > 5 * 1024 * 1024) ||
        next.reduce(
          (n, f) => n + f.size,
          files.reduce((n, f) => n + f.size_bytes, 0),
        ) >
          10 * 1024 * 1024
      )
        throw new Error("单个附件不超过 5 MB，总计不超过 10 MB");
      for (const file of next) {
        const data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const saved = await api("/api/feedback/files", {
          method: "POST",
          body: { name: file.name, data },
        });
        setFiles((old) => [...old, saved]);
      }
    } catch (e) {
      setError(e.message || "附件读取失败，请重新选择");
    } finally {
      setUploading(false);
      uploadLock.current = false;
      if (input.current) input.current.value = "";
    }
  }
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    if (!submission.current)
      submission.current = {
        id: crypto.randomUUID(),
        category,
        title,
        description,
        attachments: files.map((f) => f.id),
        context,
      };
    setLocked(true);
    try {
      await api("/api/feedback", { method: "POST", body: submission.current });
      onDone();
    } catch (e) {
      setError(e.message);
      if (e.status && e.status < 500) {
        submission.current = null;
        setLocked(false);
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel feedback-compose">
      <form onSubmit={submit}>
        <fieldset disabled={busy || locked} className="customer-fieldset">
          <div className="feedback-row">
            <span>
              反馈类型 <b>*</b>
            </span>
            <div className="feedback-types">
              {Object.entries(categories).map(([key, label]) => (
                <button
                  type="button"
                  key={key}
                  aria-pressed={category === key}
                  className={category === key ? "active" : ""}
                  onClick={() => setCategory(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <Field label="标题 *">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={160}
              required
              placeholder="用一句话描述你遇到的问题"
            />
          </Field>
          <Field label="问题描述 *">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={10000}
              rows={6}
              required
              placeholder="请描述操作过程、遇到的问题以及期望的结果…"
            />
          </Field>
          {context && (
            <div className="feedback-context">
              <span>
                关联页面：
                {context.title ||
                  pageNames[context.id] ||
                  { job: "研究任务", report: "选品报告", ai_test: "AI 测品" }[
                    context.kind
                  ]}
              </span>
              <button
                type="button"
                className="text-button"
                onClick={() => setContext(null)}
              >
                移除
              </button>
            </div>
          )}
        </fieldset>
        <div
          className="feedback-upload"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            upload(e.dataTransfer.files);
          }}
        >
          <Upload size={24} />
          <button
            className="text-button"
            type="button"
            disabled={uploading || busy || locked}
            onClick={() => input.current?.click()}
          >
            {uploading ? "正在上传…" : "拖拽文件到这里，或点击上传"}
          </button>
          <small>最多 5 个 · 单个 5 MB · 总计 10 MB</small>
          <small>PNG / JPEG / WebP / PDF / DOCX / XLSX / TXT / CSV</small>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            accept=".png,.jpg,.jpeg,.webp,.pdf,.docx,.xlsx,.txt,.csv"
            onChange={(e) => upload(e.target.files)}
          />
        </div>
        <div className="feedback-files">
          {files.map((f) => (
            <div key={f.id} className="feedback-file">
              {f.mime.startsWith("image/") ? (
                <img
                  alt="附件预览"
                  src={`/api/feedback/files/${f.id}?preview=1`}
                />
              ) : (
                <FileText size={28} />
              )}
              <div>
                <strong>{f.name}</strong>
                <small>{Math.max(1, Math.ceil(f.size_bytes / 1024))} KB</small>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label={`移除 ${f.name}`}
                disabled={busy || locked}
                onClick={() =>
                  setFiles((old) => old.filter((x) => x.id !== f.id))
                }
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
        <ErrorBox error={error} />
        {locked && !busy && (
          <p className="notice">
            提交结果尚未确认。可重试相同内容，平台不会重复保存；也可在“我的反馈”中查看。
          </p>
        )}
        <footer className="feedback-footer">
          <small>
            回复将联系你的注册邮箱 {data?.email || "请先在设置中绑定邮箱"}
          </small>
          <Button disabled={busy || uploading || !data?.email}>
            {busy ? "提交中…" : locked ? "重试提交" : "提交反馈"}
          </Button>
        </footer>
      </form>
    </section>
  );
}
export function FeedbackHistory({ api, revision = 0, admin = false, userId }) {
  const [page, setPage] = useState(1),
    [status, setStatus] = useState(""),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState(""),
    [selected, setSelected] = useState(null),
    [version, setVersion] = useState(0);
  const base = admin ? "/api/admin/feedback" : "/api/feedback";
  const path = `${base}?page=${page}${admin ? `&status=${status}&search=${encodeURIComponent(filter)}${userId ? `&user_id=${userId}` : ""}` : ""}`;
  const { data, error } = useLoad(api, path, `${revision}:${version}`);
  return (
    <>
      <section className="panel">
        {admin && (
          <form
            className="customer-filters"
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              setFilter(search);
            }}
          >
            <input
              aria-label="搜索反馈"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索邮箱或反馈标题"
            />
            <Select
              variant="box"
              ariaLabel="反馈状态"
              value={status}
              onChange={(v) => {
                setStatus(v);
                setPage(1);
              }}
              options={[
                { value: "", title: "全部状态" },
                ...Object.entries(statuses).map(([value, title]) => ({
                  value,
                  title,
                })),
              ]}
            />
            <Button secondary>查询</Button>
          </form>
        )}
        <ErrorBox error={error} />
        {!data ? (
          !error && <Loading />
        ) : !data.items.length ? (
          <Empty title="还没有反馈记录">提交后可以在这里查看处理进展。</Empty>
        ) : (
          <>
            <div className="table-frame">
              <table>
                <thead>
                  <tr>
                    <th>反馈标题</th>
                    {admin && <th>客户邮箱</th>}
                    <th>类型</th>
                    <th>状态</th>
                    <th>提交时间</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((f) => (
                    <tr key={f.id}>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => setSelected(f.id)}
                        >
                          {f.title}
                        </button>
                      </td>
                      {admin && <td>{f.current_email || f.email_snapshot}</td>}
                      <td>{categories[f.category]}</td>
                      <td>
                        <span className={`badge ${f.status}`}>
                          {statuses[f.status]}
                        </span>
                      </td>
                      <td>{datetime(f.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} hasMore={data.has_more} onPage={setPage} />
          </>
        )}
      </section>
      {selected && (
        <FeedbackDetail
          api={api}
          id={selected}
          admin={admin}
          onClose={() => setSelected(null)}
          onChanged={() => setVersion((v) => v + 1)}
        />
      )}
    </>
  );
}
function FeedbackDetail({ api, id, admin, onClose, onChanged }) {
  const base = admin ? "/api/admin/feedback" : "/api/feedback";
  const { data, error } = useLoad(api, `${base}/${id}`, 0);
  return (
    <Dialog title="反馈详情" onClose={onClose} wide>
      <ErrorBox error={error} />
      {!data ? (
        !error && <Loading />
      ) : (
        <>
          <span className="eyebrow">
            {categories[data.category]} · {statuses[data.status]}
          </span>
          <h2>{data.title}</h2>
          <p className="muted">
            {data.email_snapshot} · {datetime(data.created_at)}
          </p>
          <p className="feedback-body">{data.description}</p>
          {data.context && (
            <p>
              关联：
              {data.context.title ||
                pageNames[data.context.id] ||
                data.context.kind}
            </p>
          )}
          <div className="feedback-files">
            {data.attachments.map((f) => (
              <a
                className="feedback-file"
                key={f.id}
                href={`${base}/files/${f.id}`}
              >
                <FileText size={22} />
                <span>{f.name}</span>
              </a>
            ))}
          </div>
          {admin ? (
            <FeedbackHandling
              api={api}
              data={data}
              onDone={() => {
                onChanged();
                onClose();
              }}
            />
          ) : (
            <>
              {data.public_reply && (
                <div className="notice">
                  <strong>处理说明</strong>
                  <p className="feedback-body">{data.public_reply}</p>
                </div>
              )}
            </>
          )}
          {admin && (
            <p className="muted">
              通知状态：{mailStates[data.mail_state]}
              。发送异常可到邮件服务中重试。
            </p>
          )}
        </>
      )}
    </Dialog>
  );
}
function FeedbackHandling({ api, data, onDone }) {
  const [status, setStatus] = useState(data.status),
    [reply, setReply] = useState(data.public_reply),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await api(`/api/admin/feedback/${data.id}`, {
            method: "PUT",
            body: { status, public_reply: reply },
          });
          onDone();
        } catch (e) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>处理反馈</h3>
      <Field label="处理状态">
        <Select
          variant="box"
          value={status}
          onChange={setStatus}
          options={Object.entries(statuses).map(([value, title]) => ({
            value,
            title,
          }))}
        />
      </Field>
      <Field label="客户可见的处理说明">
        <textarea
          rows={3}
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          maxLength={3000}
        />
      </Field>
      <ErrorBox error={error} />
      <Button disabled={busy}>保存处理结果</Button>
    </form>
  );
}
