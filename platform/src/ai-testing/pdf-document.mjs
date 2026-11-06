import { BRAND_NAME, BRAND_TAGLINE } from "../../web/lib/brand.mjs";
import { readFile } from "node:fs/promises";
import {
  list,
  labelOf,
  reportText,
  reasonText,
  chineseSection,
  profileLabels,
  recommendationLabels,
  stabilityLabels,
  confidenceLevel,
} from "../../web/features/ai-testing/report-content.mjs";
import {
  configurationFacts,
  fields,
  valueOf,
  showValue,
  effective,
} from "../../web/features/ai-testing/model.mjs";

export const escapeHtml = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (s) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        s
      ],
  );
const pct = (v) => (Number.isFinite(v) ? (v * 100).toFixed(1) + "%" : "未提供");
const pp = (v) =>
  Number.isFinite(v) ? (v * 100).toFixed(1) + " 个百分点" : "未提供";
const interval = (v) => (Array.isArray(v) ? v.map(pct).join(" - ") : "未提供");
const date = (v) =>
  v && Number.isFinite(new Date(v).getTime())
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(v))
    : "未提供";
const p = (s, cls = "") =>
  `<p${cls ? ` class="${cls}"` : ""}>${escapeHtml(s)}</p>`;
const heading = (s, level = 3) => `<h${level}>${escapeHtml(s)}</h${level}>`;
const facts = (rows) =>
  `<table class="facts"><tbody>${rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join("")}</tbody></table>`;
const profileFacts = (rows) => {
  let html = '<table class="profile"><tbody>';
  for (let i = 0; i < rows.length; i += 2) {
    html += `<tr><th>${escapeHtml(rows[i][0])}</th><td${i + 1 === rows.length ? ' colspan="3"' : ""}>${escapeHtml(rows[i][1])}</td>`;
    if (rows[i + 1])
      html += `<th>${escapeHtml(rows[i + 1][0])}</th><td>${escapeHtml(rows[i + 1][1])}</td>`;
    html += "</tr>";
  }
  return html + "</tbody></table>";
};
const bullets = (items, text, empty = "未提供相关反馈") =>
  list(items).length
    ? `<ul>${items.map((v) => `<li>${escapeHtml(text(v))}</li>`).join("")}</ul>`
    : p(empty, "muted");
const section = (id, title, content) =>
  `<section id="${id}" class="chapter">${heading(title, 2)}${content}</section>`;
function productLink(value) {
  try {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return "未提供有效商品链接";
    return `<a href="${escapeHtml(url.href)}">${escapeHtml(url.href)}</a>`;
  } catch {
    return "未提供有效商品链接";
  }
}

// A standalone, escaped document: no remote fonts, assets, scripts or session URLs.
export async function reportDocument(
  run,
  result,
  screenshots,
  exportedAt = new Date(),
) {
  const translations = result.presentation_zh?.translations || [];
  const text = (v) => reportText(v, translations);
  const narrative = chineseSection(result.narrative),
    definitions = chineseSection(result.definitions);
  const arms = Object.entries(result.arms || {}),
    personas = list(result.personas),
    segments = list(result.segments);
  const name = (id) => {
    const label =
      run.snapshot.data.arms.find((a) => a.id === id)?.label || "页面方案";
    return label.startsWith(id + " ·") ? label : `${id} · ${label}`;
  };
  const reasons = (values, concern) =>
    list(values).length
      ? `<ul class="feedback">${values
          .map((v) => {
            const share = concern ? v.share_of_non_buy : v.share_of_buy;
            return `<li>${escapeHtml(reasonText(v, concern, translations))}${Number.isFinite(v.sessions) ? `<small>${v.sessions} 次${concern ? "未购买" : "购买"}反馈${Number.isFinite(share) ? ` · 占${concern ? "未购买" : "购买"}反馈 ${pct(share)}` : ""}</small>` : ""}</li>`;
          })
          .join("")}</ul>`
      : p("未提供相关反馈", "muted");
  const chapters = [
    ["summary", "01 测品结论"],
    ["results", "02 方案表现与比较"],
    ["insights", "03 整体反馈解读"],
    ["actions", "04 行动建议"],
    ["segments", "05 人群分组表现"],
    ["personas", "06 虚拟消费者完整反馈"],
    ["limits", "07 数据缺口与结论限制"],
    ["definitions", "08 指标说明"],
    ["inputs", "09 本次确认的信息与截图"],
  ];
  const sample = result.sample || {};
  let body = `<header class="cover"><div class="brand">${BRAND_NAME} · AI 测品</div><h1>${escapeHtml(run.snapshot.data.name)}</h1>${p("完整中文测品报告", "subtitle")}${p(BRAND_TAGLINE, "subtitle")}${facts(
    [
      ["销售市场", configurationFacts(run.snapshot.data).市场],
      ["确认时间（北京时间）", date(run.snapshot.confirmed_at)],
      ["导出时间（北京时间）", date(exportedAt)],
    ],
  )}<div class="notice"><strong>AI 虚拟消费者 · 购买意向模拟</strong>${p("本报告用于形成假设和安排真实市场验证，不预测实际订单或销量。反馈来自 AI 模拟消费者，不是真实买家评价；其中的商品判断应结合页面证据核对。")}${p("AI virtual-consumer intent simulation. Not a forecast of real orders or sales.", "muted")}</div><nav>${chapters.map(([id, title]) => `<a href="#${id}">${escapeHtml(title)}</a>`).join("")}</nav></header>`;
  body += section(
    ...chapters[0],
    heading(
      text(
        result.decision?.label_zh ||
          result.decision?.label_en ||
          labelOf(
            stabilityLabels,
            result.comparisons?.[0]?.stability,
            "查看方案比较",
          ),
      ),
    ) +
      (narrative.headline ? p(text(narrative.headline), "lead") : "") +
      (narrative.summary ? p(text(narrative.summary)) : "") +
      (result.decision?.reason_zh || result.decision?.reason_en
        ? p(text(result.decision.reason_zh || result.decision.reason_en))
        : "") +
      facts([
        [
          "完成的虚拟消费者",
          `${sample.personas_completed ?? "未提供"} / ${sample.personas_planned ?? "未提供"}`,
        ],
        [
          "每人每方案模拟次数",
          sample.sessions_per_arm ?? run.snapshot.data.sessions_per_arm,
        ],
        ["失败的虚拟消费者", sample.personas_failed ?? 0],
        ["无法解析的模拟", sample.sessions_unparsed ?? 0],
      ]),
  );
  body += section(
    ...chapters[1],
    arms
      .map(
        ([id, a]) =>
          `<article class="arm">${heading(name(id))}<div class="rate">${pct(a.buy_rate.value)}</div>${p(`模拟购买意向 · 95% 区间 ${interval(a.buy_rate.ci95)}`)}${facts(
            [
              [
                "选择购买的模拟",
                `${a.buy_sessions ?? "未提供"} / ${a.valid_sessions ?? "未提供"} 次`,
              ],
              [
                "多数模拟中选择购买的人数",
                `${a.personas_majority_buy ?? "未提供"} 人`,
              ],
            ],
          )}${heading("购买理由", 4)}${reasons(a.top_buy_reasons, false)}${heading("主要顾虑", 4)}${reasons(a.top_concerns, true)}${heading("常见问题", 4)}${bullets(a.common_questions, text)}</article>`,
      )
      .join("") +
      p(
        "购买意向按虚拟消费者汇总；反馈占比分别以购买或未购买的有效模拟为基数，同一次模拟可能涉及多个理由，不能将占比直接相加。",
        "muted",
      ) +
      '<div class="comparison">' +
      list(result.comparisons)
        .map(
          (c) =>
            `<article>${heading(`${c.arm} 对比 ${c.vs} · ${labelOf(stabilityLabels, c.stability, "结合区间判断")}`)}${p(`购买意向差异：${pp(c.difference)}`)}${p(`${confidenceLevel(c.ci_level ?? 0.95)} 区间：${list(c.ci).map(pp).join(" 至 ") || "未提供"}`)}${p("差异针对整个页面或商品方案，不代表单个元素的因果作用。区间包含 0 时，不能据此认定某个方案更优。", "muted")}</article>`,
        )
        .join("") +
      (narrative.comparison ? p(text(narrative.comparison)) : "") +
      "</div>",
  );
  body += section(
    ...chapters[2],
    heading("最需要解决的顾虑") +
      bullets(narrative.main_concerns, text) +
      heading("受众观察") +
      bullets(narrative.audience_insights, text),
  );
  body += section(
    ...chapters[3],
    Object.entries(result.recommendations || {})
      .map(
        ([key, rows]) =>
          heading(labelOf(recommendationLabels, key, "其他建议")) +
          list(rows)
            .map(
              (v) =>
                `<article class="recommendation">${heading(text(v.title), 4)}${p(text(v.detail))}${v.principle ? p("行为参考：" + text(v.principle), "muted") : ""}</article>`,
            )
            .join(""),
      )
      .join("") +
      heading("下一步与依据") +
      list(narrative.next_steps)
        .map(
          (v) =>
            `<article class="recommendation">${heading(text(v.action), 4)}${p("依据：" + text(v.based_on))}</article>`,
        )
        .join(""),
  );
  body += section(
    ...chapters[4],
    p(
      "小样本和区间重叠时，观察结果仅供参考，不宜单独用于制定人群策略。",
      "muted",
    ) +
      [...new Set(segments.map((s) => s.dimension))]
        .map(
          (dimension) =>
            `<article class="segment">${heading(labelOf(profileLabels, dimension, "其他人群分组"))}${result.segment_insights?.[dimension] ? p(text(result.segment_insights[dimension])) : ""}<table class="segments"><thead><tr><th>分组</th><th>人数</th>${arms.map(([id]) => `<th>${escapeHtml(id)} 购买意向 / 区间</th>`).join("")}<th>样本提示</th></tr></thead><tbody>${segments
              .filter((s) => s.dimension === dimension)
              .map(
                (s) =>
                  `<tr><td>${escapeHtml(text(s.value))}</td><td>${escapeHtml(s.personas)}</td>${arms.map(([id]) => `<td>${pct(s.buy_rate?.[id])}<small>${interval(s.buy_rate_ci?.[id])}</small></td>`).join("")}<td>${s.small_sample ? "小样本，谨慎解读" : "结合区间判断"}</td></tr>`,
              )
              .join("")}</tbody></table></article>`,
        )
        .join("") +
      (!segments.length ? p("本次未返回符合人数条件的人群分组。") : ""),
  );
  body += section(
    ...chapters[5],
    p(`本次返回 ${personas.length} 位虚拟消费者的反馈，以下全部展示。`) +
      personas
        .map(
          (v, i) =>
            `<article class="persona">${heading(`虚拟消费者 ${i + 1}${v.representative ? " · 代表性样本" : ""}`)}${profileFacts(
              Object.entries(v.profile || {})
                .filter(([k]) => Object.hasOwn(profileLabels, k))
                .map(([k, v]) => [
                  profileLabels[k],
                  Array.isArray(v) ? v.map(text).join("、") : text(String(v)),
                ]),
            )}${arms
              .filter(([id]) => v.arms?.[id])
              .map(([id]) => {
                const a = v.arms[id];
                return `<div class="persona-arm">${heading(`虚拟消费者 ${i + 1} · ${name(id)} · 模拟购买意向 ${pct(a.buy_rate)}`, 4)}${p(
                  "逐次决定：" +
                    (list(a.decisions)
                      .map((d) =>
                        d === 1 ? "购买" : d === 0 ? "不购买" : "未解析",
                      )
                      .join(" / ") || "未提供"),
                )}${heading("主要理由", 4)}${p(a.primary_reason ? text(a.primary_reason) : "未提供")}${heading("主要顾虑", 4)}${p(a.primary_concern ? text(a.primary_concern) : "未提出具体顾虑")}${heading("提出的问题", 4)}${bullets(a.questions, text, "未提出具体问题")}</div>`;
              })
              .join("")}</article>`,
        )
        .join(""),
  );
  body += section(
    ...chapters[6],
    bullets(
      [
        ...list(result.data_gaps),
        ...list(result.scope_warnings),
        ...list(narrative.limitations),
      ],
      text,
      "本次未返回额外的数据缺口；模拟结果仍需真实市场验证。",
    ),
  );
  body += section(
    ...chapters[7],
    facts([
      [
        "模拟购买意向",
        definitions.buy_rate
          ? text(definitions.buy_rate)
          : "先计算每位虚拟消费者在有效模拟中选择购买的比例，再对消费者求平均。",
      ],
      [
        "置信区间",
        definitions.ci
          ? text(definitions.ci)
          : "反映样本不确定性；区间越宽，结论越不稳定。",
      ],
      [
        "差异是否明确",
        "差异清晰：区间不包含 0；存在方向性：有倾向但仍不稳定；未发现明确差异：无法判断更优方案；样本不足：不宜比较。",
      ],
      [
        "无法解析的模拟",
        definitions.sessions_unparsed
          ? text(definitions.sessions_unparsed)
          : "无法读取回答的模拟，不计入任何比例。",
      ],
    ]),
  );
  body += section(
    ...chapters[8],
    facts(
      Object.entries(configurationFacts(run.snapshot.data)).map(([k, v]) => [
        k,
        showValue(v),
      ]),
    ) +
      run.snapshot.data.arms
        .map((a) => {
          const arm = effective(run.snapshot.data, a),
            image = screenshots.find((i) => i.arm === a.id);
          return `<article class="product">${heading(`${name(a.id)}${a.id !== "A" ? (a.other_product ? " · 另一款商品" : " · 同一款商品") : ""}`)}<div class="product-url"><strong>商品链接</strong>${productLink(arm.url)}</div>${facts([["商品编号", arm.product_id || "未填写"], ["方案调整说明", a.change_summary || "未填写"], ...Object.entries(fields).map(([k, label]) => [label, showValue(valueOf(arm, k))])])}${image ? `<figure><img src="${image.data}" alt="${escapeHtml(a.id)} 本次确认截图"><figcaption>${escapeHtml(name(a.id))} · 本次确认的商品页面截图</figcaption></figure>` : ""}</article>`;
        })
        .join(""),
  );
  const css = await readFile(
    new URL("./pdf-style.css", import.meta.url),
    "utf8",
  );
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(run.snapshot.data.name)} · AI测品报告</title><style>${css}</style></head><body>${body}</body></html>`;
}
