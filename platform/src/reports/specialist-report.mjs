import { BRAND_NAME, BRAND_TAGLINE } from "../../web/lib/brand.mjs";
import { publicReportHtml } from "../common/public-report.mjs";
import { specialistResultPresentation } from "../common/research-language.mjs";

export const SPECIALIST_REPORT_VERSION = "specialist-v4";
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const paragraph = (value) => esc(value).replaceAll("\n", "<br>");
// The model often returns Markdown tables in section bodies. Render their
// structure while escaping every cell; never interpret raw HTML from evidence.
export function reportBody(value) {
  const lines = String(value || "").split("\n"),
    blocks = [];
  const cells = (line) =>
    line
      .trim()
      .replace(/^\||\|$/g, "")
      .split(/(?<!\\)\|/)
      .map((cell) => cell.trim().replaceAll("\\|", "|"));
  let pending = [];
  const flush = () => {
    if (pending.length) blocks.push(`<p>${paragraph(pending.join("\n"))}</p>`);
    pending = [];
  };
  for (let i = 0; i < lines.length; i++) {
    if (
      lines[i].trim().startsWith("|") &&
      lines[i + 1]?.trim().startsWith("|") &&
      cells(lines[i]).length > 1 &&
      cells(lines[i + 1]).length === cells(lines[i]).length
    ) {
      flush();
      const header = cells(lines[i]);
      if (cells(lines[i + 1]).every((cell) => /^:?-{3,}:?$/.test(cell))) i++;
      const rows = [];
      while (
        lines[i + 1]?.trim().startsWith("|") &&
        cells(lines[i + 1]).length === header.length
      )
        rows.push(cells(lines[++i]));
      blocks.push(
        `<div class="table-scroll"><table><thead><tr>${header.map((cell) => `<th>${esc(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`,
      );
    } else if (lines[i].trim()) pending.push(lines[i]);
    else flush();
  }
  flush();
  return blocks.join("");
}
const labels = {
  competitor: "竞店增长拆解",
  monitoring: "竞店巡检报告",
  content: "内容与脚本实验",
  reviews: "评论与商品改进",
  ads: "广告与素材分析",
  diagnostics: "经营异动诊断",
};
const short = (value, fallback) => {
  const full = String(value || "").trim();
  if (full && full.length <= 140) return full;
  const sentence = full.trim().split(/(?<=[。！？])\s*|\n/)[0];
  return sentence
    ? sentence.length <= 140
      ? sentence
      : `${sentence.slice(0, 137)}…`
    : fallback;
};

export function renderSpecialistReport(result, meta) {
  result = specialistResultPresentation(result);
  const ids = [
    ...new Set(
      result.sections
        .flatMap((s) => s.evidence_ids)
        .concat(
          result.candidates.flatMap((c) =>
            c.evidence.map((e) => e.invocation_id),
          ),
        ),
    ),
  ];
  const refs = (values) =>
    [...new Set(values)]
      .map(
        (id) =>
          `<a href="#source-${ids.indexOf(id) + 1}">[${ids.indexOf(id) + 1}]</a>`,
      )
      .join(" ");
  const body = result.sections
    .map(
      (s, i) =>
        `<section id="section-${i + 1}"><small>${esc({ observed: "观察", inferred: "推断与建议", pending: "待验证" }[s.kind])}</small><h2>${esc(s.title)}</h2>${reportBody(s.body)}${s.evidence_ids.length ? `<div class="references">依据 ${refs(s.evidence_ids)}</div>` : ""}</section>`,
    )
    .join("");
  const status =
    { complete: "研究完成", partial: "部分完成", waiting_input: "待补充资料" }[
      result.status
    ] || "研究结果";
  const products = result.candidates
    .map(
      (c) =>
        `<article><h3>${esc(c.title)}</h3><p>${paragraph(c.reason)}</p>${c.evidence.length ? `<div class="references">依据 ${refs(c.evidence.map((e) => e.invocation_id))}</div>` : ""}${c.limitations.length ? `<p class="muted">${paragraph(c.limitations.join("；"))}</p>` : ""}</article>`,
    )
    .join("");
  return publicReportHtml(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="report-template" content="${SPECIALIST_REPORT_VERSION}"><title>${esc(meta.title)}</title><style>
*{box-sizing:border-box}.table-scroll{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;vertical-align:top;border:1px solid #dce5df;padding:10px;min-width:110px;overflow-wrap:anywhere}th{background:#edf3eb}body{font:15px/1.85 system-ui,sans-serif;max-width:1100px;margin:24px auto;padding:24px;color:#20392e;background:#fafbf8}h1{font-size:32px;line-height:1.4}h2{font-size:23px}section{padding:24px 0;border-top:1px solid #dce5df}article{margin:20px 0}small,.muted{color:#687c71}nav{display:flex;flex-wrap:wrap;gap:8px 20px;margin:24px 0}a{color:#176b53}p,li,h1,h2,h3{overflow-wrap:anywhere}dl{margin:0;background:#edf3eb;padding:16px 22px}dl>div{display:grid;grid-template-columns:4em 1fr;gap:12px;padding:5px 0}dt{color:#687c71}dd{margin:0;overflow-wrap:anywhere}summary{cursor:pointer;color:#176b53}details{margin:18px 0}.references{font-size:12px}ol{padding-left:22px}.sources li{margin:14px 0}a:focus-visible,summary:focus-visible{outline:2px solid #176b53;outline-offset:3px}@media(max-width:640px){body{padding:18px;margin:0}h1{font-size:25px}dl{padding:14px}}
</style></head><body><header><small>${BRAND_NAME} · ${esc(labels[meta.kind] || "专项研究")}</small><h1>${esc(meta.title)}</h1><p class="muted">${BRAND_TAGLINE}</p><p class="muted">${status} · 技能版本 ${esc(meta.skill_version)} · ${esc(meta.created_at)}</p></header><main><section id="conclusions"><h2>先给结论</h2><dl><div><dt>结论</dt><dd>${esc(short(result.summary, "研究结论已整理，展开摘要查看完整判断。"))}</dd></div><div><dt>下一步</dt><dd>${esc(short(result.next_actions[0]?.title, "按下方建议继续验证。"))}</dd></div></dl><details><summary>展开完整摘要</summary><p>${paragraph(result.summary)}</p></details></section><nav aria-label="报告目录">${result.sections.map((s, i) => `<a href="#section-${i + 1}">${esc(s.title)}</a>`).join("")}</nav>${body}${products ? `<section><h2>相关商品分析</h2>${products}</section>` : ""}<section><h2>数据限制与待补信息</h2><ul>${result.limitations
    .concat(result.questions)
    .map((s) => `<li>${paragraph(s)}</li>`)
    .join(
      "",
    )}</ul></section><section><h2>下一步建议</h2>${result.next_actions.map((s) => `<h3>${esc(s.title)}</h3><p>${paragraph(s.reason)}</p>`).join("")}</section><section><h2>证据索引</h2><ol class="sources">${ids.map((id, i) => `<li id="source-${i + 1}">数据API · ${esc(meta.sources?.get(id)?.captured_at || "采集时间见归档资料")}<details><summary>查看来源编号</summary><small>${esc(id)}</small></details></li>`).join("")}</ol></section></main></body></html>`);
}
