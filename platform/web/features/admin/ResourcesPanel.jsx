import { useState } from "react";
import { useLoad } from "../../hooks/useLoad.mjs";
import {
  Field,
  Button,
  ErrorBox,
  Loading,
  JsonView,
} from "../../components/ui.jsx";
import { Dialog } from "../../components/Dialog.jsx";
import { Select } from "../../components/Select.jsx";
import { datetime, errorLabel } from "../../lib/format.mjs";
import { DataPricing } from "../../components/DataPricing.jsx";

function SettingsForm({ api, path, method = "PUT", body, onSaved, children }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setError("");
        try {
          await api(path, { method, body: body(f) });
          onSaved();
        } catch (e) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
      <ErrorBox error={error} />
      <Button disabled={busy}>{busy ? "保存中…" : "保存设置"}</Button>
    </form>
  );
}
export function ResourcesPanel({ api, version, reload, showInactive = false }) {
  const { data, error } = useLoad(
    api,
    "/api/admin/resources?include_disabled=" + showInactive,
    version,
  );
  if (!data)
    return (
      <>
        <ErrorBox error={error} />
        <Loading />
      </>
    );
  return (
    <>
      <p className="notice">
        同一供应商主机下的连接共享并发和每分钟调用额度。超出时进入有上限的队列；单个租户也有独立并发上限。设置立即生效，正在执行的调用正常结束。当前
        Agent 服务器默认同时执行 1 个研究任务。
      </p>
      {data.groups.map((g) => (
        <section className="panel" key={g.key}>
          <h2>{g.key}</h2>
          <p>
            {data.connections
              .filter((c) => c.resource_key === g.key)
              .map((c) => `${c.name}（${c.enabled ? "已启用" : "已暂停"}）`)
              .join("；")}
          </p>
          <p>
            执行中 {g.active} · 排队 {g.queued} · 冷却结束{" "}
            {datetime(g.cooldown_until)}
          </p>
          <SettingsForm
            key={version}
            api={api}
            path={"/api/admin/resources/" + encodeURIComponent(g.key)}
            body={(f) =>
              Object.fromEntries([...f].map(([k, v]) => [k, Number(v)]))
            }
            onSaved={reload}
          >
            <div className="form-grid">
              {[
                ["max_concurrent", "共享并发上限", 100],
                ["max_per_workspace", "单租户并发上限", 100],
                ["queue_limit", "等待队列上限", 1000],
                ["requests_per_minute", "每分钟最多调用数", 10000],
              ].map(([key, label, max]) => (
                <Field label={label} key={key}>
                  <input
                    name={key}
                    type="number"
                    min="1"
                    max={max}
                    step="1"
                    defaultValue={g[key]}
                    required
                  />
                </Field>
              ))}
            </div>
          </SettingsForm>
        </section>
      ))}
      {data.connections
        .filter((c) => ["fastmoss", "sellersprite"].includes(c.kind))
        .map((c) => (
          <section className="panel" key={c.id}>
            <h2>{c.name} · 快照共享范围</h2>
            <SettingsForm
              api={api}
              path={`/api/admin/connections/${c.id}/snapshots`}
              body={(f) => ({ shared: f.get("scope") === "shared" })}
              onSaved={reload}
            >
              <Field
                label="数据范围"
                hint="仅平台采购的公共市场数据适合共享。租户私有资料始终独立保存。"
              >
                <Select
                  variant="box"
                  name="scope"
                  defaultValue={c.share_market_snapshots ? "shared" : "private"}
                  options={[
                    { value: "shared", title: "授权租户间共享市场快照" },
                    { value: "private", title: "每个租户单独复用快照" },
                  ]}
                />
              </Field>
            </SettingsForm>
          </section>
        ))}
    </>
  );
}
export function DataLibraryPanel({ api, version, reload }) {
  const { data, error } = useLoad(api, "/api/admin/data-library", version);
  const [selected, setSelected] = useState(null),
    [viewError, setViewError] = useState("");
  if (!data)
    return (
      <>
        <ErrorBox error={error} />
        <Loading />
      </>
    );
  const live = data.usage.reduce((n, x) => n + Number(x.live_calls), 0),
    hits = data.usage.reduce((n, x) => n + Number(x.cache_hits), 0);
  return (
    <>
      <p>
        统计自本次计费规则启用开始，最多展示近 31
        天；历史证据归档不计作新的取数。
      </p>
      <div className="metric-grid">
        <div>
          <small>近 31 天实时取数</small>
          <strong>{live}</strong>
          <small>TikTok 按接口 0–3 积分 / 次</small>
        </div>
        <div>
          <small>近 31 天快照命中</small>
          <strong>{hits}</strong>
          <small>0.3 积分 / 次</small>
        </div>
        <div>
          <small>复用率</small>
          <strong>
            {live + hits ? Math.round((hits / (live + hits)) * 100) : 0}%
          </strong>
          <small>同任务重试不计入调用数</small>
        </div>
      </div>
      <section className="panel">
        <h2>数据积分规则</h2>
        <DataPricing price={data.price} />
      </section>
      <section className="panel">
        <h2>快照有效期</h2>
        <p>
          全部返回结果留存。有效期只决定能否用于新的查询，不删除历史数据。0
          表示停用该接口的快照复用；已有快照不会因延长有效期而重新生效。
        </p>
        <SettingsForm
          api={api}
          path="/api/admin/data-library/policy"
          onSaved={reload}
          body={(f) => ({
            tool: f.get("tool"),
            ttl_seconds: Number(f.get("seconds")),
          })}
        >
          <div className="form-grid">
            <Field label="适用接口">
              <Select
                variant="box"
                name="tool"
                options={[
                  { value: "*", title: "所有接口默认值" },
                  ...data.tools.map((t) => ({ value: t, title: t })),
                ]}
              />
            </Field>
            <Field label="有效时间（秒）">
              <input
                name="seconds"
                type="number"
                min="0"
                max="86400"
                step="1"
                defaultValue={
                  data.policies.find((p) => p.tool === "*")?.ttl_seconds || 0
                }
                required
              />
            </Field>
          </div>
        </SettingsForm>
        <p>
          {data.policies
            .map(
              (p) => `${p.tool === "*" ? "默认" : p.tool}：${p.ttl_seconds} 秒`,
            )
            .join("；")}
        </p>
      </section>
      <section className="panel">
        <h2>近期数据快照</h2>
        <p>
          展示最近 100
          条。点击可查看结构化原始证据和采集时间；查看操作记入平台审计。
        </p>
        <ErrorBox error={viewError} />
        <div className="table-frame">
          <table>
            <thead>
              <tr>
                <th>接口</th>
                <th>采集时间</th>
                <th>范围</th>
                <th>状态</th>
                <th>体积</th>
                <th>内容</th>
              </tr>
            </thead>
            <tbody>
              {data.snapshots.map((s) => (
                <tr key={s.id}>
                  <td>{s.tool}</td>
                  <td>{datetime(s.captured_at)}</td>
                  <td>{s.scope_workspace_id ? "租户独立" : "平台共享"}</td>
                  <td>
                    {!s.reusable
                      ? "不可复用"
                      : s.fresh
                        ? "有效快照"
                        : "历史快照"}
                  </td>
                  <td>{(Number(s.size_bytes) / 1024).toFixed(1)} KB</td>
                  <td>
                    <Button
                      onClick={async () => {
                        setViewError("");
                        try {
                          setSelected(
                            await api(
                              "/api/admin/data-library/snapshots/" + s.id,
                            ),
                          );
                        } catch (e) {
                          setViewError(e.message);
                        }
                      }}
                    >
                      查看
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {data.unresolved.length > 0 && (
        <section className="panel">
          <h2>待核对的取数</h2>
          <p>
            供应商是否计费尚未确认，已阻止自动重复采购。先在充值与账本中核对原调用费用，再解锁后续查询。
          </p>
          {data.unresolved.map((f) => (
            <details key={f.id}>
              <summary>
                {f.tool} · {f.error_code ? errorLabel(f.error_code) : f.state} ·{" "}
                {datetime(f.created_at)}
              </summary>
              <p>
                空间 {f.owner_workspace_id} · 原调用{" "}
                {f.invocation_id || "尚未预留"}
              </p>
              <Button
                onClick={async () => {
                  setViewError("");
                  try {
                    setSelected(
                      await api(`/api/admin/data-library/fetches/${f.id}`),
                    );
                  } catch (e) {
                    setViewError(e.message);
                  }
                }}
              >
                查看原始响应
              </Button>
              <SettingsForm
                api={api}
                method="POST"
                path={`/api/admin/data-library/fetches/${f.id}/unblock`}
                onSaved={reload}
                body={(f) => Object.fromEntries(f)}
              >
                <Field label="供应商核对凭据">
                  <input name="provider_reference" minLength={5} required />
                </Field>
                <Field label="解锁说明">
                  <textarea name="note" minLength={5} required />
                </Field>
              </SettingsForm>
            </details>
          ))}
        </section>
      )}
      {selected && (
        <Dialog title="数据详情" onClose={() => setSelected(null)}>
          <JsonView value={selected} />
        </Dialog>
      )}
    </>
  );
}
