import { CandidateKeywords } from "./CandidateKeywords.jsx";
import { ImagePreview } from "../../components/ImagePreview.jsx";
import { CandidateOverview } from "./CandidateOverview.jsx";
import { MonitorShopButton } from "./MonitorShopButton.jsx";
import { useState, useEffect } from "react";
import {
  Package,
  Plus,
  Download,
  MessageSquare,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { useLoad } from "../../hooks/useLoad.mjs";
import {
  Button,
  Badge,
  Empty,
  ErrorBox,
  Loading,
} from "../../components/ui.jsx";
import { Dialog } from "../../components/Dialog.jsx";
import { Select } from "../../components/Select.jsx";
import { datetime } from "../../lib/format.mjs";
import { safeLink } from "../../lib/links.mjs";
import {
  orderedReports,
  nextReportSelection,
  recommendationLabel,
} from "./report-selection.mjs";

export function Reports({
  api,
  workspace,
  version,
  onAssistant,
  onAiTesting,
  onViewMonitor,
  focusReport,
  scope = "scouting",
  platform,
}) {
  const specialist = scope !== "scouting";
  const [monitorVersion, setMonitorVersion] = useState(0);
  const [pollVersion, setPollVersion] = useState(0);
  const { data, error } = useLoad(
    api,
    `/api/records?kind=report&research_scope=${scope}${platform ? `&platform=${platform}` : ""}`,
    `${version}:${pollVersion}`,
  );
  const [selection, setSelection] = useState({
      id: null,
      newestId: null,
      focus: null,
    }),
    [candidateResult, setCandidateResult] = useState(null),
    [mode, setMode] = useState("report"),
    [checked, setChecked] = useState([]),
    [filter, setFilter] = useState(""),
    [detail, setDetail] = useState(null),
    [overview, setOverview] = useState(null),
    [previewImage, setPreviewImage] = useState(null),
    [err, setErr] = useState(""),
    [notice, setNotice] = useState(""),
    [full, setFull] = useState(false);
  const { data: monitors } = useLoad(
    api,
    !specialist && mode === "candidates" ? "/api/monitors" : null,
    `${version}:${pollVersion}:${monitorVersion}`,
  );
  const monitorButton = (candidate) =>
    onViewMonitor && (
      <MonitorShopButton
        key={`${selected?.id}:${candidate.product_id}`}
        api={api}
        reportId={selected.id}
        candidate={candidate}
        monitors={monitors?.items}
        onView={onViewMonitor}
        onOverview={() => {
          setDetail(null);
          setOverview({ reportId: selected.id, candidate });
        }}
        onAdded={(result) => {
          setMonitorVersion((v) => v + 1);
          setNotice(
            result.reused
              ? `${result.name} 已在竞店监控中${result.status === "paused" ? "，保持暂停状态" : ""}。`
              : `${result.name} 已加入竞店监控，将按默认规则每日巡检。`,
          );
        }}
      />
    );
  const reports = orderedReports(data?.items || []);
  const selected = reports.find((row) => row.id === selection.id) || null;
  const items =
    candidateResult &&
    candidateResult.reportId === selected?.id &&
    candidateResult?.artifactId === selected?.data.candidates_artifact_id
      ? candidateResult.items
      : [];
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") setPollVersion((v) => v + 1);
    }, 10000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (data)
      setSelection((old) => nextReportSelection(data.items, old, focusReport));
  }, [data, focusReport]);
  useEffect(() => {
    if (focusReport) setMode("report");
  }, [focusReport]);
  useEffect(() => {
    let current = true;
    setCandidateResult(null);
    setChecked([]);
    setDetail(null);
    setOverview(null);
    setPreviewImage(null);
    setErr("");
    if (selected && !specialist)
      api(`/api/reports/${selected.id}/candidates`)
        .then((x) => {
          if (current)
            setCandidateResult({
              reportId: selected.id,
              artifactId: selected.data.candidates_artifact_id,
              items: x.items,
            });
        })
        .catch((e) => {
          if (current) setErr(e.message);
        });
    return () => {
      current = false;
    };
  }, [api, specialist, selected?.id, selected?.data.candidates_artifact_id]);
  useEffect(() => {
    if (!full) return;
    const esc = (e) => {
      if (e.key === "Escape") setFull(false);
    };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [full]);
  async function promote() {
    try {
      const r = await api(`/api/reports/${selected.id}/promote`, {
        method: "POST",
        body: { product_ids: checked },
      });
      setNotice(`已将 ${r.created} 个新商品加入机会池。`);
      setChecked([]);
    } catch (e) {
      setErr(e.message);
    }
  }
  async function importAi(productIds) {
    setErr("");
    try {
      const result = await api("/api/ai-tests/import", {
        method: "POST",
        body: {
          items: productIds.map((product_id) => ({
            report_id: selected.id,
            product_id,
          })),
        },
      });
      onAiTesting(result.items.length === 1 ? result.items[0].id : null);
    } catch (e) {
      setErr(e.message);
    }
  }
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  if (!data.items.length)
    return (
      <Empty title={scope === "monitoring" ? "暂无巡检报告" : "从一份研究开始"}>
        {scope === "monitoring"
          ? "巡检完成后可在这里查看事实、解读和原始证据。"
          : specialist
            ? "选择上方研究方向，完成后在这里查看专项报告。"
            : "填写研究条件，创建第一份选品任务。完成后即可在这里查看候选商品与报告。"}
      </Empty>
    );
  const visible = items.filter((c) =>
    (c.title + " " + c.product_id).includes(filter),
  );
  return (
    <section className="report-center">
      <div className="section-line">
        <Select
          ariaLabel="选择报告"
          value={selected?.id || ""}
          onChange={(id) => setSelection((old) => ({ ...old, id }))}
          options={reports.map((r) => ({
            value: r.id,
            title: r.data.title,
            hint:
              (r.data.source_kind === "user_provided_historical_report"
                ? "用户历史资料"
                : "Agent 研究") +
              " · " +
              datetime(r.data.captured_at) +
              (specialist ? "" : " · " + r.data.candidate_count + " 个候选"),
          }))}
        />
        {!specialist && (
          <div className="segmented">
            <button
              className={mode === "candidates" ? "active" : ""}
              onClick={() => setMode("candidates")}
            >
              候选商品
            </button>
            <button
              className={mode === "report" ? "active" : ""}
              onClick={() => setMode("report")}
            >
              完整报告
            </button>
          </div>
        )}
      </div>
      {selected && (
        <>
          <p className="source-note">
            {selected.data.source_kind === "user_provided_historical_report"
              ? "用户历史资料"
              : "Agent 研究"}{" "}
            · {datetime(selected.data.captured_at)} ·{" "}
            {!specialist && <>{selected.data.candidate_count} 个候选 · </>}
            {selected.data.sections?.length} 个章节
          </p>
          {selected.data.notice && (
            <div className="notice">{selected.data.notice}</div>
          )}
          <ErrorBox error={err} />
          {notice && (
            <p className="success" role="status">
              {notice}
            </p>
          )}
          {specialist || mode === "report" ? (
            <>
              <div className="section-line">
                <span>
                  {selected.data.source_kind ===
                  "user_provided_historical_report"
                    ? "历史报告完整展示，保留原始口径。"
                    : specialist
                      ? "查看本次专项研究的结论、证据与建议。"
                      : "先阅读研究结论，再切换候选商品加入机会池或继续追问。"}
                </span>
                <div className="actions">
                  <a
                    className="button secondary"
                    href={`/api/artifacts/${selected.data.artifact_id}?workspace=${workspace}&download=1`}
                  >
                    <Download size={16} />
                    下载 HTML
                  </a>
                  <Button secondary onClick={() => setFull(true)}>
                    <Maximize2 size={16} />
                    全屏查看
                  </Button>
                </div>
              </div>
              <iframe
                className="report-frame"
                title={specialist ? "完整专项研究报告" : "完整选品研究报告"}
                sandbox=""
                src={`/api/artifacts/${selected.data.artifact_id}?workspace=${workspace}`}
              />
            </>
          ) : (
            <>
              <div className="table-toolbar">
                <input
                  placeholder="搜索商品名称或 ID"
                  aria-label="搜索候选商品"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
                <span>{visible.length} 个商品</span>
                {onAiTesting && (
                  <Button
                    secondary
                    disabled={!checked.length || checked.length > 100}
                    onClick={() => importAi(checked)}
                  >
                    添加到 AI 测品
                    {checked.length ? `（${checked.length}）` : ""}
                  </Button>
                )}
                {onAssistant && (
                  <Button
                    secondary
                    disabled={!checked.length || checked.length > 10}
                    onClick={() =>
                      onAssistant(
                        checked.map((product_id) => ({
                          kind: "candidate",
                          report_id: selected.id,
                          product_id,
                        })),
                      )
                    }
                  >
                    <MessageSquare size={16} />
                    添加到助手{checked.length ? `（${checked.length}）` : ""}
                  </Button>
                )}
                <Button disabled={!checked.length} onClick={promote}>
                  <Plus size={16} />
                  加入机会池{checked.length ? `（${checked.length}）` : ""}
                </Button>
              </div>
              {onViewMonitor && (
                <p className="muted">
                  点击“数据总览”查看商品与所属店铺详情，首次补充数据按实际调用扣除积分；“监控店铺”可启用每日巡检。
                </p>
              )}
              <p className="muted">
                热词优先使用已有关键词；缺少时自动调用 AI
                生成建议，按实际模型用量计费，已生成结果不重复计费。
              </p>
              <div className="table-frame">
                <table>
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          aria-label="选择当前全部商品"
                          checked={
                            visible.length > 0 &&
                            visible.every((c) => checked.includes(c.product_id))
                          }
                          onChange={(e) =>
                            setChecked(
                              e.target.checked
                                ? visible.map((c) => c.product_id)
                                : [],
                            )
                          }
                        />
                      </th>
                      <th>商品与来源</th>
                      <th>
                        {platform === "amazon" ? "月销量（估算）" : "7 日销量"}
                      </th>
                      <th>评分</th>
                      <th>售价</th>
                      <th>热词</th>
                      <th>研究建议</th>
                      <th>下一步</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((c, i) => (
                      <tr key={c.product_id}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={"选择 " + c.title}
                            checked={checked.includes(c.product_id)}
                            onChange={(e) =>
                              setChecked(
                                e.target.checked
                                  ? [...checked, c.product_id]
                                  : checked.filter((x) => x !== c.product_id),
                              )
                            }
                          />
                        </td>
                        <td>
                          <div className="product-cell">
                            {c.image &&
                            /^(data:image\/(png|jpeg|webp);base64,|https:\/\/)/.test(
                              c.image,
                            ) ? (
                              <button
                                type="button"
                                className="product-image-button"
                                aria-label={`放大图片：${c.title}`}
                                title="点击放大图片"
                                onClick={() =>
                                  setPreviewImage({
                                    src: c.image,
                                    title: c.title,
                                    reportId: selected.id,
                                  })
                                }
                              >
                                <img src={c.image} alt="" loading="lazy" />
                              </button>
                            ) : (
                              <div className="product-placeholder">
                                <Package size={22} />
                              </div>
                            )}
                            <div>
                              <a
                                href={safeLink(c.product_url || c.tk_url)}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {c.title}
                              </a>
                              <small>{c.product_id}</small>
                              {c.discrepancies?.map((x) => (
                                <small className="conflict" key={x}>
                                  {x}
                                </small>
                              ))}
                            </div>
                          </div>
                        </td>
                        <td>
                          {(platform === "amazon"
                            ? c.assessment?.facts?.estimated_units_30d?.value
                            : (c.assessment?.facts?.last_7d_units_sold?.value ??
                              c.units7)) ?? "待核验"}
                          <small>
                            {platform === "amazon"
                              ? "来源月度估算"
                              : "销量口径"}
                          </small>
                        </td>
                        <td>{c.rating ?? "—"}</td>
                        <td>
                          {c.price != null
                            ? `${c.price_currency || (c.source_kind === "historical_report" ? "USD" : "币种待核验")} ${c.price}`
                            : "—"}
                        </td>
                        <td>
                          <CandidateKeywords
                            key={`${workspace}:${selected.id}:${selected.data.candidates_artifact_id}:${c.product_id}`}
                            api={api}
                            reportId={selected.id}
                            productId={c.product_id}
                          />
                        </td>
                        <td>
                          <Badge
                            value={
                              c.decision === "shortlist"
                                ? "passed"
                                : c.decision === "reject"
                                  ? "failed"
                                  : "unverified"
                            }
                            label={recommendationLabel(c)}
                          />
                          <small>
                            {["user_rules", "amazon_research"].includes(
                              c.assessment?.mode,
                            )
                              ? "模型综合建议"
                              : "历史研究建议"}
                          </small>
                        </td>
                        <td>
                          <span className="muted">
                            {c.reason?.slice(0, 65) || "评估后移入机会池"}
                          </span>
                          <button
                            className="text-button"
                            onClick={() => setDetail(c)}
                          >
                            查看依据
                          </button>
                          {monitorButton(c)}
                          {onAiTesting && (
                            <button
                              className="text-button"
                              onClick={() => importAi([c.product_id])}
                            >
                              添加到 AI 测品
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
      {full && selected && (
        <div
          className="report-fullscreen"
          role="dialog"
          aria-modal="true"
          aria-label="全屏查看报告"
        >
          <header>
            <span className="report-fullscreen-title">
              {selected.data.title}
            </span>
            <div className="actions">
              <small className="muted">Esc 退出</small>
              <a
                className="button secondary"
                href={`/api/artifacts/${selected.data.artifact_id}?workspace=${workspace}&download=1`}
              >
                <Download size={16} />
                下载 HTML
              </a>
              <Button secondary onClick={() => setFull(false)}>
                <Minimize2 size={16} />
                退出全屏
              </Button>
            </div>
          </header>
          <iframe
            title={specialist ? "完整专项研究报告" : "完整选品研究报告"}
            sandbox=""
            src={`/api/artifacts/${selected.data.artifact_id}?workspace=${workspace}`}
          />
        </div>
      )}
      {previewImage && previewImage.reportId === selected?.id && (
        <ImagePreview
          key={`${workspace}:${previewImage.reportId}:${previewImage.src}`}
          src={previewImage.src}
          title={previewImage.title}
          onClose={() => setPreviewImage(null)}
        />
      )}
      {overview && overview.reportId === selected?.id && (
        <CandidateOverview
          key={`${workspace}:${overview.reportId}:${overview.candidate.product_id}`}
          api={api}
          reportId={overview.reportId}
          candidate={overview.candidate}
          onClose={() => setOverview(null)}
        />
      )}
      {detail && (
        <Dialog title={detail.title} onClose={() => setDetail(null)} wide>
          {monitorButton(detail)}
          <p>
            {detail.reason ||
              "该商品来自用户提供的历史选品报告，详情请查看完整报告。"}
          </p>
          <p>
            {detail.assessment?.mode === "user_rules"
              ? "模型综合建议"
              : "历史研究建议"}
            ：{recommendationLabel(detail)}
          </p>
          {detail.evidence?.length ? (
            <div className="table-frame">
              <table>
                <thead>
                  <tr>
                    <th>指标</th>
                    <th>原始值</th>
                    <th>单位与时间</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.evidence.map((e, i) => (
                    <tr key={i}>
                      <td>{e.metric}</td>
                      <td>
                        {typeof e.value === "object"
                          ? JSON.stringify(e.value)
                          : String(e.value)}
                      </td>
                      <td>
                        {e.unit}
                        <small>
                          {e.period_start || "起始时间待确认"} —{" "}
                          {e.period_end || "结束时间待确认"}
                        </small>
                        <small>{e.timezone || "时区待确认"}</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">
              逐项接口证据未附于这份候选清单；以完整报告的来源说明为准。
            </p>
          )}
          {detail.limitations?.length > 0 && (
            <div className="notice">
              {detail.limitations.map((x, i) => (
                <p key={i}>{x}</p>
              ))}
            </div>
          )}
          {detail.discrepancies?.map((x) => (
            <p className="conflict" key={x}>
              {x}
            </p>
          ))}
        </Dialog>
      )}
    </section>
  );
}
