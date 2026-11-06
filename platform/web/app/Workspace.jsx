import { FeedbackPage } from "../features/feedback/FeedbackPage.jsx";
import { useCustomerActivity } from "../hooks/useCustomerActivity.mjs";
import { PLATFORMS } from "../lib/platforms.mjs";
import { Select } from "../components/Select.jsx";
import { useState, useMemo, useEffect } from "react";
import {
  Compass,
  Layers,
  Search,
  Package,
  Calculator,
  FlaskConical,
  Wallet,
  Plus,
  ArrowUpRight,
  RefreshCw,
  MessageSquare,
  Settings,
  Users,
  Radar,
} from "lucide-react";
import { makeApi } from "../lib/api.mjs";
import { useLoad } from "../hooks/useLoad.mjs";
import { Shell } from "../components/Shell.jsx";
import { PageTitle } from "../components/PageTitle.jsx";
import { Button, Empty } from "../components/ui.jsx";
import { jobLabels } from "../lib/format.mjs";
import { SupplyPage } from "../features/operations/SupplyPage.jsx";
import { EconomicsPage } from "../features/operations/EconomicsPage.jsx";
import { ExperimentsPage } from "../features/operations/ExperimentsPage.jsx";
import {
  AssistantAttach,
  AssistantPage,
} from "../features/assistant/AssistantPage.jsx";
import { AccountSettings } from "../features/accounts/AccountSettings.jsx";
import { TeamPage } from "../features/accounts/TeamPage.jsx";
import { NewTask } from "../features/research/NewTask.jsx";
import { JobDetail } from "../features/research/JobDetail.jsx";
import { reportPage } from "../features/research/report-navigation.mjs";
import { Reports } from "../features/scouting/Reports.jsx";
import { JobsList } from "../features/research/JobsList.jsx";
import { OpportunityPage } from "../features/opportunities/OpportunityPage.jsx";
import { WalletPage } from "../features/billing/WalletPage.jsx";
import { BalanceSummary } from "../features/billing/BalanceSummary.jsx";
import { MonitoringPage } from "../features/monitoring/MonitoringPage.jsx";
import { AiTestingPage } from "../features/ai-testing/AiTestingPage.jsx";

const nav = [
  { key: "scouting", label: "选品中心", icon: Compass },
  { key: "opportunities", label: "机会池", icon: Layers },
  { key: "ai-testing", label: "AI 测品", icon: FlaskConical },
  { key: "assistant", label: "商品助手", icon: MessageSquare },
  { key: "research", label: "专项研究", icon: Search },
  { key: "monitoring", label: "竞店监控", icon: Radar },
  { key: "supply", label: "货源与测样", icon: Package },
  { key: "economics", label: "利润测算", icon: Calculator },
  { key: "experiments", label: "实验与行动", icon: FlaskConical },
  { key: "wallet", label: "余额与账单", icon: Wallet },
  { key: "team", label: "团队与订阅", icon: Users },
  { key: "feedback", label: "反馈与建议", icon: MessageSquare },
  { key: "settings", label: "设置", icon: Settings },
];

export function Workspace({ session, refreshSession }) {
  const [platform, setPlatform] = useState("tiktok");
  const [workspace, setWorkspace] = useState(session.workspaces[0]?.id || ""),
    [page, setPage] = useState("scouting"),
    [version, setVersion] = useState(0),
    [newTask, setNewTask] = useState(null),
    [jobId, setJobId] = useState(null),
    [reportFocus, setReportFocus] = useState(null),
    [chatId, setChatId] = useState(null),
    [aiDraft, setAiDraft] = useState(null),
    [chatRefs, setChatRefs] = useState(null),
    [monitorFocus, setMonitorFocus] = useState(null);
  const [feedbackContext, setFeedbackContext] = useState(null);
  const api = useMemo(() => makeApi("web", workspace), [workspace]);
  useCustomerActivity(api, page);
  function navigate(next) {
    if (next === "feedback" && page !== "feedback")
      setFeedbackContext(
        jobId
          ? { kind: "job", id: jobId, workspace_id: workspace }
          : page === "ai-testing" && aiDraft
            ? { kind: "ai_test", id: aiDraft, workspace_id: workspace }
            : reportFocus?.page === page
              ? { kind: "report", id: reportFocus.id, workspace_id: workspace }
              : { kind: "page", id: page },
      );
    setPage(next);
  }
  useEffect(() => {
    if (session.workspaces.some((w) => w.id === workspace)) return;
    setWorkspace(session.workspaces[0]?.id || "");
    setJobId(null);
    setReportFocus(null);
    setChatId(null);
    setAiDraft(null);
    setChatRefs(null);
    setMonitorFocus(null);
    setNewTask(null);
  }, [session.workspaces, workspace]);
  const reload = () => setVersion((v) => v + 1);
  const { data: catalog } = useLoad(api, "/api/catalog", version);
  const dataReady = catalog?.connections.some(
    (c) => c.kind === PLATFORMS[platform].provider && c.ready,
  );
  const modelReady = catalog?.connections.some(
    (c) => c.kind === "model" && c.ready,
  );
  async function logout() {
    await api("/api/auth/logout", {
      method: "POST",
      body: { audience: "web" },
    });
    refreshSession();
  }
  return (
    <Shell
      session={session}
      workspace={workspace}
      setWorkspace={(w) => {
        setWorkspace(w);
        setJobId(null);
        setReportFocus(null);
        setChatId(null);
        setAiDraft(null);
        setChatRefs(null);
        setMonitorFocus(null);
        setNewTask(null);
        reload();
      }}
      platformSelector={(closeNavigation) => (
        <Select
          variant="box"
          size="sm"
          ariaLabel="跨境电商平台"
          value={platform}
          onChange={(value) => {
            setPlatform(value);
            closeNavigation();
            setPage("scouting");
            setNewTask(null);
            setJobId(null);
            setReportFocus(null);
            setChatRefs(null);
          }}
          options={Object.entries(PLATFORMS).map(([value, p]) => ({
            value,
            title: p.label,
          }))}
        />
      )}
      nav={
        platform === "amazon"
          ? nav.filter((n) =>
              [
                "scouting",
                "opportunities",
                "ai-testing",
                "wallet",
                "team",
                "settings",
                "feedback",
              ].includes(n.key),
            )
          : nav
      }
      page={page}
      setPage={navigate}
      onLogout={logout}
      balance={
        workspace ? (
          <BalanceSummary
            key={workspace}
            api={api}
            space={session.workspaces.find((w) => w.id === workspace)}
            version={`${version}:${page}`}
            onOpen={() => setPage("wallet")}
          />
        ) : null
      }
    >
      {page === "feedback" ? (
        <FeedbackPage api={api} context={feedbackContext} />
      ) : !workspace ? (
        <Empty title="还没有工作空间">请联系平台管理员分配工作空间。</Empty>
      ) : (
        <>
          {page === "scouting" && (
            <>
              <PageTitle
                eyebrow="PRODUCT SCOUTING"
                title={`${PLATFORMS[platform].label} · 选品中心`}
                description="填写研究条件，Agent 按技能采集证据，形成可追溯的候选清单。"
              >
                <Button
                  onClick={() => setNewTask({ kind: "scouting", platform })}
                >
                  <Plus size={16} />
                  新建选品研究
                </Button>
              </PageTitle>
              <div className="connection-strip">
                <div className="connection-chips">
                  <span
                    className={"connection-chip" + (dataReady ? "" : " off")}
                  >
                    <i className={"status-dot " + (dataReady ? "" : "off")} />
                    {PLATFORMS[platform].label} 数据{" "}
                    {dataReady ? "已连接" : "待接入"}
                  </span>
                  <span
                    className={"connection-chip" + (modelReady ? "" : " off")}
                  >
                    <i className={"status-dot " + (modelReady ? "" : "off")} />
                    {catalog?.connections.find((c) => c.kind === "model")
                      ?.model || "模型"}{" "}
                    {modelReady ? "已连接" : "待接入"}
                  </span>
                </div>
                <span>先研究，再选入机会池</span>
                <button
                  className="icon-button"
                  aria-label="刷新"
                  onClick={reload}
                >
                  <RefreshCw size={15} />
                </button>
              </div>
              <Reports
                key={`${workspace}:${platform}`}
                platform={platform}
                api={api}
                workspace={workspace}
                version={version}
                onAssistant={platform === "tiktok" ? setChatRefs : null}
                onAiTesting={(id) => {
                  setAiDraft(id);
                  setPage("ai-testing");
                }}
                onViewMonitor={
                  platform === "amazon"
                    ? null
                    : (id) => {
                        setMonitorFocus({ id });
                        setPage("monitoring");
                      }
                }
                focusReport={
                  reportFocus?.page === "scouting" ? reportFocus : null
                }
              />
              <JobsList
                api={api}
                version={version}
                onOpen={setJobId}
                scope="scouting"
                platform={platform}
              />
            </>
          )}
          {page === "monitoring" && (
            <MonitoringPage
              focusMonitor={monitorFocus}
              onFocusHandled={() => setMonitorFocus(null)}
              key={workspace}
              api={api}
              workspace={workspace}
              catalog={catalog}
              version={version}
              reload={reload}
              onJob={setJobId}
              focusReport={
                reportFocus?.page === "monitoring" ? reportFocus : null
              }
              onResearch={(event) =>
                setNewTask({
                  kind: event.kind === "product" ? "competitor" : "diagnostics",
                  target: event.seller_id,
                  market: event.market,
                  question: `围绕竞店巡检事件核验原因与下一步：${event.data.title}。${event.data.body} 这是来源报告值，先核验窗口与口径，区分事实与推断。`,
                })
              }
            />
          )}
          {page === "opportunities" && (
            <OpportunityPage
              key={`${workspace}:${platform}`}
              platform={platform}
              api={api}
              version={version}
              reload={reload}
              onAssistant={platform === "tiktok" ? setChatRefs : null}
              onResearch={(r) =>
                setNewTask(
                  platform === "amazon"
                    ? {
                        kind: "scouting",
                        platform,
                        market: r.data.market,
                        target: `${r.data.title} ${r.data.product_id}`,
                      }
                    : { kind: "competitor", target: r.data.tk_url },
                )
              }
            />
          )}
          {page === "assistant" && (
            <AssistantPage
              key={workspace}
              api={api}
              catalog={catalog}
              workspace={workspace}
              selectedId={chatId}
              onSelect={setChatId}
            />
          )}
          {chatRefs && (
            <AssistantAttach
              key={workspace}
              api={api}
              refs={chatRefs}
              onClose={() => setChatRefs(null)}
              onDone={(cid) => {
                setChatId(cid);
                setChatRefs(null);
                setPage("assistant");
              }}
            />
          )}
          {page === "research" && (
            <>
              <PageTitle
                eyebrow="RESEARCH STUDIO"
                title="专项研究"
                description="围绕已发现的机会，进一步理解市场、内容与经营变化。"
              />
              <div className="research-grid">
                {[
                  [
                    "competitor",
                    "看清竞店如何增长",
                    "经营结构、商品贡献与内容节奏",
                  ],
                  [
                    "content",
                    "把带货内容拆成实验",
                    "视频结构、原创脚本与拍摄 brief",
                  ],
                  [
                    "reviews",
                    "把买家声音变成改进",
                    "评论证据、痛点、FAQ 与商品优化",
                  ],
                  ["ads", "研究竞品的投放路径", "广告素材、估算花费与归因边界"],
                  [
                    "diagnostics",
                    "查明经营变化的线索",
                    "比较周期、拆解变化与待验证原因",
                  ],
                ].map(([kind, title, desc], i) => (
                  <button
                    className="research-card"
                    key={kind}
                    onClick={() => setNewTask({ kind })}
                  >
                    <small>
                      0{i + 1} / {jobLabels[kind]}
                    </small>
                    <h2>{title}</h2>
                    <p>{desc}</p>
                    <ArrowUpRight size={23} />
                  </button>
                ))}
              </div>
              <Reports
                key={`${workspace}:specialist`}
                api={api}
                workspace={workspace}
                version={version}
                scope="specialist"
                onAssistant={setChatRefs}
                focusReport={
                  reportFocus?.page === "research" ? reportFocus : null
                }
              />
              <JobsList
                api={api}
                version={version}
                onOpen={setJobId}
                scope="specialist"
              />
            </>
          )}
          {page === "supply" && (
            <SupplyPage api={api} version={version} reload={reload} />
          )}
          {page === "economics" && (
            <EconomicsPage api={api} version={version} reload={reload} />
          )}
          {page === "experiments" && (
            <ExperimentsPage api={api} version={version} reload={reload} />
          )}
          {page === "wallet" && <WalletPage api={api} version={version} />}
          {page === "ai-testing" && (
            <AiTestingPage
              key={workspace}
              api={api}
              workspace={workspace}
              selectedId={aiDraft}
              onSelect={setAiDraft}
            />
          )}
          {page === "settings" && (
            <AccountSettings
              key={workspace}
              api={api}
              version={version}
              onChanged={async () => {
                await refreshSession();
                reload();
              }}
            />
          )}
          {page === "team" && (
            <TeamPage
              key={workspace}
              api={api}
              onChanged={async (wid) => {
                await refreshSession();
                if (wid) setWorkspace(wid);
                reload();
              }}
            />
          )}
          {newTask && (
            <NewTask
              api={api}
              catalog={catalog}
              initialKind={newTask.kind}
              initialPlatform={newTask.platform || "tiktok"}
              target={newTask.target || ""}
              initialMarket={newTask.market || "US"}
              question={newTask.question || ""}
              onClose={() => setNewTask(null)}
              onCreated={(j) => {
                setNewTask(null);
                setJobId(j.id);
                reload();
              }}
            />
          )}
          {jobId && (
            <JobDetail
              api={api}
              jobId={jobId}
              onClose={() => setJobId(null)}
              onRefresh={reload}
              onReportReady={(id, kind) => {
                setReportFocus({ id, page: reportPage(kind) });
                reload();
              }}
              onViewReport={(id, kind) => {
                setReportFocus({ id, page: reportPage(kind) });
                setJobId(null);
                setPage(reportPage(kind));
                reload();
              }}
            />
          )}
        </>
      )}
    </Shell>
  );
}
