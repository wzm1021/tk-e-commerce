import { BRAND_NAME, BRAND_TAGLINE } from "../../web/lib/brand.mjs";
import { SCOUTING_REPORT_CSS as CSS } from "./scouting-report-style.mjs";
import {
  candidateAnalysis,
  testPlans,
  policyChecks,
} from "./scouting-analysis.mjs";
import { usesSelectionRules } from "./scouting-policy.mjs";
import { digest } from "../common/core.mjs";
import { publicReportHtml } from "../common/public-report.mjs";

export const SCOUTING_REPORT_VERSION = "scouting-editorial-v8";
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
const text = (value) => esc(value).replaceAll("\n", "<br>");
// Keep complete sentences: cutting a long claim can drop its qualification.
const brief = (value, fallback) => {
  const sentence = String(value || "")
    .trim()
    .match(/^[^。！？\n]+[。！？]?/)?.[0];
  return sentence && sentence.length <= 80 ? sentence : fallback;
};
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const number = (value) =>
  finite(value)
    ? value.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : "待核验";
const state = { passed: "通过", failed: "未通过", unverified: "待核验" };
const decision = {
  shortlist: "可入池研究",
  watch: "补证后再判断",
  reject: "暂不推进",
};
const time = (value) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value)
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d{3}Z$/, " UTC")
    : "时间未记录";
const list = (items) =>
  items.length
    ? `<ul>${items.map((item) => `<li>${text(item)}</li>`).join("")}</ul>`
    : "<p class=muted>暂无补充信息。</p>";
const pill = (status, label) =>
  `<span class="pill ${status === "passed" || status === "shortlist" ? "go" : status === "failed" || status === "reject" ? "stop" : "watch"}">${esc(label)}</span>`;

export function scoutingReportSections(result) {
  const count = result.candidates.length,
    pages = Math.max(1, Math.ceil(count / 12));
  return [
    { id: "overview", title: "候选概览" },
    { id: "conclusions", title: "先给结论" },
    { id: "validation", title: "交叉验证状态" },
    { id: "deep-dives", title: `前 ${Math.min(count, 5)} 个商品深度证据` },
    { id: "methodology", title: "筛选方法与利润口径" },
    { id: "test-plan", title: "最小测试方案" },
    { id: "policy", title: "政策与宣称检查" },
    ...Array.from({ length: pages }, (_, i) => ({
      id: `catalog-${i + 1}`,
      title: `${count} 品候选清单 · ${i + 1}/${pages}`,
    })),
    { id: "limits", title: "数据限制与证据边界" },
    { id: "sources", title: "数据源与时间" },
  ];
}

// The server passes the job's verified envelopes. Never embed raw provider HTML,
// remote resources, or a model-generated image that is absent from its evidence.
function citedValue(evidence, sources) {
  const source = sources.get(evidence.invocation_id);
  if (!source || typeof evidence.pointer !== "string") return undefined;
  if (evidence.pointer !== "" && !evidence.pointer.startsWith("/"))
    return undefined;
  const keys =
    evidence.pointer === ""
      ? []
      : evidence.pointer
          .slice(1)
          .split("/")
          .map((key) => key.replaceAll("~1", "/").replaceAll("~0", "~"));
  let value = source;
  for (const key of keys)
    value =
      value && typeof value === "object" && Object.hasOwn(value, key)
        ? value[key]
        : undefined;
  return value !== undefined && digest(value) === digest(evidence.value)
    ? value
    : undefined;
}
function productLink(candidate) {
  try {
    const url = new URL(candidate.tk_url);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (url.hostname === "tiktok.com" || url.hostname.endsWith(".tiktok.com"))
      ? url.href
      : null;
  } catch {
    return null;
  }
}
function valueText(value) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  if (/^data:image\//.test(serialized || "")) return "已归档的商品图片";
  return serialized?.length > 1800
    ? serialized.slice(0, 1800) + "…（长值节选，完整数据保留在原始证据中）"
    : (serialized ?? "待核验");
}

function isoDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return null;
  const milliseconds = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString().slice(0, 10) === value
    ? { value, milliseconds }
    : null;
}

export function scoutingSalesTrend(candidate, sources) {
  const matches = [];
  for (const [invocationId, envelope] of sources) {
    if (
      envelope.source !== "FastMoss" ||
      envelope.tool !== "product_sales_trend" ||
      String(envelope.request?.filter?.product_id ?? "") !==
        String(candidate.product_id)
    )
      continue;
    for (const [decodedIndex, decoded] of (envelope.decoded || []).entries()) {
      const responseProductId =
        decoded.data?.product_id ?? decoded.data?.product?.product_id;
      if (
        responseProductId != null &&
        String(responseProductId) !== String(candidate.product_id)
      )
        continue;
      if (!Array.isArray(decoded.data?.daily_trend)) continue;
      const days = new Map();
      let invalidCount = 0;
      for (const [rowIndex, row] of decoded.data.daily_trend.entries()) {
        const date = isoDay(row?.date);
        if (
          !date ||
          !finite(row?.daily_units_sold) ||
          row.daily_units_sold < 0
        ) {
          invalidCount++;
          continue;
        }
        days.set(date.value, {
          date: date.value,
          milliseconds: date.milliseconds,
          daily: row.daily_units_sold,
          pointer: `/decoded/${decodedIndex}/data/daily_trend/${rowIndex}/daily_units_sold`,
        });
      }
      const observed = [...days.values()].sort(
        (a, b) => a.milliseconds - b.milliseconds,
      );
      if (!observed.length) continue;
      let cumulative = 0;
      const points = observed.map((day) => ({
        ...day,
        cumulative: (cumulative += day.daily),
      }));
      const calendarDays =
        Math.round(
          (points.at(-1).milliseconds - points[0].milliseconds) / 86400000,
        ) + 1;
      matches.push({
        invocation_id: invocationId,
        captured_at: envelope.captured_at || "",
        points,
        missing_days: Math.max(0, calendarDays - points.length),
        invalid_count: invalidCount,
      });
    }
  }
  return matches.sort(
    (a, b) =>
      String(b.captured_at).localeCompare(String(a.captured_at)) ||
      b.points.length - a.points.length,
  )[0];
}

function trendChart(candidate, sources, reference) {
  const trend = scoutingSalesTrend(candidate, sources);
  if (!trend)
    return `<div class="trend-pending"><span>每日销量与每日累计销量 / 待补数据</span><p>本次归档来源中没有该商品的逐日销量序列，未绘制推测曲线。</p></div>`;
  const width = 520,
    height = 184,
    left = 42,
    right = 14,
    top = 18,
    bottom = 31,
    plotWidth = width - left - right,
    plotHeight = height - top - bottom,
    first = trend.points[0],
    last = trend.points.at(-1),
    dateSpan = Math.max(1, last.milliseconds - first.milliseconds),
    x = (point) =>
      trend.points.length === 1
        ? left + plotWidth / 2
        : left +
          ((point.milliseconds - first.milliseconds) / dateSpan) * plotWidth,
    y = (value, maximum) =>
      top + plotHeight - (value / Math.max(1, maximum)) * plotHeight,
    dailyMax = Math.max(1, ...trend.points.map((point) => point.daily)),
    cumulativeMax = Math.max(1, last.cumulative),
    calendarDays =
      Math.round((last.milliseconds - first.milliseconds) / 86400000) + 1,
    barWidth = Math.max(3, Math.min(18, (plotWidth / calendarDays) * 0.64)),
    axis = (maximum) =>
      `<line x1="${left}" y1="${top}" x2="${left}" y2="${top + plotHeight}"/><line x1="${left}" y1="${top + plotHeight}" x2="${left + plotWidth}" y2="${top + plotHeight}"/><line class="grid" x1="${left}" y1="${top + plotHeight / 2}" x2="${left + plotWidth}" y2="${top + plotHeight / 2}"/><text x="4" y="${top + 4}">${esc(number(maximum))}</text><text x="20" y="${top + plotHeight + 4}">0</text><text x="${left}" y="${height - 7}">${esc(first.date.slice(5))}</text><text x="${left + plotWidth}" y="${height - 7}" text-anchor="end">${esc(last.date.slice(5))}</text>`,
    segments = [];
  let segment = [];
  for (const point of trend.points) {
    if (
      segment.length &&
      point.milliseconds - segment.at(-1).milliseconds !== 86400000
    ) {
      segments.push(segment);
      segment = [];
    }
    segment.push(point);
  }
  if (segment.length) segments.push(segment);
  const cumulativeLines = segments
    .filter((items) => items.length > 1)
    .map(
      (items) =>
        `<polyline points="${items
          .map(
            (point) =>
              `${x(point).toFixed(1)},${y(point.cumulative, cumulativeMax).toFixed(1)}`,
          )
          .join(" ")}"/>`,
    )
    .join("");
  const area =
    trend.missing_days === 0 && trend.points.length > 1
      ? `<polygon points="${left},${top + plotHeight} ${trend.points
          .map(
            (point) =>
              `${x(point).toFixed(1)},${y(point.cumulative, cumulativeMax).toFixed(1)}`,
          )
          .join(" ")} ${left + plotWidth},${top + plotHeight}"/>`
      : "";
  const notes = [
    `${trend.points.length} 个观测日`,
    trend.missing_days
      ? `区间缺 ${trend.missing_days} 个自然日，图中留空且未补零`
      : "日期连续",
    trend.invalid_count ? `忽略 ${trend.invalid_count} 条无效记录` : null,
  ].filter(Boolean);
  return `<figure class="trend-chart"><figcaption><span>销量趋势</span><strong>${esc(number(last.cumulative))} 件观测累计</strong></figcaption><div class="trend-plots"><section><h4><span>每日销量</span><strong>最近 ${esc(number(last.daily))} 件</strong></h4><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(candidate.title)}：${first.date} 至 ${last.date} 的每日销量"><title>${esc(candidate.title)}每日销量</title>${axis(dailyMax)}${trend.points.map((point) => `<rect class="daily-bar" x="${(x(point) - barWidth / 2).toFixed(1)}" y="${y(point.daily, dailyMax).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(1, top + plotHeight - y(point.daily, dailyMax)).toFixed(1)}" rx="2"><title>${esc(point.date)}：${esc(number(point.daily))} 件</title></rect>`).join("")}</svg></section><section><h4><span>每日累计销量</span><strong>${esc(number(last.cumulative))} 件</strong></h4><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(candidate.title)}：${first.date} 至 ${last.date} 的每日累计销量"><title>${esc(candidate.title)}每日累计销量</title>${axis(cumulativeMax)}${area}${cumulativeLines}${trend.points.map((point) => `<circle cx="${x(point).toFixed(1)}" cy="${y(point.cumulative, cumulativeMax).toFixed(1)}" r="3"><title>${esc(point.date)}：当日 ${esc(number(point.daily))} 件，窗口累计 ${esc(number(point.cumulative))} 件</title></circle>`).join("")}</svg></section></div><p>${esc(notes.join(" · "))} · 累计值从观察窗首个有效日期开始 ${reference(trend.invocation_id)}</p><details class="trend-data"><summary>查看每日销量明细</summary><div class="table-scroll" tabindex="0" role="region" aria-label="每日销量明细"><table><thead><tr><th>日期</th><th>当日销量</th><th>窗口累计销量</th></tr></thead><tbody>${trend.points.map((point) => `<tr><td>${esc(point.date)}</td><td>${esc(number(point.daily))}</td><td>${esc(number(point.cumulative))}</td></tr>`).join("")}</tbody></table></div></details></figure>`;
}

export function renderScoutingReport(result, meta = {}) {
  const candidates = result.candidates,
    request = meta.request || {},
    sources = meta.sources instanceof Map ? meta.sources : new Map();
  const guided =
    usesSelectionRules(request) || result.analysis_mode === "user_rules";
  const decisionLabels = guided
    ? { shortlist: "优先研究", watch: "继续观察", reject: "暂不推进" }
    : decision;
  const sections = scoutingReportSections(result);
  const sourceIds = new Map([...sources.keys()].map((key, i) => [key, i + 1]));
  const reference = (id) =>
    sourceIds.has(id)
      ? `<a href="#source-${sourceIds.get(id)}">[${sourceIds.get(id)}]</a>`
      : "<span class=muted>来源待关联</span>";
  const validEvidence = (c) =>
    (c.evidence || []).filter((ev) => citedValue(ev, sources) !== undefined);
  const fact = (c, key) => {
    const value = c.assessment?.facts?.[key];
    return value && citedValue(value, sources) !== undefined
      ? value
      : undefined;
  };
  const photoBudget = { remaining: 12_000_000 };
  const images = new Map();
  for (const c of candidates) {
    const archived =
      meta.images instanceof Map ? meta.images.get(c.product_id) : undefined;
    if (
      typeof archived === "string" &&
      archived.length <= 1_000_000 &&
      /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(
        archived,
      ) &&
      photoBudget.remaining >= archived.length * 2
    ) {
      images.set(c.product_id, archived);
      photoBudget.remaining -= archived.length * 2;
      continue;
    }
    if (
      typeof c.image === "string" &&
      c.image.length <= 300000 &&
      /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(
        c.image,
      ) &&
      validEvidence(c).some((ev) => ev.value === c.image) &&
      photoBudget.remaining >= c.image.length * 2
    ) {
      images.set(c.product_id, c.image);
      photoBudget.remaining -= c.image.length * 2;
    }
  }
  const photo = (c) =>
    images.has(c.product_id)
      ? `<img src="${images.get(c.product_id)}" alt="${esc(c.title)}" loading="lazy" width="112" height="112">`
      : `<div class="image-missing" role="img" aria-label="${esc(c.title)}：暂无已归档图片"><span>商品图片</span><small>待补充</small></div>`;
  const rating = (c) => {
    const v = fact(c, "product_rating")?.value;
    return finite(v) && v >= 0 && v <= 5 ? number(v) : "待核验";
  };
  const price = (c) => {
    const v = fact(c, "floor_price")?.value,
      ceiling = fact(c, "ceiling_price")?.value,
      currency = fact(c, "currency_code")?.value;
    return finite(v) && v >= 0
      ? `${typeof currency === "string" ? currency : "币种待核验"} ${number(v)}${finite(ceiling) && ceiling > v ? ` – ${number(ceiling)}` : ""}`
      : "待核验";
  };
  const launch = (c) => {
    const v = fact(c, "launch_time")?.value;
    return Number.isSafeInteger(v) && v > 0 && v * 1000 <= 8640000000000000
      ? new Date(v * 1000).toISOString().slice(0, 10)
      : "待核验";
  };
  const count = (c, key, unit = "件") => {
    const value = fact(c, key)?.value;
    return finite(value) && value >= 0 ? `${number(value)} ${unit}` : "待核验";
  };
  const money = (c, key) => {
    const value = fact(c, key),
      currency = fact(c, "currency_code");
    // A currency from a different snapshot may describe a different market.
    return finite(value?.value) && value.value >= 0
      ? `${currency?.invocation_id === value.invocation_id ? currency.value : "币种待核验"} ${number(value.value)}`
      : "待核验";
  };
  const metricCell = (c, label, value, keys) => {
    const refs = [
      ...new Set(
        keys.map((key) => fact(c, key)?.invocation_id).filter(Boolean),
      ),
    ];
    return `<div><dt>${esc(label)}</dt><dd>${esc(value)}${value !== "待核验" ? `<small class="fact-ref">${refs.map(reference).join(" ")}</small>` : ""}</dd></div>`;
  };
  const mini = (c) => {
    const fields = [
      ["来源评分 / 5", rating(c), ["product_rating"]],
      [
        "售价区间 · 快照",
        price(c),
        ["floor_price", "ceiling_price", "currency_code"],
      ],
      ["近 7 天销量", count(c, "last_7d_units_sold"), ["last_7d_units_sold"]],
      [
        "近 28 天销量",
        count(c, "last_28d_units_sold"),
        ["last_28d_units_sold"],
      ],
      ["商品累计销量", count(c, "total_units_sold"), ["total_units_sold"]],
      ["商品累计 GMV", money(c, "total_gmv"), ["total_gmv"]],
      ["上架日期 · UTC", launch(c), ["launch_time"]],
      ["贡献利润率", "待核验", []],
    ];
    const snapshots = [
      ...new Set(
        Object.keys(c.assessment?.facts || {})
          .map((key) => fact(c, key)?.invocation_id)
          .filter(Boolean),
      ),
    ];
    return `<dl class="mini">${fields.map(([label, value, keys]) => metricCell(c, label, value, keys)).join("")}</dl><p class="fact-note">快照采集：${snapshots.map((id) => `${esc(time(sources.get(id)?.captured_at))} ${reference(id)}`).join("；") || "未记录"}。售价和评分为采集时的来源值；价格保留商品原币种，近 7／28 天为来源滚动周期。</p>${extraFacts(c)}`;
  };
  const extraFacts = (c) => {
    const fields = [
      ["店铺", "shop_name"],
      ["商品类目", "category_name"],
      ["市场", "region"],
      ["评价数", "review_count", "条"],
      ["SKU 数", "sku_count", "个"],
      ["库存", "stock_count", "件"],
      ["佣金率（非利润率）", "commission_rate_percent", "%"],
      ["关联达人", "linked_creator_count", "位"],
      ["关联视频", "linked_video_count", "条"],
      ["关联直播", "linked_live_count", "场"],
      ["包邮", "is_free_shipping"],
      ["跨境商品标记", "is_cross_border"],
      ["昨日销量", "yesterday_units_sold", "件"],
      ["近 90 天销量", "last_90d_units_sold", "件"],
      ["近 7 天 GMV", "last_7d_gmv", "money"],
      ["近 28 天 GMV", "last_28d_gmv", "money"],
    ].filter(([, key]) => fact(c, key));
    if (!fields.length) return "";
    return `<details class="product-facts"><summary>更多商品资料 · ${fields.length} 项</summary><dl class="mini">${fields
      .map(([label, key, unit]) => {
        const value = fact(c, key).value;
        const display =
          unit === "money"
            ? money(c, key)
            : unit
              ? count(c, key, unit)
              : typeof value === "boolean"
                ? value
                  ? "是"
                  : "否"
                : value;
        return metricCell(c, label, display, [key]);
      })
      .join("")}</dl></details>`;
  };
  const link = (c) =>
    productLink(c)
      ? `<a href="${esc(productLink(c))}" target="_blank" rel="noopener noreferrer">TikTok 商品 ↗</a>`
      : "<span class=muted>商品链接待核验</span>";
  const strategy = (c) =>
    guided
      ? ""
      : ["A", "B"]
          .map(
            (key) =>
              `${pill(c[`strategy_${key.toLowerCase()}`], `${key} · ${state[c[`strategy_${key.toLowerCase()}`]] || "待核验"}`)}${request.strategies && !request.strategies.includes(key) ? "<small class=muted>未启用</small>" : ""}`,
          )
          .join(" ");
  const criteria = (c) =>
    ["A", "B"]
      .map((key) => {
        const rule = c.assessment?.[key];
        return `<div class="criterion"><h4>${key} · ${key === "A" ? "市场机会" : "新竞品机会"}</h4>${rule?.criteria?.length ? `<ul>${rule.criteria.map((item) => `<li>${pill(item.status, state[item.status] || "待核验")} <strong>${esc(item.label)}</strong><br>${text(item.reason)} ${item.evidence ? reference(item.evidence.invocation_id) : ""}</li>`).join("")}</ul>` : "<p>尚无逐项核验记录；请补充对应条件的证据。</p>"}</div>`;
      })
      .join("");
  const evidence = (c) => {
    const items = validEvidence(c);
    const hasInvalidEvidence = items.length !== (c.evidence || []).length;
    for (const key of Object.keys(c.assessment?.facts || {})) {
      const value = fact(c, key);
      if (
        value &&
        !items.some(
          (ev) =>
            ev.invocation_id === value.invocation_id &&
            ev.pointer === value.pointer,
        )
      )
        items.push({ ...value, metric: key, unit: "来源字段" });
    }
    return `<details class="evidence"><summary>${guided ? "查看分析依据与来源值" : "查看逐项条件与来源值"} · ${items.length} 条已关联证据</summary>${guided ? "" : `<div class="criteria-grid">${criteria(c)}</div>`}${items.map((ev) => `<div class="evidence-item"><strong>${esc(ev.metric)}</strong> ${reference(ev.invocation_id)}<p>${text(valueText(ev.value))}</p><small>单位：${esc(ev.unit || "未标注")} · 周期：${esc(ev.period_start || "未记录")} — ${esc(ev.period_end || "未记录")} · 时区：${esc(ev.timezone || "未记录")}</small><code>${esc(ev.pointer)}</code></div>`).join("")}${hasInvalidEvidence ? "<p class=muted>部分引用无法与本次归档来源对应，未展示为已核验事实。</p>" : ""}<h4>${guided ? "分析依据与数据局限" : "规则核验与证据缺口"}</h4><p>${text(guided ? c.reason : c.assessment_summary || c.reason)}</p>${list(c.limitations || [])}</details>`;
  };
  const counts = Object.fromEntries(
    Object.keys(decision).map((key) => [
      key,
      candidates.filter((c) => c.decision === key).length,
    ]),
  );
  const covered = candidates.filter(
    (c) =>
      validEvidence(c).length ||
      Object.keys(c.assessment?.facts || {}).some((key) => fact(c, key)),
  ).length;
  const target = Number.isInteger(request.candidate_count)
    ? request.candidate_count
    : null;
  const statusLabel =
    { complete: "研究完成", partial: "阶段结果", waiting_input: "待补充资料" }[
      result.status
    ] || "研究结果";
  const metric = (label, value, note) =>
    `<div class="metric"><span>${esc(label)}</span><b>${esc(value)}</b><small>${esc(note)}</small></div>`;
  const heading = (id) =>
    `<div class="section-heading"><h2>${esc(sections.find((section) => section.id === id).title)}</h2><a class="back-top" href="#top">返回目录 ↑</a></div>`;
  const sourceEntries = [...sources.entries()];
  const sourceNames = [
    ...new Set(
      sourceEntries.map(([, source]) => source.source || "来源未标注"),
    ),
  ];
  const deep = candidates.slice(0, 5);
  const recommendation =
    Object.entries(counts)
      .filter(([, count]) => count > 0)
      .map(
        ([key, count]) =>
          `${count} 个${{ shortlist: guided ? "优先研究" : "可入池研究", watch: "继续观察", reject: "暂不推进" }[key]}`,
      )
      .join("，") || "暂无候选，需继续收集资料。";
  const risk =
    [
      ...candidates
        .filter((c) => c.decision !== "reject")
        .flatMap((c) => c.limitations || []),
      ...result.limitations,
    ]
      .map((item) => brief(item, ""))
      .find(Boolean) || "现有证据仍需验证，详见数据限制。";
  const nextStep = brief(
    result.next_actions[0]?.title,
    "查看最小测试方案，补充关键证据。",
  );
  const draft = result.model_draft;
  const originalSections = (items) =>
    items
      .map(
        (s) =>
          `<h4>${esc(s.title)} <small>${esc({ observed: "观察记录", inferred: "推断", pending: "待验证" }[s.kind] || "模型草稿")}</small></h4><p>${text(s.body)}</p><p class="muted">${(s.evidence_ids || []).map(reference).join(" ") || "无直接引用"}</p>`,
      )
      .join("");
  const catalogs = sections
    .filter((s) => s.id.startsWith("catalog-"))
    .map(
      (section, page) =>
        `<section class="section catalog-page" id="${section.id}">${heading(section.id)}<p class="section-lead">${candidates.length ? `序号 ${page * 12 + 1}–${Math.min((page + 1) * 12, candidates.length)} · 保留研究顺序，序号不代表评分` : "当前尚无候选商品，保留空清单以说明研究进度。"}</p><div class="catalog-grid">${candidates
          .slice(page * 12, (page + 1) * 12)
          .map(
            (c, index) =>
              `<article class="catalog-card" id="candidate-${page * 12 + index + 1}"><div class="catalog-top"><span>NO. ${String(page * 12 + index + 1).padStart(2, "0")}</span>${pill(c.decision, decisionLabels[c.decision] || "待核验")}</div><div class="catalog-head">${photo(c)}<div><h3>${esc(c.title)}</h3><div class="product-id">${esc(c.product_id)}</div></div></div>${mini(c)}${page * 12 + index >= 5 ? `<details class="product-facts"><summary>查看销量趋势</summary>${trendChart(c, sources, reference)}</details>` : ""}<div class="strategy-row">${strategy(c)}</div>${candidateAnalysis(c, sources, reference)}<div class="links">${link(c)}${page * 12 + index < 5 ? `<a href="#deep-${page * 12 + index + 1}">查看深度证据 ↑</a>` : ""}</div>${evidence(c)}</article>`,
          )
          .join("")}</div></section>`,
    )
    .join("");
  return publicReportHtml(`<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="report-template" content="${SCOUTING_REPORT_VERSION}"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${esc(meta.title || "选品机会研究")}</title><style>${CSS}
.conclusion-brief{margin:0}.conclusion-brief>div{display:grid;grid-template-columns:3.5em minmax(0,1fr);gap:14px;padding:8px 0}.conclusion-brief dt{font-weight:600;color:#65796b}.conclusion-brief dd{margin:0;overflow-wrap:anywhere}.fact-note{color:#627368;font-size:12px;line-height:1.7;margin:8px 0 16px}.fact-ref{font-size:11px;font-weight:400;margin-left:6px;white-space:nowrap}.product-facts{margin:12px 0 18px;border-top:1px solid #e1e7db;padding-top:12px}.product-facts summary{cursor:pointer;color:#426452;font-size:13px}.mini dd{overflow-wrap:anywhere}.catalog-card .trend-plots{grid-template-columns:1fr}</style></head>
<body><header class="hero" id="top"><div class="hero-inner"><div class="eyebrow">${BRAND_NAME} / TIKTOK PRODUCT SCOUTING · ${esc(request.market || "市场待记录")}</div><h1>${esc(request.category || meta.title || "选品机会研究")}<span>${candidates.length} 品机会调研</span></h1><p>${esc(recommendation)}</p><div class="meta">${esc(statusLabel)} · ${request.lookback_days ? `回看 ${esc(request.lookback_days)} 天 · ` : ""}研究截点 ${esc(time(meta.as_of))}<br>报告生成 ${esc(time(meta.created_at))} · 技能版本 ${esc(meta.skill_version || "未记录")}</div>${meta.notice ? `<p class="hero-notice">${text(meta.notice)}</p>` : ""}</div></header>
<div class="wrap"><nav class="report-nav" aria-label="报告目录"><span>阅读目录</span>${sections.map((s, i) => `<a href="#${s.id}"><small>${String(i + 1).padStart(2, "0")}</small> ${esc(s.title)}</a>`).join("")}</nav><main>
<section class="section" id="overview"><h2 class="sr-only">候选概览</h2><div class="metrics">${metric("已收集商品", candidates.length, target === null ? "按实际研究结果展示" : `目标 ${target} 个 · 未补齐不凑数`)}${metric(guided ? "优先研究" : "可入池研究", counts.shortlist, guided ? "模型综合建议" : "继续验证成本与执行条件")}${metric(guided ? "继续观察" : "需补证", counts.watch, guided ? "结合机会与风险继续评估" : "尚不支持直接备货")}${metric("暂不推进", counts.reject, "保留淘汰依据")}${metric("来源已关联", `${covered}/${candidates.length}`, guided ? "事实可追溯，建议由模型综合分析" : "关联不代表策略全部通过")}</div></section>
<section class="section" id="conclusions">${heading("conclusions")}<div class="panel"><dl class="conclusion-brief"><div><dt>建议</dt><dd>${result.status === "complete" ? "" : "阶段结果："}${esc(recommendation)}</dd></div><div><dt>风险</dt><dd>${text(risk)}</dd></div><div><dt>下一步</dt><dd>${text(nextStep)}</dd></div></dl><details class="analysis-details"><summary>展开完整分析</summary><p>${text(result.summary)}</p>${originalSections(result.sections)}</details></div></section>
<section class="section panel warn" id="validation">${heading("validation")}<p>本报告关联 ${sourceEntries.length} 次归档数据调用${sourceNames.length ? `，来源：${esc(sourceNames.join("、"))}` : "，来源尚未关联"}。${sourceNames.length === 1 ? "同一来源的多个接口不构成独立交叉验证。" : "来源数量本身不代表已完成交叉验证。"}</p>${meta.quality ? `<p>资料覆盖：图片 ${esc(meta.quality.image_count)}/${candidates.length}；售价 ${esc(meta.quality.field_coverage.floor_price)}/${candidates.length}；评分 ${esc(meta.quality.field_coverage.product_rating)}/${candidates.length}；日销量序列 ${esc(meta.quality.daily_sales_series_count)}/${candidates.length}。缺项在商品卡片中标明，可继续补充研究。</p>` : ""}${meta.quality?.analysis_coverage ? `<p>逐品分析覆盖：增长 ${meta.quality.analysis_coverage.growth}/${candidates.length}；竞争 ${meta.quality.analysis_coverage.competition}/${candidates.length}；评分与评论 ${meta.quality.analysis_coverage.reputation || 0}/${candidates.length}；测试方案 ${meta.quality.analysis_coverage.test_plan}/${candidates.length}。历史报告未保存的分析仍是缺项，商品正文保留本次已生成的模型判断。</p>` : ""}<p>快照保留原始采集时间；报告生成时间不代表行情更新时间。订单趋势、货源成本及政策检查按下方实际证据标明状态。</p>${target !== null && candidates.length < target ? `<p><strong>交付缺口：</strong>实际 ${candidates.length} / 目标 ${target} 个，仍缺 ${target - candidates.length} 个商品资料。</p>` : ""}</section>
<section class="section" id="deep-dives">${heading("deep-dives")}<p class="section-lead">${guided ? "按候选顺序展开机会分析、增长、竞争、评价与测试建议。有逐日销量时按日期累加绘图，缺失日期不补零。销量与订单分别记录。" : "按候选顺序展开；事实、策略条件和缺口一起看。有逐日销量时按日期累加绘图，缺失日期不补零。销量趋势仅用于观察，不替代策略 B 所需的订单证据。"}</p><div class="deep-list">${deep.map((c, i) => `<article class="deep-card" id="deep-${i + 1}"><div class="deep-head">${photo(c)}<div><div class="eyebrow">PRODUCT ${String(i + 1).padStart(2, "0")}</div><h3>${esc(c.title)}</h3><div class="product-id">${esc(c.product_id)}</div>${pill(c.decision, decisionLabels[c.decision] || "待核验")}</div></div>${mini(c)}${trendChart(c, sources, reference)}<div class="strategy-row">${strategy(c)}</div>${candidateAnalysis(c, sources, reference)}<div class="links">${link(c)}<a href="#candidate-${i + 1}">定位候选卡片 ↓</a></div>${evidence(c)}</article>`).join("") || "<div class=panel>暂无可展开的商品，先完成候选采集。</div>"}</div></section>
<section class="section" id="methodology">${heading("methodology")}${guided ? `<div class="panel"><h3>本次选品规则 · 用户输入</h3><p>${text(request.selection_rules || "未填写选品规则，按指定市场、品类与时间范围进行综合机会分析。")}</p><p>规则用于指导研究重点。模型结合证据说明推荐理由、偏离预期的情况和数据局限，不作逐项通过或淘汰判定。</p></div>` : `<div class="method"><article class="panel"><div class="eyebrow">STRATEGY A</div><h3>市场机会 · 体量与竞争</h3><p>核对同类市场体量、去重在售商家数、贡献利润率与商品评价。</p>${list([`市场 GMV 门槛：${number(request.market_min_gmv)}；市场范围、周期及币种须有来源。`, `在售商家数 ≤ ${number(request.active_sellers_max)}；商品评价 ≥ ${number(request.minimum_rating)}。`, `贡献利润率 ≥ ${finite(request.minimum_margin) ? number(request.minimum_margin * 100) + "%" : "待核验"}；佣金率不能代替利润率。`])}</article><article class="panel"><div class="eyebrow">STRATEGY B</div><h3>新竞品 · 上架与订单</h3><p>关注观察窗内新上架的竞争商品，并核验持续的订单增长。</p>${list([`上架观察窗：最近 ${number(request.lookback_days)} 天，以研究截点为准。`, `最近完整 7 天订单严格 > ${number(request.minimum_orders_7d)} 单；销量与订单分别记录。`, "完整 14 天日订单：后 7 天总量高于前 7 天，且趋势斜率为正。缺失日期不能填零。"])}</article></div>`}<div class="panel profit"><h3>利润口径 · 测样后再计算</h3><p class="formula">贡献利润 = 售价 − 采购成本 − 运费 − 平台费用 − 其他已确认费用<br>贡献利润率 = 贡献利润 ÷ 售价</p><p>平台费按当前约定 6% 作为测算假设。买样后称重并测量包装长宽高；按物流渠道的体积重系数、实重与计费规则核算运费。退货、营销及未知费用不静默填零，实际计算以已保存的费用方案为准。</p>${guided ? "" : `<details><summary>研究范围与程序核验记录</summary>${originalSections(result.sections)}</details>`}</div></section>
<section class="section test-section" id="test-plan">${heading("test-plan")}${testPlans(result, sources, reference)}</section>
<section class="section" id="policy">${heading("policy")}${policyChecks(result, sources, reference)}</section>
${catalogs}
<section class="section panel" id="limits">${heading("limits")}${list(result.limitations.concat(result.questions))}<p>未归档或无法安全读取的图片显示“待补充”；来源评分、售价区间和上架日期只展示可定位到归档数据的值。每日累计销量从本次趋势接口观察窗首个有效日期开始累加，不代表商品历史累计销量，也不替代订单；缺失日期不补零。利润缺口保留，不使用装饰性数值补齐。</p>${draft ? `<details class="model-draft"><summary>模型分析草稿 · 需人工审阅</summary><p class="draft-notice">以下保留模型原文，可能含指标口径或策略判断错误；请以上方逐项核验为准。</p><p>${text(draft.summary)}</p>${originalSections(draft.sections || [])}${list([...(draft.limitations || []), ...(draft.questions || [])])}${(draft.next_actions || []).map((a) => `<h4>${esc(a.title)}</h4><p>${text(a.reason)}</p>`).join("")}</details>` : ""}</section>
<section class="section" id="sources">${heading("sources")}<p class="section-lead">这些是本次研究使用的归档证据。阅读、下载报告不会刷新数据，也不会再次产生数据或模型费用。</p><ol class="sources">${sourceEntries.map(([key, source], index) => `<li id="source-${index + 1}"><strong>[${index + 1}] ${esc(source.source || "来源未标注")} · ${esc(source.tool || "接口未记录")}</strong><p>采集：${esc(time(source.captured_at))}<br>${source.cache_hit === true ? "快照复用" : source.cache_hit === false ? "实时接口采集" : "历史调用记录"}${source.served_at ? ` · 本次返回 ${esc(time(source.served_at))}` : ""}</p><code>调用 ${esc(key)}</code>${source.snapshot_id ? `<code>快照 ${esc(source.snapshot_id)}</code>` : ""}</li>`).join("") || "<li>暂无可关联的归档数据调用，事实仍需补充来源。</li>"}</ol></section>
</main><footer>${BRAND_NAME} · ${BRAND_TAGLINE}<br> 选品研究简报 · ${SCOUTING_REPORT_VERSION}<br>同一候选快照生成全文与决策清单 · 历史报告保留原件</footer></div></body></html>`);
}
