import { useState, useEffect } from "react";
import { Button, Field, Loading, ErrorBox } from "../../components/ui.jsx";
import { Dialog } from "../../components/Dialog.jsx";
import { statuses } from "./model.mjs";
import "./ai-testing.css";
const defaults = {
  name: "",
  owner_identity: "",
  key: "",
  trial_used: null,
  trial_limit: 6,
  monthly_used: 0,
  monthly_limit: 150,
  priority: 100,
  note: "",
  enabled: false,
};
const patchOf = (f) =>
  Object.fromEntries(
    [
      "name",
      "enabled",
      "trial_used",
      "trial_limit",
      "monthly_used",
      "monthly_limit",
      "priority",
      "note",
    ].map((k) => [k, f[k]]),
  );
export function AccountPool({ api, version }) {
  const [data, setData] = useState(null),
    [revision, setRevision] = useState(0),
    [form, setForm] = useState(null),
    [rotation, setRotation] = useState(null),
    [reconcile, setReconcile] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    api("/api/admin/ai-test-accounts")
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [api, version, revision]);
  async function action(path, body = {}, method = "POST", close) {
    setBusy(true);
    setError("");
    try {
      await api(path, { method, body });
      close?.();
      setRevision((v) => v + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const base = "/api/admin/ai-test-accounts";
  return (
    <div className="ai-testing">
      <ErrorBox error={error} />
      <div className="ai-note">
        共享账号由平台管理。同一账号仅登记一次，多把密钥不增加其额度。试用次数按累计消耗记录，月度额度按
        UTC 自然月记录；未知余量的账号不能启用。
      </div>
      <div>
        <Button onClick={() => setForm({ ...defaults })}>添加共享账号</Button>
      </div>
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="ai-grid">
            {data.items.map((a) => (
              <article className="ai-card" key={a.id}>
                <h3>{a.name}</h3>
                <p>{a.owner_identity}</p>
                <p>
                  {a.enabled ? "已启用" : "已停用"} ·{" "}
                  {statuses[a.state] || a.state} ·{" "}
                  {a.verified ? "密钥已验证" : "密钥待验证"}
                </p>
                <dl className="ai-facts">
                  <dt>累计试用</dt>
                  <dd>
                    {a.trial_used ?? "待核验"} / {a.trial_limit}
                  </dd>
                  <dt>月度额度</dt>
                  <dd>
                    {a.monthly_used} / {a.monthly_limit} · {a.quota_month}
                  </dd>
                  <dt>预留额度</dt>
                  <dd>{a.reserved_credits}</dd>
                  <dt>在途任务</dt>
                  <dd>{a.active}</dd>
                </dl>
                <div className="ai-actions">
                  <Button
                    secondary
                    disabled={busy}
                    onClick={() => action(base + "/" + a.id + "/validate")}
                  >
                    验证密钥
                  </Button>
                  <Button
                    secondary
                    disabled={busy || a.active > 0}
                    onClick={() => setForm(a)}
                  >
                    编辑额度 / 启停
                  </Button>
                  <Button
                    secondary
                    disabled={busy || a.active > 0}
                    onClick={() => setRotation({ id: a.id, key: "" })}
                  >
                    更新密钥
                  </Button>
                </div>
              </article>
            ))}
          </div>
          <section className="ai-card">
            <h2>额度使用记录</h2>
            <div className="table-frame">
              <table>
                <thead>
                  <tr>
                    <th>账号</th>
                    <th>测试</th>
                    <th>尝试</th>
                    <th>预留 / 实耗</th>
                    <th>试用计次</th>
                    <th>状态</th>
                    <th>处理</th>
                  </tr>
                </thead>
                <tbody>
                  {data.usage.map((r) => (
                    <tr key={r.id}>
                      <td>{r.account_name}</td>
                      <td>{r.run_id.slice(0, 8)}</td>
                      <td>{r.attempt}</td>
                      <td>
                        {r.credits} / {r.charged ?? "待结算"}
                      </td>
                      <td>{r.trial_counted ? "已计次" : "未确认开始"}</td>
                      <td>
                        {{
                          reserved: "预留",
                          started: "已开始",
                          uncertain: "待核对",
                          settled: "已结算",
                          released: "已释放",
                        }[r.state] || r.state}
                      </td>
                      <td>
                        {r.state === "uncertain" && (
                          <Button
                            secondary
                            onClick={() =>
                              setReconcile({
                                id: r.id,
                                remote_id: "",
                                note: "",
                              })
                            }
                          >
                            核对任务
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      {form && (
        <Dialog
          title={form.id ? "编辑共享账号" : "添加共享账号"}
          onClose={() => !busy && setForm(null)}
        >
          <form
            className="ai-testing"
            onSubmit={(e) => {
              e.preventDefault();
              const body = form.id
                ? patchOf(form)
                : Object.fromEntries(
                    Object.entries(form).filter(([k]) => k !== "enabled"),
                  );
              action(
                base + (form.id ? "/" + form.id : ""),
                body,
                form.id ? "PATCH" : "POST",
                () => setForm(null),
              );
            }}
          >
            <ErrorBox error={error} />
            <Field label="账号名称">
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            {!form.id && (
              <>
                <Field label="账号唯一标识（邮箱或号码）">
                  <input
                    required
                    value={form.owner_identity}
                    onChange={(e) =>
                      setForm({ ...form, owner_identity: e.target.value })
                    }
                  />
                </Field>
                <Field label="API Key">
                  <input
                    required
                    type="password"
                    autoComplete="new-password"
                    value={form.key}
                    onChange={(e) => setForm({ ...form, key: e.target.value })}
                  />
                </Field>
              </>
            )}
            <div className="ai-fields">
              {Object.entries({
                trial_used: "已用试用次数（未知留空）",
                trial_limit: "试用次数上限",
                monthly_used: "本月已用额度",
                monthly_limit: "本月额度上限",
                priority: "优先级（数字越小越优先）",
              }).map(([k, l]) => (
                <Field label={l} key={k}>
                  <input
                    type="number"
                    min="0"
                    required={k !== "trial_used"}
                    value={form[k] ?? ""}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        [k]:
                          e.target.value === "" && k === "trial_used"
                            ? null
                            : Number(e.target.value),
                      })
                    }
                  />
                </Field>
              ))}
            </div>
            <Field label="核验说明">
              <textarea
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </Field>
            {form.id && (
              <label className="ai-check">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) =>
                    setForm({ ...form, enabled: e.target.checked })
                  }
                />
                启用账号（需要验证密钥并填写已用次数）
              </label>
            )}
            <p className="muted">
              当前额度月份以 UTC
              本月为准。请核对上游已有用量后保存；测试取消或退款不会自动恢复累计试用次数。
            </p>
            <Button disabled={busy}>{busy ? "保存中…" : "保存账号"}</Button>
          </form>
        </Dialog>
      )}
      {rotation && (
        <Dialog
          title="更新共享账号密钥"
          onClose={() => !busy && setRotation(null)}
        >
          <form
            className="ai-testing"
            onSubmit={(e) => {
              e.preventDefault();
              action(
                base + "/" + rotation.id + "/rotate",
                { key: rotation.key },
                "POST",
                () => setRotation(null),
              );
            }}
          >
            <ErrorBox error={error} />
            <Field label="新 API Key">
              <input
                required
                type="password"
                autoComplete="new-password"
                value={rotation.key}
                onChange={(e) =>
                  setRotation({ ...rotation, key: e.target.value })
                }
              />
            </Field>
            <p>更新后需重新验证并启用，不重置账号用量。</p>
            <Button disabled={busy}>保存新密钥</Button>
          </form>
        </Dialog>
      )}
      {reconcile && (
        <Dialog
          title="核对未确定的任务"
          onClose={() => !busy && setReconcile(null)}
        >
          <form
            className="ai-testing"
            onSubmit={(e) => {
              e.preventDefault();
              action(
                "/api/admin/ai-test-reservations/" +
                  reconcile.id +
                  "/reconcile",
                { remote_id: reconcile.remote_id, note: reconcile.note },
                "POST",
                () => setReconcile(null),
              );
            }}
          >
            <ErrorBox error={error} />
            <p>
              在该账号的服务后台找到对应测试，填写任务
              ID。系统会核验归属后恢复查询，沿用原账号与额度记录。
            </p>
            <Field label="上游任务 ID">
              <input
                required
                value={reconcile.remote_id}
                onChange={(e) =>
                  setReconcile({ ...reconcile, remote_id: e.target.value })
                }
              />
            </Field>
            <Field label="核对说明">
              <textarea
                required
                minLength={8}
                value={reconcile.note}
                onChange={(e) =>
                  setReconcile({ ...reconcile, note: e.target.value })
                }
              />
            </Field>
            <Button disabled={busy}>验证并关联已有任务</Button>
          </form>
        </Dialog>
      )}
    </div>
  );
}
