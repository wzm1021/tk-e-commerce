import { CustomerAnalytics } from "../customers/CustomerAnalytics.jsx";
import { FeedbackHistory } from "../feedback/FeedbackPage.jsx";
import { MailService } from "../feedback/FeedbackMail.jsx";
import { useState, useEffect, useMemo } from "react";
import {
  Plus,
  RefreshCw,
  Users,
  LayoutDashboard,
  KeyRound,
  Coins,
  BookOpen,
  ReceiptText,
  Activity,
  ShieldCheck,
} from "lucide-react";
import { makeApi } from "../../lib/api.mjs";
import { useLoad } from "../../hooks/useLoad.mjs";
import { Shell } from "../../components/Shell.jsx";
import { PageTitle } from "../../components/PageTitle.jsx";
import {
  Button,
  Field,
  Badge,
  Empty,
  ErrorBox,
  Loading,
  JsonView,
} from "../../components/ui.jsx";
import { Dialog } from "../../components/Dialog.jsx";
import { Select } from "../../components/Select.jsx";
import { datetime } from "../../lib/format.mjs";
import { MailAdmin, SubscriptionAdmin } from "./AccountAdmin.jsx";
import { ResourcesPanel, DataLibraryPanel } from "./ResourcesPanel.jsx";
import { kindNames } from "./constants.mjs";
import { AdminForm } from "./AdminForm.jsx";
import { ConnectionForm } from "./ConnectionForm.jsx";
import { PriceForm } from "./PriceForm.jsx";
import { SkillsPanel } from "./SkillsPanel.jsx";
import { BillingPanel } from "./BillingPanel.jsx";
import { AccountPool } from "../ai-testing/AccountPool.jsx";

const nav = [
  { key: "overview", label: "平台概览", icon: LayoutDashboard },
  { key: "customers", label: "客户与使用分析", icon: Users },
  { key: "feedback", label: "客户反馈", icon: ReceiptText },
  { key: "tenants", label: "租户与账号", icon: Users },
  { key: "connections", label: "API 密钥与连接", icon: KeyRound },
  { key: "resources", label: "共享资源并发", icon: Activity },
  { key: "ai-testing", label: "AI 测品额度池", icon: KeyRound },
  { key: "data-library", label: "数据快照库", icon: ReceiptText },
  { key: "prices", label: "模型价格", icon: Coins },
  { key: "subscriptions", label: "团队订阅", icon: Users },
  { key: "mail", label: "邮件服务", icon: KeyRound },
  { key: "skills", label: "租户技能发布", icon: BookOpen },
  { key: "billing", label: "充值与账本", icon: ReceiptText },
  { key: "audit", label: "操作审计", icon: Activity },
];

export function Console({ session, refreshSession }) {
  const api = useMemo(() => makeApi("admin"), []);
  const [page, setPage] = useState("overview"),
    [version, setVersion] = useState(0),
    [workspace, setWorkspace] = useState(""),
    [dialog, setDialog] = useState(null),
    [editingConnection, setEditingConnection] = useState(null),
    [showInactive, setShowInactive] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState("");
  const reload = () => setVersion((v) => v + 1);
  const { data: allData, error: loadError } = useLoad(
    api,
    "/api/admin/overview",
    version,
  );
  const { data: prices } = useLoad(api, "/api/admin/prices", version),
    { data: health } = useLoad(api, "/api/admin/health", version);
  const data = useMemo(
    () =>
      allData && {
        ...allData,
        workspaces: allData.workspaces.filter((w) => showInactive || w.enabled),
        users: allData.users.filter((u) => showInactive || u.enabled),
        connections: allData.connections.filter(
          (c) => showInactive || c.enabled || !c.verified,
        ),
      },
    [allData, showInactive],
  );
  const visiblePrices =
    prices?.items.filter(
      (p) =>
        showInactive || data?.connections.some((c) => c.id === p.connection_id),
    ) || [];
  useEffect(() => {
    if (
      data?.workspaces.length &&
      !data.workspaces.some((w) => w.id === workspace)
    )
      setWorkspace(data.workspaces[0].id);
  }, [data, workspace]);
  async function action(path, body = {}, method = "POST") {
    setBusy(path);
    setError("");
    try {
      await api(path, { method, body });
      reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  }
  const title = nav.find((n) => n.key === page)?.label;
  return (
    <Shell
      session={session}
      nav={nav}
      page={page}
      setPage={setPage}
      audience="admin"
      onLogout={async () => {
        await api("/api/auth/logout", {
          method: "POST",
          body: { audience: "admin" },
        });
        refreshSession();
      }}
    >
      {!["customers", "feedback", "mail"].includes(page) && (
        <PageTitle
          eyebrow="PLATFORM CONSOLE"
          title={title}
          description="平台侧独立管理，密钥、采购价格和技能配置对用户空间隔离。"
        >
          <Button secondary onClick={reload}>
            <RefreshCw size={16} />
            刷新
          </Button>
          {["tenants", "connections", "prices"].includes(page) && (
            <Button onClick={() => setDialog(page)}>
              <Plus size={16} />
              {page === "tenants"
                ? "新建租户"
                : page === "connections"
                  ? "新增连接"
                  : "发布价格"}
            </Button>
          )}
        </PageTitle>
      )}
      <ErrorBox error={error || loadError} />
      {["overview", "tenants", "connections", "prices"].includes(page) && (
        <label className="inactive-toggle">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          显示停用记录（含对应价卡）
        </label>
      )}
      {!data ? (
        <Loading />
      ) : (
        <>
          {["skills", "billing", "subscriptions"].includes(page) && (
            <div className="workspace-picker">
              <Field label="当前管理租户">
                <Select
                  variant="box"
                  size="sm"
                  value={workspace}
                  onChange={setWorkspace}
                  options={data.workspaces.map((w) => ({
                    value: w.id,
                    title: w.name,
                  }))}
                />
              </Field>
            </div>
          )}
          {page === "overview" && (
            <>
              <div className="metric-grid four">
                <div>
                  <small>已启用租户</small>
                  <strong>
                    {allData.workspaces.filter((w) => w.enabled).length}
                  </strong>
                </div>
                <div>
                  <small>已启用账号</small>
                  <strong>
                    {allData.users.filter((u) => u.enabled).length}
                  </strong>
                </div>
                <div>
                  <small>已启用连接</small>
                  <strong>
                    {data.connections.filter((c) => c.enabled).length}
                  </strong>
                </div>
                <div>
                  <small>在线 Agent 节点</small>
                  <strong>
                    {health?.workers.filter(
                      (w) => Date.now() - new Date(w.last_seen) < 90000,
                    ).length || 0}
                  </strong>
                </div>
              </div>
              <section className="panel">
                <h2>执行节点</h2>
                {health?.workers.length ? (
                  health.workers.map((w) => (
                    <div className="job-row" key={w.id}>
                      <ShieldCheck size={19} />
                      <strong>{w.id}</strong>
                      <span>
                        {Date.now() - new Date(w.last_seen) < 90000
                          ? "在线"
                          : "未连接"}
                        <small>最后心跳 {datetime(w.last_seen)}</small>
                      </span>
                      <span>
                        {w.active_job
                          ? "最近任务 " + w.active_job.slice(0, 8)
                          : "等待任务"}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="muted">Agent 节点尚未注册。</p>
                )}
              </section>
              <section className="panel">
                <h2>当前部署</h2>
                <p>
                  阿里云上海应用服务器 · 腾讯云上海 Agent 服务器 · RDS
                  PostgreSQL
                </p>
                <p className="muted">
                  文件和日志暂存应用服务器；技能按租户独立版本发布，任务保留固定版本与账本。
                </p>
              </section>
            </>
          )}
          {page === "tenants" && (
            <>
              <div className="opportunity-grid">
                {data.workspaces.map((w) => (
                  <article
                    className="opportunity-card admin-workspace-card"
                    key={w.id}
                  >
                    <div className="section-line">
                      <h2>{w.name}</h2>
                      <Badge value={w.enabled ? "已启用" : "已停用"} />
                    </div>
                    <p className="workspace-company">
                      {w.company_names?.join("、") || "公司名称待完善"}
                    </p>
                    <div className="dialog-actions">
                      <Button
                        secondary
                        onClick={() => {
                          setWorkspace(w.id);
                          setDialog("user");
                        }}
                      >
                        添加已注册成员
                      </Button>
                      <Button
                        secondary
                        onClick={() => {
                          setWorkspace(w.id);
                          setDialog("assign");
                        }}
                      >
                        分配连接
                      </Button>
                      <Button
                        onClick={() => {
                          setWorkspace(w.id);
                          setPage("skills");
                        }}
                      >
                        技能版本
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
              <section className="panel">
                <h2>用户账号</h2>
                {data.users.map((u) => (
                  <div className="job-row" key={u.id}>
                    <strong>{u.display_name}</strong>
                    <span>
                      {u.login}
                      <small>{u.is_admin ? "平台管理员" : "用户"}</small>
                    </span>
                    <Badge value={u.enabled ? "已启用" : "已停用"} />
                    <Button
                      secondary
                      disabled={u.id === session.user.id || Boolean(busy)}
                      onClick={() =>
                        action(
                          "/api/admin/users/" + u.id,
                          { enabled: !u.enabled },
                          "PATCH",
                        )
                      }
                    >
                      {u.enabled ? "停用账号" : "启用账号"}
                    </Button>
                  </div>
                ))}
              </section>
            </>
          )}
          {page === "mail" && <MailService api={api} />}
          {page === "customers" && <CustomerAnalytics api={api} />}
          {page === "feedback" && (
            <>
              <PageTitle
                eyebrow="CUSTOMER FEEDBACK"
                title="客户反馈"
                description="查看反馈和附件，跟进处理进展。"
              />
              <FeedbackHistory api={api} admin />
            </>
          )}
          {page === "ai-testing" && <AccountPool api={api} version={version} />}
          {page === "subscriptions" && workspace && (
            <SubscriptionAdmin
              key={workspace}
              api={api}
              workspace={workspace}
            />
          )}
          {page === "connections" && (
            <div className="opportunity-grid">
              {data.connections.map((c) => (
                <article className="opportunity-card" key={c.id}>
                  <div className="section-line">
                    <small>{kindNames[c.kind]}</small>
                    <Badge
                      value={
                        c.enabled ? "已启用" : c.verified ? "已验证" : "待验证"
                      }
                    />
                  </div>
                  <h2>{c.name}</h2>
                  <p>{c.config?.model}</p>
                  <small className="break-all">{c.config?.endpoint}</small>
                  <p className="muted">密钥已加密保存 · 版本 {c.generation}</p>
                  {["model", "fastmoss", "sellersprite"].includes(c.kind) ? (
                    <label className="inactive-toggle">
                      <input
                        type="checkbox"
                        checked={Boolean(c.signup_default)}
                        disabled={
                          Boolean(busy) ||
                          (!c.signup_default && (!c.enabled || !c.verified))
                        }
                        onChange={(e) =>
                          action(
                            `/api/admin/connections/${c.id}/signup-default`,
                            { enabled: e.target.checked },
                            "PUT",
                          )
                        }
                      />
                      为新注册空间默认分配
                    </label>
                  ) : null}
                  {c.validation?.checked_at && (
                    <small>最近验证 {datetime(c.validation.checked_at)}</small>
                  )}
                  <div className="dialog-actions">
                    <Button
                      secondary
                      disabled={Boolean(busy)}
                      onClick={() => {
                        setEditingConnection(c);
                        setDialog("rotate");
                      }}
                    >
                      更新密钥
                    </Button>
                    <Button
                      secondary
                      disabled={Boolean(busy)}
                      onClick={() =>
                        action(`/api/admin/connections/${c.id}/validate`)
                      }
                    >
                      验证连接
                    </Button>
                    <Button
                      disabled={Boolean(busy) || (!c.enabled && !c.verified)}
                      onClick={() =>
                        action(
                          "/api/admin/connections/" + c.id,
                          { enabled: !c.enabled },
                          "PATCH",
                        )
                      }
                    >
                      {c.enabled ? "暂停连接" : "启用连接"}
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
          {page === "resources" && (
            <ResourcesPanel
              api={api}
              version={version}
              reload={reload}
              showInactive={showInactive}
            />
          )}
          {page === "data-library" && (
            <DataLibraryPanel api={api} version={version} reload={reload} />
          )}
          {page === "prices" && (
            <>
              {visiblePrices.length ? (
                visiblePrices.map((p) => (
                  <section className="panel" key={p.id}>
                    <div className="section-line">
                      <h2>{p.name}</h2>
                      <Badge value={p.active ? "当前版本" : "历史版本"} />
                    </div>
                    <div className="price-grid">
                      {[
                        ["input", "输入"],
                        ["output", "输出"],
                        ["cache_read", "缓存读取"],
                        ["cache_write", "缓存写入"],
                      ].map(([k, label]) => (
                        <div key={k}>
                          <small>{label} / 百万 token</small>
                          <strong>
                            {p.data.time_pricing ? "高峰销售" : "销售"} ¥{" "}
                            {(
                              Number(p.data.market[k]) *
                              Number(p.data.fx) *
                              Number(p.data.sale_discount)
                            ).toFixed(3)}
                          </strong>
                          <small>
                            采购 ¥{" "}
                            {(
                              Number(p.data.market[k]) *
                              Number(p.data.fx) *
                              Number(p.data.procurement_discount)
                            ).toFixed(3)}
                          </small>
                        </div>
                      ))}
                    </div>
                    {p.data.time_pricing ? (
                      <p className="muted">
                        北京时间周一至周五 09:00–12:00、14:00–18:00
                        为高峰，其余时段采购与销售均乘{" "}
                        {p.data.time_pricing.off_peak_discount}
                        。按每次请求发出时间计价。
                      </p>
                    ) : null}
                    <p>{p.data.note}</p>
                    <small>
                      人民币 / 百万 token
                      {p.data.currency !== "CNY"
                        ? "（历史价卡按原汇率换算展示）"
                        : "，直接计价"}{" "}
                      · 发布时间 {datetime(p.created_at)}
                    </small>
                  </section>
                ))
              ) : (
                <Empty title="先发布一张价格表">
                  按供应商人民币报价配置输入、输出和缓存价格，并独立设置采购与销售系数。
                </Empty>
              )}
            </>
          )}
          {page === "skills" && workspace && (
            <SkillsPanel
              key={workspace}
              api={api}
              workspace={workspace}
              version={version}
              reload={reload}
            />
          )}
          {page === "billing" && workspace && (
            <BillingPanel
              key={workspace}
              api={api}
              workspace={workspace}
              version={version}
              reload={reload}
            />
          )}
          {page === "audit" && (
            <div className="table-frame">
              <table>
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>操作</th>
                    <th>目标</th>
                    <th>摘要</th>
                  </tr>
                </thead>
                <tbody>
                  {data.audit.map((a) => (
                    <tr key={a.id}>
                      <td>{datetime(a.created_at)}</td>
                      <td>{a.action}</td>
                      <td className="break-all">{a.target_id}</td>
                      <td>
                        <details>
                          <summary>查看详情</summary>
                          <JsonView value={a.summary} />
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {dialog && (
        <Dialog
          title={
            {
              tenants: "新建租户空间",
              user: "添加已注册成员",
              connections: "新增 API 连接",
              rotate: "更新 API 密钥与配置",
              prices: "发布模型价格",
              assign: "分配租户连接",
            }[dialog]
          }
          onClose={() => setDialog(null)}
          wide={["connections", "rotate", "prices"].includes(dialog)}
        >
          {["connections", "rotate"].includes(dialog) ? (
            <ConnectionForm
              api={api}
              existing={dialog === "rotate" ? editingConnection : undefined}
              onSaved={() => {
                setDialog(null);
                reload();
              }}
            />
          ) : dialog === "prices" ? (
            <PriceForm
              api={api}
              connections={data?.connections || []}
              onSaved={() => {
                setDialog(null);
                reload();
              }}
            />
          ) : dialog === "tenants" ? (
            <AdminForm
              api={api}
              path="/api/admin/teams"
              convert={(f) => ({
                name: f.get("name"),
                owner_email: f.get("owner_email"),
              })}
              onSaved={(r) => {
                setWorkspace(r.id);
                setDialog(null);
                reload();
              }}
            >
              <Field label="负责人的已注册邮箱">
                <input name="owner_email" type="email" required />
              </Field>
              <Field label="租户名称">
                <input name="name" required maxLength={100} />
              </Field>
            </AdminForm>
          ) : dialog === "user" ? (
            <AdminForm
              api={api}
              path={`/api/admin/workspaces/${workspace}/members`}
              convert={(f) => ({ email: f.get("email"), role: f.get("role") })}
              onSaved={() => {
                setDialog(null);
                reload();
              }}
            >
              <p>成员必须先完成邮箱注册；加入后共享团队研究资料和额度。</p>
              <Field label="已注册成员邮箱">
                <input name="email" type="email" required />
              </Field>
              <Field label="团队角色">
                <Select
                  variant="box"
                  name="role"
                  options={[
                    { value: "member", title: "成员" },
                    { value: "admin", title: "团队管理员" },
                  ]}
                />
              </Field>
            </AdminForm>
          ) : (
            <AdminForm
              api={api}
              path={`/api/admin/workspaces/${workspace}/connections`}
              method="PUT"
              convert={(f) => ({
                connection_id: f.get("connection_id"),
                enabled: f.get("enabled") === "true",
              })}
              onSaved={() => {
                setDialog(null);
                reload();
              }}
            >
              <Field label="供应商连接">
                <Select
                  variant="box"
                  name="connection_id"
                  options={
                    data?.connections.map((c) => ({
                      value: c.id,
                      title: c.name,
                    })) ?? []
                  }
                />
              </Field>
              <Field label="授权状态">
                <Select
                  variant="box"
                  name="enabled"
                  options={[
                    { value: "true", title: "允许此租户使用" },
                    { value: "false", title: "撤销此租户授权" },
                  ]}
                />
              </Field>
            </AdminForm>
          )}
        </Dialog>
      )}
    </Shell>
  );
}
