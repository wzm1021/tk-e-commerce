import { useState } from "react";
import { useLoad } from "../../hooks/useLoad.mjs";
import { PageTitle } from "../../components/PageTitle.jsx";
import { Button, Field, ErrorBox, Loading } from "../../components/ui.jsx";
import { Select } from "../../components/Select.jsx";
import { datetime } from "../../lib/format.mjs";

export function TeamPage({ api, onChanged }) {
  const [version, setVersion] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const { data, error: loadError } = useLoad(api, "/api/team", version);
  const manager = ["owner", "admin"].includes(data?.role),
    owner = data?.role === "owner";
  async function run(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
      setVersion((v) => v + 1);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="TEAM & SUBSCRIPTION"
        title="团队与订阅"
        description="团队成员共享研究资料、模型余额和数据积分。个人空间与团队空间分别计费。"
      >
        <Button secondary onClick={() => run(() => onChanged())}>
          刷新团队列表
        </Button>
      </PageTitle>
      <ErrorBox error={error || loadError} />
      {!data ? (
        <Loading />
      ) : (
        <>
          <section className="panel">
            <h2>{data.workspace.name}</h2>
            <p>
              {data.workspace.kind === "personal"
                ? "个人空间"
                : `团队 · ${data.members.length} / ${data.seat_limit} 个席位`}
            </p>
            <p>
              {data.workspace.subscription_required
                ? data.workspace.subscribed
                  ? `订阅有效至 ${datetime(data.workspace.ends_at)}`
                  : "团队订阅待开通或已到期，请联系平台管理员确认收款后开通。"
                : "当前按已充值或内测赠送额度使用。"}
            </p>
            <p className="muted">
              新增成员必须先完成邮箱注册。订阅到期后暂停新的研究调用，已有报告与余额保留；续订额度由平台后台发放。
            </p>
          </section>
          {data.workspace.kind === "team" ? (
            <section className="panel">
              <h2>团队成员</h2>
              {manager ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    run(() =>
                      api("/api/team/members", {
                        method: "POST",
                        body: {
                          email: f.get("email"),
                          role: f.get("role") || "member",
                        },
                      }),
                    );
                  }}
                >
                  <div className="form-grid">
                    <Field label="已注册成员邮箱">
                      <input name="email" type="email" required />
                    </Field>
                    <Field label="成员角色">
                      <Select
                        variant="box"
                        name="role"
                        options={[
                          { value: "member", title: "成员" },
                          ...(owner
                            ? [{ value: "admin", title: "团队管理员" }]
                            : []),
                        ]}
                      />
                    </Field>
                  </div>
                  <Button disabled={busy}>添加已注册成员</Button>
                </form>
              ) : (
                <p className="muted">只有负责人和团队管理员可以添加成员。</p>
              )}
              <div className="table-frame">
                <table>
                  <thead>
                    <tr>
                      <th>成员</th>
                      <th>邮箱</th>
                      <th>角色</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.members.map((m) => (
                      <tr key={m.id}>
                        <td>{m.display_name}</td>
                        <td>{m.email || m.login}</td>
                        <td>
                          {
                            {
                              owner: "负责人",
                              admin: "团队管理员",
                              member: "成员",
                            }[m.role]
                          }
                        </td>
                        <td>
                          {owner && m.role !== "owner" ? (
                            <Button
                              secondary
                              disabled={busy}
                              onClick={() =>
                                run(() =>
                                  api(`/api/team/members/${m.id}`, {
                                    method: "PATCH",
                                    body: {
                                      role:
                                        m.role === "admin" ? "member" : "admin",
                                    },
                                  }),
                                )
                              }
                            >
                              {m.role === "admin" ? "设为成员" : "设为管理员"}
                            </Button>
                          ) : null}
                          {manager &&
                          m.role !== "owner" &&
                          (owner || m.role === "member") ? (
                            <Button
                              secondary
                              disabled={busy}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `移除 ${m.display_name} 后，该成员将无法访问团队资料或继续使用团队额度。`,
                                  )
                                )
                                  run(() =>
                                    api(`/api/team/members/${m.id}`, {
                                      method: "DELETE",
                                      body: {},
                                    }),
                                  );
                              }}
                            >
                              移除
                            </Button>
                          ) : null}
                          {owner && m.role !== "owner" ? (
                            <Button
                              secondary
                              disabled={busy}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `将团队负责人转交给 ${m.display_name}？你将成为团队管理员。`,
                                  )
                                )
                                  run(async () => {
                                    await api("/api/team/transfer", {
                                      method: "POST",
                                      body: { user_id: m.id },
                                    });
                                    await onChanged();
                                  });
                              }}
                            >
                              转交负责人
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      )}
      <section className="panel">
        <h2>创建团队</h2>
        <p>
          团队创建后，由平台后台开通订阅和共享额度。不会自动收费或从个人余额划转。
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(async () => {
              const r = await api("/api/teams", {
                method: "POST",
                body: { name: f.get("name") },
              });
              await onChanged(r.id);
            });
          }}
        >
          <Field label="团队名称">
            <input name="name" maxLength={100} required />
          </Field>
          <Button disabled={busy}>创建团队</Button>
        </form>
      </section>
    </>
  );
}
