import { ProfileEditor } from "./ProfileEditor.jsx";
import { useState } from "react";
import { useLoad } from "../../hooks/useLoad.mjs";
import { PageTitle } from "../../components/PageTitle.jsx";
import { Button, Field, ErrorBox, Loading } from "../../components/ui.jsx";
import { Select } from "../../components/Select.jsx";
import { money } from "../../lib/format.mjs";

export function AccountSettings({ api, version, onChanged }) {
  const [revision, setRevision] = useState(0),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [email, setEmail] = useState(""),
    [challenge, setChallenge] = useState(null);
  const { data, error: loadError } = useLoad(
    api,
    "/api/settings",
    `${version}:${revision}`,
  );
  async function run(fn) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
      setRevision((x) => x + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="ACCOUNT SETTINGS"
        title="设置"
        description="管理邮箱和默认模型，查看自己与当前团队的数据请求及 token 用量。"
      />
      <ErrorBox error={error || loadError} />
      {message ? <p className="notice">{message}</p> : null}
      {!data ? (
        <Loading />
      ) : (
        <>
          <ProfileEditor api={api} />
          <section className="panel">
            <h2>账户与默认模型</h2>
            <form
              key={
                data.profile.display_name +
                String(data.preference.default_model_id)
              }
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                run(async () => {
                  await api("/api/settings", {
                    method: "PUT",
                    body: {
                      display_name: f.get("display_name"),
                      default_model_id: f.get("model") || null,
                    },
                  });
                  setMessage("设置已保存");
                  await onChanged();
                });
              }}
            >
              <div className="form-grid">
                <Field label="显示名称">
                  <input
                    name="display_name"
                    maxLength={80}
                    defaultValue={data.profile.display_name}
                    required
                  />
                </Field>
                <Field label="当前空间的默认模型">
                  <Select
                    variant="box"
                    name="model"
                    defaultValue={data.preference.default_model_id || ""}
                    options={[
                      { value: "", title: "自动选择可用模型" },
                      ...data.models.map((x) => ({
                        value: x.id,
                        title: x.name,
                      })),
                    ]}
                  />
                </Field>
              </div>
              <p className="muted">
                研究和对话中可单独选择模型；已提交的任务继续使用提交时的模型及价格规则。
              </p>
              <Button disabled={busy}>保存设置</Button>
            </form>
          </section>
          <section className="panel">
            <h2>邮箱</h2>
            <p>{data.profile.email || "原有内测账号尚未绑定邮箱"}</p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                run(async () => {
                  await api("/api/account/email", {
                    method: "PUT",
                    body: {
                      email,
                      challenge_id: challenge,
                      code: f.get("code"),
                    },
                  });
                  setMessage("邮箱已验证并绑定");
                  setChallenge(null);
                  await onChanged();
                });
              }}
            >
              <div className="form-grid">
                <Field label="绑定或更换邮箱">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setChallenge(null);
                    }}
                    required
                    maxLength={254}
                  />
                </Field>
                <Field label="邮箱验证码">
                  <input
                    name="code"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    autoComplete="one-time-code"
                  />
                </Field>
              </div>
              <div className="dialog-actions">
                <Button
                  type="button"
                  secondary
                  disabled={busy || !email}
                  onClick={() =>
                    run(async () => {
                      const r = await api("/api/account/email/code", {
                        method: "POST",
                        body: { email },
                      });
                      setChallenge(r.challenge_id);
                      setMessage(r.message);
                    })
                  }
                >
                  发送验证码
                </Button>
                <Button disabled={busy || !challenge}>验证并绑定</Button>
              </div>
            </form>
          </section>
          <section className="panel">
            <h2>数据请求与 token 用量</h2>
            <p className="muted">
              {data.usage.period}；缓存 token 已包含在输入 token
              中。压缩与回答均计入用量，待核对调用另行列出。
            </p>
            <div className="table-frame">
              <table>
                <thead>
                  <tr>
                    <th>范围</th>
                    <th>数据查询</th>
                    <th>快照命中</th>
                    <th>数据积分</th>
                    <th>输入 token</th>
                    <th>输出 token</th>
                    <th>合计 token</th>
                    <th>模型费用</th>
                    <th>待核对</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["own", "我的用量"],
                    ["team", "当前空间合计"],
                  ].map(([key, label]) => {
                    const u = data.usage[key];
                    return (
                      <tr key={key}>
                        <th>{label}</th>
                        <td>{u.data_requests}</td>
                        <td>{u.snapshot_hits}</td>
                        <td>{u.data_points}</td>
                        <td>{Number(u.input_tokens).toLocaleString()}</td>
                        <td>{Number(u.output_tokens).toLocaleString()}</td>
                        <td>{Number(u.total_tokens).toLocaleString()}</td>
                        <td>¥ {money(u.model_micro_cny)}</td>
                        <td>{u.pending_reconciliation}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
