import { BRAND_NAME, BRAND_TAGLINE } from "../../web/lib/brand.mjs";
import { publicReportHtml } from "../common/public-report.mjs";
import { amazonDailyChart, amazonDailySales } from "./amazon-daily.mjs";
import { SCOUTING_REPORT_CSS } from "./scouting-report-style.mjs";
import { scoutingReportSections } from "./scouting-report.mjs";
import {
  candidateAnalysis,
  testPlans,
  policyChecks,
} from "./scouting-analysis.mjs";
import {
  amazonFacts,
  amazonProductUrl,
  amazonCurrency,
} from "./amazon-scouting.mjs";
import { amazonSalesTrend } from "./amazon-trend.mjs";
import { reportBody } from "./specialist-report.mjs";
export const AMAZON_REPORT_VERSION = "amazon-editorial-v4";
export const amazonReportSections = scoutingReportSections;
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const text = (v) => esc(v).replaceAll("\n", "<br>");
const list = (values) =>
  values?.length
    ? `<ul>${values.map((v) => `<li>${text(v)}</li>`).join("")}</ul>`
    : "<p class=muted>暂无补充信息。</p>";
const number = (v) =>
  v == null
    ? "待核验"
    : Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
const date = (v) =>
  v && Number.isFinite(Date.parse(v))
    ? new Date(v)
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d{3}Z$/, " UTC")
    : "时间未记录";
const decisions = {
  shortlist: "优先研究",
  watch: "继续观察",
  reject: "暂不推进",
};
const pill = (c) =>
  `<span class="pill ${c.decision === "shortlist" ? "go" : c.decision === "reject" ? "stop" : "watch"}">${decisions[c.decision] || "待核验"}</span>`;
const labels = {
  asin: "ASIN",
  parent_asin: "父 ASIN",
  title: "商品名称",
  brand: "品牌",
  image_url: "商品图片",
  price: "售价",
  currency: "币种",
  estimated_units_30d: "月销量（估算）",
  estimated_revenue_30d: "月销售额（估算）",
  bsr: "BSR 排名",
  rating: "评分",
  rating_count: "评分数量",
  seller_count: "卖家数",
  sales_growth: "销量增长（来源值）",
  rating_count_growth: "评分数量增长（来源值）",
};
function trendChart(c, sources, reference) {
  const trend = amazonSalesTrend(c, sources);
  if (!trend)
    return '<div class="trend-pending"><span>历史月度销量 · 待补充</span><p>尚无匹配该站点与 ASIN 的月度序列，缺失值不补零。</p></div>';
  const prediction = trend.scope === "prediction";
  const points = trend.points.slice(-12),
    captureMonth = String(trend.captured_at || "").slice(0, 7);
  const plot = (key, title) => {
    const max = Math.max(1, ...points.map((p) => p[key] ?? 0));
    const width = 420,
      step = 350 / points.length;
    return `<section><h4>${title}</h4><svg viewBox="0 0 ${width} 174" role="img" aria-label="${title}，最近 ${points.length} 个月，估算件数"><text x="0" y="13">${number(max)} 件</text><line class="grid" x1="40" y1="24" x2="400" y2="24"/><line x1="40" y1="140" x2="400" y2="140"/>${points
      .map((p, i) => {
        const x = 43 + i * step,
          h = ((p[key] ?? 0) / max) * 108;
        return `${p[key] === null ? `<text x="${x + step / 2}" y="134" text-anchor="middle">—</text>` : `<rect class="daily-bar" x="${x}" y="${140 - h}" width="${Math.max(2, step - 7)}" height="${h}" opacity="${p.month >= captureMonth ? ".45" : "1"}"><title>${p.month}: ${number(p[key])} 件${p.month >= captureMonth ? "（未完月或未来月份，待核验）" : ""}</title></rect>`}${i === 0 || i === points.length - 1 || i % 3 === 0 ? `<text x="${x + step / 2}" y="159" text-anchor="middle">${esc(p.month)}</text>` : ""}`;
      })
      .join("")}</svg></section>`;
  };
  return `<figure class="trend-chart"><figcaption><span>历史月度销量趋势 · 单一来源估算</span>${reference(trend.invocation_id)}</figcaption><div class="trend-plots">${prediction ? plot("estimated", "请求 ASIN 月销量（估算）") : plot("parent", "父 ASIN 月销量") + plot("child", "当前子 ASIN 月销量")}</div><p>${prediction ? "按请求 ASIN 返回月度销量估算；来源未明确是否合并变体，不视为子体实际订单。" : "父子口径不可相加。"}— 表示缺失；浅色柱为采集时未完月或未来月份，不作完整月比较。展示最近 ${points.length} 个有月份记录的历史月，与本次研究回看期分开。</p><details class="trend-data"><summary>展开月度原始数值与来源</summary><div class="table-scroll"><table><thead><tr><th>月份</th>${prediction ? "<th>月销量估算（件）</th>" : "<th>父 ASIN（件）</th><th>子 ASIN（件）</th>"}<th>周期状态</th></tr></thead><tbody>${points.map((p) => `<tr><th>${p.month}</th>${prediction ? `<td>${number(p.estimated)}</td>` : `<td>${number(p.parent)}</td><td>${number(p.child)}</td>`}<td>${captureMonth && p.month < captureMonth ? "历史月" : "未完月 / 待核验"}</td></tr>`).join("")}</tbody></table></div><code>${esc(trend.pointer)}</code><p>采集：${esc(date(trend.captured_at))}</p></details></figure>`;
}
export function renderAmazonReport(result, meta) {
  const sources = meta.sources || new Map(),
    request = meta.request || {},
    candidates = result.candidates || [];
  // Reconstruct display facts from archives, not model-authored assessment values.
  const allFacts = amazonFacts(sources, request.market);
  const sections = amazonReportSections(result),
    sourceEntries = [...sources];
  const references = new Map(sourceEntries.map(([id], i) => [id, i + 1]));
  const reference = (id) =>
    references.has(id)
      ? `<a class="fact-ref" href="#source-${references.get(id)}" aria-label="来源 ${references.get(id)}">[${references.get(id)}]</a>`
      : "";
  const facts = (c) => allFacts.get(c.product_id) || {};
  const field = (c, key) => facts(c)[key];
  const cell = (c, label, key, format = number) =>
    `<div><dt>${label}</dt><dd>${field(c, key) ? esc(format(field(c, key).value)) + reference(field(c, key).invocation_id) : "待核验"}</dd></div>`;
  const money = (c, key) => {
    const f = field(c, key),
      currency = amazonCurrency(facts(c), request.market, key);
    return f ? `${number(f.value)} ${currency || "（币种待核验）"}` : "待核验";
  };
  const mini = (c) =>
    `<dl class="mini">${cell(c, "月销量（估算）", "estimated_units_30d")}${cell(c, "月销售额（估算）", "estimated_revenue_30d", () => money(c, "estimated_revenue_30d"))}${cell(c, "售价", "price", () => money(c, "price"))}${cell(c, "评分 / 5", "rating")}${cell(c, "评分数量（非文本评论数）", "rating_count")}${cell(c, "BSR 排名", "bsr")}${cell(c, "卖家数", "seller_count")}${cell(c, "品牌", "brand", String)}</dl><p class="fact-note">${request.market === "US" && !field(c, "currency") ? "美区商品未返回币种时，金额按 USD 展示。" : ""}月度估算保持来源周期，不折算为 ${esc(request.lookback_days || 30)} 天研究期销量。指标按已关联来源展示，不同接口快照的时间与数值可能不同；评分数量不等于本次读取的评论样本量。</p>`;
  const photo = (c) => {
    const src = meta.images?.get(c.product_id);
    return field(c, "image_url") &&
      typeof src === "string" &&
      src.length <= 1024 * 1024 &&
      /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(src)
      ? `<img src="${src}" alt="${esc(c.title)}" loading="lazy">`
      : '<div class="image-missing">图片待补充<small>未归档可用图片</small></div>';
  };
  const link = (c) =>
    field(c, "asin")
      ? `<a href="${esc(amazonProductUrl(request.market, c.product_id))}" target="_blank" rel="noopener noreferrer">Amazon 商品 ↗</a>`
      : '<span class="muted">商品身份待核验</span>';
  const identity = (c) =>
    `<div class="product-id">${esc(request.market)} · ASIN ${esc(c.product_id)}<br>父 ASIN ${esc(field(c, "parent_asin")?.value || "待核验")}</div>`;
  const evidence = (c) =>
    `<details class="evidence"><summary>查看分析依据与来源值 · ${Object.keys(facts(c)).length} 项</summary>${Object.entries(
      facts(c),
    )
      .map(
        ([key, f]) =>
          `<div class="evidence-item"><strong>${labels[key] || esc(key)}</strong>${reference(f.invocation_id)}<p>${text(f.value)}</p><small>采集：${esc(date(f.captured_at))}</small><code>${esc(f.pointer)}</code></div>`,
      )
      .join("")}${list(c.limitations)}</details>`;
  const heading = (id) =>
    `<div class="section-heading"><h2>${esc(sections.find((s) => s.id === id).title)}</h2><a class="back-top" href="#top">返回目录 ↑</a></div>`;
  const counts = Object.fromEntries(
    Object.keys(decisions).map((k) => [
      k,
      candidates.filter((c) => c.decision === k).length,
    ]),
  );
  const recommendation =
    Object.entries(counts)
      .filter(([, v]) => v)
      .map(([k, v]) => `${v} 个${decisions[k]}`)
      .join("，") || "暂无候选，需继续收集资料。";
  const metric = (label, value, note) =>
    `<div class="metric"><span>${label}</span><b>${esc(value)}</b><small>${esc(note)}</small></div>`;
  const original = (result.sections || [])
    .map(
      (s) =>
        `<h4>${esc(s.title)} <small>${{ observed: "来源观察", inferred: "分析推断", pending: "待核验" }[s.kind] || ""}</small></h4>${reportBody(s.body)}<p>${(s.evidence_ids || []).map(reference).join(" ") || '<span class="muted">无直接引用</span>'}</p>`,
    )
    .join("");
  const catalogs = sections
    .filter((s) => s.id.startsWith("catalog-"))
    .map(
      (s, page) =>
        `<section class="section catalog-page" id="${s.id}">${heading(s.id)}<p class="section-lead">保留研究顺序，序号不代表评分；同一父 ASIN 去重。</p><div class="catalog-grid">${
          candidates
            .slice(page * 12, page * 12 + 12)
            .map(
              (c, i) =>
                `<article class="catalog-card" id="candidate-${page * 12 + i + 1}"><div class="catalog-top"><span>NO. ${String(page * 12 + i + 1).padStart(2, "0")}</span>${pill(c)}</div><div class="catalog-head">${photo(c)}<div><h3>${esc(c.title)}</h3>${identity(c)}</div></div>${mini(c)}<h4>机会判断 · 模型分析</h4><p>${text(c.reason)}</p>${page * 12 + i < 5 ? `<div class="links">${link(c)}<a href="#deep-${page * 12 + i + 1}">查看深度证据 ↑</a></div>` : `<details><summary>展开完整商品分析</summary>${amazonDailyChart(c, sources, reference, request.lookback_days)}${trendChart(c, sources, reference)}${candidateAnalysis(c, sources, reference)}</details><div class="links">${link(c)}</div>`}${evidence(c)}</article>`,
            )
            .join("") || '<div class="panel">当前尚无候选商品。</div>'
        }</div></section>`,
    )
    .join("");
  return publicReportHtml(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="report-template" content="${AMAZON_REPORT_VERSION}"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${esc(meta.title || "亚马逊选品机会研究")}</title><style>${SCOUTING_REPORT_CSS}
.conclusion-brief{margin:0}.conclusion-brief>div{display:grid;grid-template-columns:3.5em minmax(0,1fr);gap:14px;padding:8px 0}.conclusion-brief dt{font-weight:600;color:#65796b}.conclusion-brief dd{margin:0;overflow-wrap:anywhere}.fact-note{color:#627368;font-size:12px;line-height:1.7;margin:8px 0 16px}.fact-ref{font-size:11px;font-weight:400;margin-left:6px;white-space:nowrap}.mini dd{overflow-wrap:anywhere}.trend-chart{margin-left:0;margin-right:0}.catalog-card .trend-plots{grid-template-columns:1fr}@media(max-width:640px){.deep-head{grid-template-columns:1fr}.deep-head h3{font-size:18px}.daily-sales svg text{font-size:26px}}
</style></head><body><header class="hero" id="top"><div class="hero-inner"><div class="eyebrow">${BRAND_NAME} / AMAZON PRODUCT SCOUTING · ${esc(request.market)}</div><h1>${esc(request.category || meta.title)}<span>${candidates.length} 品机会调研</span></h1><p>${esc(recommendation)}</p><div class="meta">${result.status === "complete" ? "研究完成" : "阶段结果"} · 回看 ${esc(request.lookback_days || 30)} 天 · 研究截点 ${esc(date(meta.as_of))}<br>报告生成 ${esc(date(meta.created_at))} · 技能版本 ${esc(meta.skill_version || "未记录")}</div>${meta.notice ? `<p class="hero-notice">${text(meta.notice)}</p>` : ""}</div></header><div class="wrap"><nav class="report-nav" aria-label="报告目录"><span>阅读目录</span>${sections.map((s, i) => `<a href="#${s.id}"><small>${String(i + 1).padStart(2, "0")}</small> ${esc(s.title)}</a>`).join("")}</nav><main>
<section class="section" id="overview"><h2 class="sr-only">候选概览</h2><div class="metrics">${metric("已收集商品", candidates.length, `目标 ${request.candidate_count ?? "未指定"} 个 · 未补齐不凑数`)}${metric("优先研究", counts.shortlist, "模型综合建议")}${metric("继续观察", counts.watch, "补充关键证据后再判断")}${metric("暂不推进", counts.reject, "保留淘汰依据")}${metric("来源已关联", `${candidates.filter((c) => field(c, "asin")).length}/${candidates.length}`, "事实可追溯，推断需验证")}</div></section>
<section class="section" id="conclusions">${heading("conclusions")}<div class="panel"><dl class="conclusion-brief"><div><dt>建议</dt><dd>${esc(recommendation)}</dd></div><div><dt>风险</dt><dd>销量与需求为单一来源估算；采购、FBA 与广告等缺失费用待核验。</dd></div><div><dt>下一步</dt><dd>${text(result.next_actions?.[0]?.title || "补充关键证据并按最小测试方案验证。")}</dd></div></dl><details><summary>展开完整分析</summary>${reportBody(result.summary)}${original}</details></div></section>
<section class="section panel warn" id="validation">${heading("validation")}<p>本报告关联 ${sourceEntries.length} 次归档调用。商品数据来自同一数据源；多个接口不构成独立交叉验证。政策网页按实际读取状态单独标注。</p><p>资料覆盖：图片 ${meta.images?.size || 0}/${candidates.length}；售价 ${candidates.filter((c) => field(c, "price")).length}/${candidates.length}；评分 ${candidates.filter((c) => field(c, "rating")).length}/${candidates.length}；每日销量序列 ${candidates.filter((c) => amazonDailySales(c, sources, request.lookback_days)?.coverage).length}/${candidates.length}；月度销量序列 ${candidates.filter((c) => amazonSalesTrend(c, sources)).length}/${candidates.length}。</p><p>快照保留原始采集时间；报告生成时间不代表行情更新时间。缺失值不补零，评论样本与总评分数量分开解释。</p>${Number.isInteger(request.candidate_count) && candidates.length < request.candidate_count ? `<p><strong>交付缺口：</strong>实际 ${candidates.length} / 目标 ${request.candidate_count} 个。</p>` : ""}</section>
<section class="section" id="deep-dives">${heading("deep-dives")}<p class="section-lead">按候选顺序展开机会分析、增长、竞争、评价与测试建议；父子 ASIN 月度估算分开展示。</p><div class="deep-list">${
    candidates
      .slice(0, 5)
      .map(
        (c, i) =>
          `<article class="deep-card" id="deep-${i + 1}"><div class="deep-head">${photo(c)}<div><div class="eyebrow">PRODUCT ${String(i + 1).padStart(2, "0")}</div><h3>${esc(c.title)}</h3>${identity(c)}${pill(c)}</div></div>${mini(c)}${amazonDailyChart(c, sources, reference, request.lookback_days)}${trendChart(c, sources, reference)}${candidateAnalysis(c, sources, reference)}<div class="links">${link(c)}<a href="#candidate-${i + 1}">定位候选卡片 ↓</a></div>${evidence(c)}</article>`,
      )
      .join("") || '<div class="panel">暂无可展开的商品，先完成候选采集。</div>'
  }</div></section>
<section class="section" id="methodology">${heading("methodology")}<div class="method"><article class="panel"><div class="eyebrow">RESEARCH SCOPE</div><h3>本次选品规则 · 用户输入</h3><p>${text(request.selection_rules || "按指定市场、品类与时间范围进行综合机会分析。")}</p><p>${text(request.notes || "")}</p><p>以站点 + ASIN 识别商品；同一父 ASIN 去重。研究建议不等于已通过备货验证。</p></article><article class="panel"><div class="eyebrow">UNIT ECONOMICS</div><h3>贡献利润 · 待核验</h3><div class="formula">实际售价 − 采购成本 − 头程物流 − 平台及 FBA 费用 − 广告 − 退货损耗 − 其他费用</div><p>未知费用逐项补充，不能静默填零。当前报告不以佣金率或估算销售额替代贡献利润。</p></article></div></section>
<section class="section" id="test-plan">${heading("test-plan")}${testPlans(result, sources, reference)}<div class="actions">${(result.next_actions || []).map((a) => `<p><strong>${esc(a.title)}</strong> · ${text(a.reason)}</p>`).join("")}</div></section>
<section class="section" id="policy">${heading("policy")}${policyChecks(result, sources, reference)}</section>${catalogs}
<section class="section" id="limits">${heading("limits")}<div class="panel">${list([...new Set(result.limitations || [])])}${result.questions?.length ? `<h3>待补充资料</h3>${list(result.questions)}` : ""}</div></section>
<section class="section" id="sources">${heading("sources")}<ol class="sources">${sourceEntries.map(([id, s], i) => `<li id="source-${i + 1}"><strong>[${i + 1}] ${esc(s.source || "来源未记录")} · ${esc(s.tool || "接口未记录")}</strong><p>采集：${esc(date(s.captured_at))}<br>本次读取：${esc(date(s.served_at || s.captured_at))} · ${s.cache_hit ? "复用历史快照" : "本次归档"}</p><code>${esc(id)}</code></li>`).join("") || "<li>尚未关联可核验来源。</li>"}</ol></section></main><footer>${BRAND_NAME} · ${BRAND_TAGLINE}<br> AMAZON PRODUCT SCOUTING · ${AMAZON_REPORT_VERSION} · 研究结论以本次归档证据为边界</footer></div></body></html>`);
}
