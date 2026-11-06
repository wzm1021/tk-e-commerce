import { reusableResponse } from "../data/data-cache.mjs";
const DAY = 86400000;
const market = (v) => (v === "UK" ? "GB" : v);
const dateMs = (v) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v
    ? Date.parse(v)
    : null;
const valid = (v) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
const dateAt = (ms) => new Date(ms).toISOString().slice(0, 10);
export function dailyDifference(current, previous) {
  if (current === null || previous === null) return null;
  return {
    units: current - previous,
    percent: previous > 0 ? ((current - previous) / previous) * 100 : null,
  };
}
// Only documented dailyItemList is eligible, never monthItemList or BSR deltas.
export function amazonDailySales(candidate, sources = new Map(), days = 30) {
  days = Number.isInteger(days) && days >= 1 && days <= 180 ? days : 30;
  const ordered = [...sources].sort((a, b) =>
    String(b[1].captured_at).localeCompare(String(a[1].captured_at)),
  );
  for (const [invocation_id, source] of ordered) {
    if (
      source.source !== "SellerSprite" ||
      source.tool !== "asin_prediction" ||
      !reusableResponse(source.result, source.source)
    )
      continue;
    if (
      source.request?.asin !== candidate.product_id ||
      market(source.request?.marketplace) !== candidate.market
    )
      continue;
    const cutoff = dateMs(String(source.captured_at || "").slice(0, 10));
    if (cutoff === null) continue;
    for (const [index, decoded] of (source.decoded || []).entries()) {
      const data = decoded.data?.data;
      if (
        data?.asinDetail?.asin !== candidate.product_id ||
        (data.asinDetail.marketplace &&
          market(data.asinDetail.marketplace) !== candidate.market) ||
        !Array.isArray(data.dailyItemList)
      )
        continue;
      const values = new Map(),
        duplicates = new Set();
      data.dailyItemList.forEach((p, row) => {
        const ms = dateMs(p?.date);
        if (ms === null || ms >= cutoff || ms < cutoff - (days + 7) * DAY)
          return;
        if (values.has(p.date)) {
          duplicates.add(p.date);
          return;
        }
        values.set(p.date, {
          date: p.date,
          sales: valid(p.sales),
          bsr: valid(p.bsr),
          pointer: `/decoded/${index}/data/data/dailyItemList/${row}`,
        });
      });
      for (const key of duplicates) values.delete(key);
      const points = Array.from({ length: days }, (_, i) => {
        const ms = cutoff - (days - i) * DAY,
          date = dateAt(ms),
          raw = values.get(date),
          sales = raw?.sales ?? null;
        return {
          date,
          sales,
          bsr: raw?.bsr ?? null,
          pointer: raw?.pointer ?? null,
          previous: dailyDifference(
            sales,
            values.get(dateAt(ms - DAY))?.sales ?? null,
          ),
          week: dailyDifference(
            sales,
            values.get(dateAt(ms - 7 * DAY))?.sales ?? null,
          ),
        };
      });
      const available = points.filter((p) => p.sales !== null);
      return {
        points,
        invocation_id,
        captured_at: source.captured_at,
        latest: available.at(-1) || null,
        coverage: available.length,
        days,
        duplicates: duplicates.size,
        pointer: `/decoded/${index}/data/data/dailyItemList`,
      };
    }
  }
  return null;
}
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const number = (v) =>
  v === null
    ? "待补充"
    : Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
const signed = (v) => (v > 0 ? "+" : "") + number(v);
function change(v) {
  return v
    ? `${signed(v.units)} 件${v.percent === null ? "（基期为 0，不计算百分比）" : ` / ${signed(v.percent)}%`}`
    : "日期或销量缺失，无法比较";
}
export function amazonDailyChart(c, sources, reference, days = 30) {
  const t = amazonDailySales(c, sources, days);
  if (!t || !t.coverage)
    return '<div class="trend-pending daily-sales"><span>每日销量对比 · 待补充</span><p>尚无该站点与 ASIN 在本次取数日前的有效日销量估算；月度数据不能拆算为日销量。</p></div>';
  const max = Math.max(1, ...t.points.map((p) => p.sales ?? 0)),
    step = 620 / t.days,
    latest = t.latest;
  const bars = t.points
    .map((p, i) => {
      const x = 43 + i * step,
        h = ((p.sales ?? 0) / max) * 128;
      return `${p.sales === null ? `<text x="${x + step / 2}" y="165" text-anchor="middle">—</text>` : `<rect class="daily-bar" x="${x}" y="${170 - h}" width="${Math.max(1, step - 3)}" height="${h}"><title>${p.date}：${number(p.sales)} 件；较前一日 ${esc(change(p.previous))}</title></rect>`}${i === 0 || i === t.days - 1 || (i % Math.ceil(t.days / 6) === 0 && i < t.days - 3) ? `<text x="${x + step / 2}" y="190" text-anchor="middle">${p.date.slice(5)}</text>` : ""}`;
    })
    .join("");
  return `<figure class="trend-chart daily-sales"><figcaption><span>每日销量对比 · 供应商估算</span>${reference(t.invocation_id)}</figcaption><dl class="mini"><div><dt>最近有数据日 · ${latest.date}</dt><dd>${number(latest.sales)} 件</dd></div><div><dt>较前一自然日</dt><dd>${esc(change(latest.previous))}</dd></div><div><dt>较上周同日</dt><dd>${esc(change(latest.week))}</dd></div><div><dt>每日数据覆盖</dt><dd>${t.coverage} / ${t.days} 天</dd></div></dl><svg viewBox="0 0 710 205" role="img" aria-label="${esc(c.product_id)} 每日销量估算，${t.points[0].date} 至 ${t.points.at(-1).date}"><text x="0" y="15">${number(max)} 件</text><line class="grid" x1="40" y1="35" x2="675" y2="35"/><line x1="40" y1="170" x2="675" y2="170"/>${bars}</svg><p>${t.points[0].date} — ${t.points.at(-1).date}；采集 ${esc(t.captured_at)}。按来源日期展示，来源未标注时区；排除取数当日及未来日期。— 为缺失，0 为来源返回零。${t.duplicates ? "重复日期已排除，待核验。" : ""}</p><p>接口按请求 ASIN 返回日销量预测，未明确是否合并变体；不视为子体实际订单，也不与父体月销量相加。百分比仅在基期大于 0 且两天均有数据时计算。</p><details class="trend-data"><summary>展开每日销量与对比明细</summary><div class="table-scroll"><table><thead><tr><th>日期</th><th>估算销量（件）</th><th>较前一日</th><th>较上周同日</th><th>BSR</th></tr></thead><tbody>${t.points.map((p) => `<tr><th>${p.date}</th><td>${number(p.sales)}</td><td>${esc(change(p.previous))}</td><td>${esc(change(p.week))}</td><td>${number(p.bsr)}</td></tr>`).join("")}</tbody></table></div><code>${esc(t.pointer)}</code></details></figure>`;
}
