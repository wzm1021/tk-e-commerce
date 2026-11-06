import { useState } from "react";
import { useLoad } from "../../hooks/useLoad.mjs";
import {
  Button,
  Field,
  ErrorBox,
  Loading,
  Empty,
} from "../../components/ui.jsx";
import { Dialog } from "../../components/Dialog.jsx";
import { PageTitle } from "../../components/PageTitle.jsx";
import { MailAdmin } from "../admin/AccountAdmin.jsx";
import { datetime } from "../../lib/format.mjs";
import { mailStates } from "./FeedbackPage.jsx";
export function MailService({ api }) {
  const [tab, setTab] = useState("feedback");
  return (
    <>
      <PageTitle
        eyebrow="MAIL SERVICE"
        title="邮件服务"
        description="管理平台发信与客户反馈通知。"
      />
      <div className="customer-tabs">
        <button
          className={tab === "smtp" ? "active" : ""}
          onClick={() => setTab("smtp")}
        >
          发信设置
        </button>
        <button
          className={tab === "feedback" ? "active" : ""}
          onClick={() => setTab("feedback")}
        >
          反馈通知
        </button>
      </div>
      {tab === "smtp" ? <MailAdmin api={api} /> : <FeedbackMail api={api} />}
    </>
  );
}
function FeedbackMail({ api }) {
  const [version, setVersion] = useState(0),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(null),
    [confirmed, setConfirmed] = useState(false);
  const { data, error: loadError } = useLoad(
    api,
    "/api/admin/feedback-mail",
    version,
  );
  async function action(path, body, method = "POST") {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(path, { method, body });
      setVersion((v) => v + 1);
      setMessage(
        method === "PUT" ? "反馈通知配置已保存" : "任务已加入发送队列",
      );
      setRetry(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <ErrorBox error={error || loadError} />
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {!data ? (
        !loadError && <Loading />
      ) : (
        <>
          <section className="panel">
            {!data.smtp_ready && (
              <p className="notice">请先在“发信设置”中配置并启用 SMTP 服务。</p>
            )}
            <form
              key={data.config?.updated_at || "new"}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                action(
                  "/api/admin/feedback-mail",
                  {
                    enabled: f.get("enabled") === "on",
                    owner_email: f.get("owner"),
                    sales_emails: f
                      .get("sales")
                      .split(/[\s,，;；]+/)
                      .filter(Boolean),
                  },
                  "PUT",
                );
              }}
            >
              <label className="inactive-toggle">
                <input
                  name="enabled"
                  type="checkbox"
                  defaultChecked={data.config?.enabled || false}
                />
                自动发送客户反馈
              </label>
              <div className="form-grid">
                <Field label="负责人收件邮箱 *">
                  <input
                    name="owner"
                    type="email"
                    defaultValue={data.config?.owner_email || ""}
                    required
                    maxLength={254}
                    placeholder="owner@example.com"
                  />
                </Field>
                <Field
                  label="销售收件邮箱 *"
                  hint="多个邮箱用逗号或换行分隔，最多 10 个"
                >
                  <textarea
                    name="sales"
                    rows={2}
                    defaultValue={data.config?.sales_emails.join(", ") || ""}
                    required
                    placeholder="sales@example.com"
                  />
                </Field>
              </div>
              <dl className="feedback-mail-summary">
                <div>
                  <dt>发送内容</dt>
                  <dd>反馈正文 + 全部附件</dd>
                </div>
                <div>
                  <dt>发信通道</dt>
                  <dd>平台现有 SMTP</dd>
                </div>
                <div>
                  <dt>客户回复</dt>
                  <dd>回复至客户注册邮箱</dd>
                </div>
              </dl>
              <p className="muted">
                反馈先保存，再分别通知各收件人。启用后也会发送尚未安排通知的历史反馈；已进入队列的邮件继续使用当时的收件人。
              </p>
              <div className="dialog-actions">
                <Button disabled={busy}>保存配置</Button>
                <Button
                  type="button"
                  secondary
                  disabled={busy || !data.smtp_ready || !data.config}
                  onClick={() => action("/api/admin/feedback-mail/test", {})}
                >
                  发送含附件的测试邮件
                </Button>
              </div>
            </form>
          </section>
          <section className="panel">
            <h2>最近发送记录</h2>
            <p className="muted">
              “已提交邮件服务器”表示 SMTP
              已接受，不代表已进入收件箱。明确失败最多自动尝试 3
              次；结果不确定时需要先核对收件箱。
            </p>
            {!data.deliveries.length ? (
              <Empty title="还没有发送记录" />
            ) : (
              <div className="table-frame">
                <table>
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>通知</th>
                      <th>收件人</th>
                      <th>状态</th>
                      <th>次数</th>
                      <th>处理</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.deliveries.map((d) => (
                      <tr key={d.id}>
                        <td>{datetime(d.created_at)}</td>
                        <td>
                          {d.kind === "test"
                            ? "测试邮件"
                            : `反馈 ${d.feedback_id?.slice(0, 8)}`}
                        </td>
                        <td>{d.recipient}</td>
                        <td>{mailStates[d.state]}</td>
                        <td>{d.attempts}</td>
                        <td>
                          {["failed", "uncertain"].includes(d.state) && (
                            <button
                              className="text-button"
                              onClick={() => {
                                setRetry(d);
                                setConfirmed(false);
                              }}
                            >
                              重试
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Button secondary onClick={() => setVersion((v) => v + 1)}>
              刷新发送状态
            </Button>
          </section>
        </>
      )}
      {retry && (
        <Dialog title="重试反馈通知" onClose={() => setRetry(null)}>
          <p>收件人：{retry.recipient}</p>
          {retry.state === "uncertain" ? (
            <>
              <p>
                上次连接中断，邮件可能已经发出。请先核对该收件箱，避免重复发送。
              </p>
              <label className="inactive-toggle">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                已核对收件箱，确认未收到此邮件
              </label>
            </>
          ) : (
            <p>将重新发送这封邮件及其附件。</p>
          )}
          <ErrorBox error={error} />
          <Button
            disabled={busy || (retry.state === "uncertain" && !confirmed)}
            onClick={() =>
              action(`/api/admin/feedback-mail/${retry.id}/retry`, {
                confirmed_not_received: confirmed,
              })
            }
          >
            确认重试
          </Button>
        </Dialog>
      )}
    </>
  );
}
