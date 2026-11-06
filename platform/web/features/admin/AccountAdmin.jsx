import { useState } from "react";
import { useLoad } from "../../hooks/useLoad.mjs";
import { Field, Button, ErrorBox, Loading } from "../../components/ui.jsx";
import { Select } from "../../components/Select.jsx";
import { money, datetime } from "../../lib/format.mjs";
import { mailSenderName } from "../../lib/brand.mjs";
export function MailAdmin({ api }) {
  const [version, setVersion] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  const { data, error: loadError } = useLoad(api, "/api/admin/mail", version);
  if (!data)
    return (
      <>
        <ErrorBox error={loadError} />
        <Loading />
      </>
    );
  return (
    <section className="panel">
      <h2>注册与找回密码邮件</h2>
      <p>
        用于邮箱注册、找回密码和绑定邮箱。授权码加密保存；启用前自动验证 SMTP
        连接。
      </p>
      <ErrorBox error={error} />
      {saved ? <p className="notice">邮件配置已保存</p> : null}
      <form
        key={data.updated_at || "new"}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          setSaved(false);
          const f = new FormData(e.currentTarget);
          try {
            await api("/api/admin/mail", {
              method: "PUT",
              body: {
                config: {
                  host: f.get("host"),
                  port: Number(f.get("port")),
                  user: f.get("user"),
                  from: f.get("from"),
                  from_name: f.get("from_name"),
                },
                ...(f.get("password") ? { password: f.get("password") } : {}),
                enabled: f.get("enabled") === "on",
              },
            });
            setSaved(true);
            setVersion((v) => v + 1);
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <Field label="SMTP 地址">
            <input
              name="host"
              defaultValue={data.config?.host || ""}
              placeholder="smtp.163.com"
              required
            />
          </Field>
          <Field label="端口">
            <Select
              variant="box"
              name="port"
              defaultValue={String(data.config?.port || 465)}
              options={[
                { value: "465", title: "465 · TLS" },
                { value: "587", title: "587 · STARTTLS" },
              ]}
            />
          </Field>
          <Field label="SMTP 用户名">
            <input
              name="user"
              defaultValue={data.config?.user || ""}
              required
            />
          </Field>
          <Field label="发件邮箱">
            <input
              name="from"
              type="email"
              defaultValue={data.config?.from || ""}
              required
            />
          </Field>
          <Field label="发件名称">
            <input
              name="from_name"
              defaultValue={mailSenderName(data.config?.from_name)}
              required
            />
          </Field>
          <Field
            label={data.config ? "新授权码（留空保留原值）" : "邮箱授权码"}
          >
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              required={!data.config}
            />
          </Field>
        </div>
        <label className="inactive-toggle">
          <input type="checkbox" name="enabled" defaultChecked={data.enabled} />
          启用邮箱注册与验证码发送
        </label>
        <Button disabled={busy}>
          {busy ? "正在验证与保存…" : "保存邮件配置"}
        </Button>
      </form>
    </section>
  );
}
export function SubscriptionAdmin({ api, workspace }) {
  const [version, setVersion] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const { data, error: loadError } = useLoad(
    api,
    workspace ? `/api/admin/workspaces/${workspace}/subscription` : null,
    version,
  );
  return (
    <>
      <ErrorBox error={error || loadError} />
      {!data ? (
        <Loading />
      ) : (
        <>
          <section className="panel">
            <h2>{data.workspace.name} · 团队订阅</h2>
            <p>
              {data.workspace.ends_at
                ? `当前到期时间：${datetime(data.workspace.ends_at)}`
                : "尚未开通团队订阅"}
            </p>
            {data.workspace.kind === "personal" ? (
              <p>
                这是个人空间。团队订阅请在团队空间开通；个人余额可在充值与账本中管理。
              </p>
            ) : (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  setError("");
                  const form = e.currentTarget,
                    f = new FormData(form);
                  try {
                    await api(
                      `/api/admin/workspaces/${workspace}/subscription`,
                      {
                        method: "POST",
                        body: {
                          reference: f.get("reference"),
                          kind: f.get("kind"),
                          months: Number(f.get("months")),
                          seat_limit: Number(f.get("seats")),
                          model_credit: f.get("model_credit"),
                          data_credit: Number(f.get("data_credit")),
                          fee_cny: f.get("fee"),
                        },
                      },
                    );
                    form.reset();
                    setVersion((v) => v + 1);
                  } catch (e) {
                    setError(e.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <div className="form-grid">
                  <Field label="收款确认单号或赠送编号">
                    <input
                      name="reference"
                      minLength={8}
                      maxLength={120}
                      required
                    />
                  </Field>
                  <Field label="开通类型">
                    <Select
                      variant="box"
                      name="kind"
                      options={[
                        { value: "paid", title: "已确认实付" },
                        { value: "trial", title: "内测赠送" },
                      ]}
                    />
                  </Field>
                  <Field label="已收金额（元，赠送填 0）">
                    <input
                      name="fee"
                      type="number"
                      min="0"
                      step="0.01"
                      required
                    />
                  </Field>
                  <Field label="增加订阅月数">
                    <input
                      name="months"
                      type="number"
                      min="1"
                      max="12"
                      defaultValue="1"
                      required
                    />
                  </Field>
                  <Field label="团队总席位数">
                    <input
                      name="seats"
                      type="number"
                      min="1"
                      max="200"
                      defaultValue={data.workspace.seat_limit || 5}
                      required
                    />
                  </Field>
                  <Field label="本次发放模型余额（元）">
                    <input
                      name="model_credit"
                      type="number"
                      min="0"
                      max="1000000"
                      step="0.01"
                      defaultValue="0"
                      required
                    />
                  </Field>
                  <Field label="本次发放数据积分">
                    <input
                      name="data_credit"
                      type="number"
                      min="0"
                      max="1000000"
                      step="0.1"
                      defaultValue="0"
                      required
                    />
                  </Field>
                </div>
                <p className="muted">
                  开通会立即发放共享额度；未到期时从原到期日续延。余额不自动清零，重复提交同一确认单不会重复发放。此操作不发起在线扣款。
                </p>
                <Button disabled={busy}>确认开通或续订</Button>
              </form>
            )}
          </section>
          <section className="panel">
            <h2>订阅记录</h2>
            <div className="table-frame">
              <table>
                <thead>
                  <tr>
                    <th>确认单号</th>
                    <th>类型</th>
                    <th>席位</th>
                    <th>到期时间</th>
                    <th>模型余额</th>
                    <th>数据积分</th>
                  </tr>
                </thead>
                <tbody>
                  {data.periods.map((p) => (
                    <tr key={p.id}>
                      <td>{p.reference}</td>
                      <td>{p.kind === "trial" ? "赠送" : "实付"}</td>
                      <td>{p.seat_limit}</td>
                      <td>{datetime(p.ends_at)}</td>
                      <td>¥ {money(p.model_credit)}</td>
                      <td>{Number(p.data_credit) / 10}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
