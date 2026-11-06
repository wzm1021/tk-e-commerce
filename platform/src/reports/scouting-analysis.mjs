const esc = (x) =>
  String(x ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const text = (x) => esc(x).replaceAll("\n", "<br>");
const list = (x) =>
  x?.length ? `<ul>${x.map((v) => `<li>${text(v)}</li>`).join("")}</ul>` : "";
const url = (value) => {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password
      ? u.toString()
      : null;
  } catch {
    return null;
  }
};
const point = (object, p) =>
  p
    .split("/")
    .slice(1)
    .reduce(
      (v, k) =>
        v && typeof v === "object"
          ? v[k.replaceAll("~1", "/").replaceAll("~0", "~")]
          : undefined,
      object,
    );
export function candidateAnalysis(c, sources, reference) {
  const r = c.research;
  if (!r) return `<div class="candidate-analysis"><h4>机会判断 · 模型分析</h4><p>${text(c.reason)}</p></div>`;
  const section = (label, v) =>
    `<h4>${label} · 模型分析</h4><p>${v?.summary ? text(v.summary) : "尚未完成该商品的证据分析。"}</p>${
      v?.evidence_ids
        ?.filter((id) => sources.has(id))
        .map(reference)
        .join(" ") || ""
    }${list(v?.limitations)}`;
  const links = (r?.links || [])
    .filter(
      (l) =>
        url(l.url) &&
        sources.has(l.invocation_id) &&
        point(sources.get(l.invocation_id), l.pointer) === l.url,
    )
    .map(
      (l) =>
        `<a href="${esc(url(l.url))}" target="_blank" rel="noopener noreferrer">${esc(l.label)}</a>`,
    )
    .join(" · ");
  return `<div class="candidate-analysis"><h4>机会判断 · 模型分析</h4><p>${text(c.reason)}</p>${section("增长原因", r?.growth)}${links ? `<p>${links}</p>` : ""}${section("竞争格局", r?.competition)}${section("评分与评论", r?.reputation)}<h4>最小测试 · 建议，尚未执行</h4><p>${r?.test_plan?.summary ? text(r.test_plan.summary) : "尚未形成基于该商品数据的测试方案，不套用统一样本量或阈值。"}</p>${
    r?.test_plan?.rationale
      ? `<p><strong>方案依据：</strong>${text(r.test_plan.rationale)} ${(
          r.test_plan.evidence_ids || []
        )
          .filter((id) => sources.has(id))
          .map(reference)
          .join(" ")}</p>`
      : ""
  }${list(r?.test_plan?.assumptions)}</div>`;
}
export function testPlans(result, sources, reference) {
  const plans = result.candidates.filter((c) => c.research?.test_plan);
  if (plans.length)
    return `<p>以下方案由模型依据各商品本次查询证据提出；数量、周期和阈值是待验证的实验设计，不是数据接口的预测或保证。</p><div class="test-grid">${plans
      .map(
        (c, i) =>
          `<article class="test-step"><b>${i + 1}</b><h3>${esc(c.title)}</h3><p>${text(c.research.test_plan.summary)}</p><h4>为什么这样测</h4><p>${text(c.research.test_plan.rationale)} ${c.research.test_plan.evidence_ids
            .filter((id) => sources.has(id))
            .map(reference)
            .join(" ")}</p>${list(c.research.test_plan.assumptions)}</article>`,
      )
      .join("")}</div>`;
  const sections = (
    result.model_draft?.sections ||
    result.sections ||
    []
  ).filter((s) => /最小测试|实验方案|小测方案/.test(s.title));
  if (sections.length)
    return `<p>本次模型提出的测试建议，尚未执行；历史报告尚未保存逐品结构化方案。</p>${sections
      .map(
        (s) =>
          `<article class="panel"><h3>${esc(s.title)}</h3><p>${text(s.body)}</p>${(
            s.evidence_ids || []
          )
            .filter((id) => sources.has(id))
            .map(reference)
            .join(" ")}</article>`,
      )
      .join("")}`;
  return '<p class="section-lead">本次尚未生成有证据依据的测试方案；待完成商品增长与竞争分析后再制定，不使用固定备货量、达人数量或转化门槛。</p>';
}
export function policyChecks(result, sources, reference) {
  const checks = result.policy_checks || [];
  if (!checks.length)
    return '<p class="section-lead">本次尚未形成基于官方网页的政策检查；不把通用清单或模型记忆当成现行政策。</p>';
  return `<p>官方页面与读取时间如下。政策适用性及上架前动作属于模型分析；网页读取不等于 SKU 已通过合规审核。</p><div class="table-scroll"><table class="policy-table"><thead><tr><th>适用对象</th><th>官方依据与适用性分析</th><th>上架前动作</th></tr></thead><tbody>${checks
    .map((c) => {
      const pages = c.evidence_ids
        .map((id) => [id, sources.get(id)])
        .filter(
          ([, s]) =>
            s?.tool === "policy_fetch" && s.status === "fetched" && url(s.url),
        );
      return `<tr><th>${esc(c.scope)}</th><td>${text(c.summary)}<p>${pages.length ? pages.map(([id, s]) => `<a href="${esc(url(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.title || s.url)}</a> ${reference(id)}<br>读取日期：${esc(s.captured_at)}<br>`).join("") : "未取得可读的官方页面 · 待核验"}</p></td><td>${text(c.action)}<br>${c.status === "reviewed" && pages.length ? "已查阅来源，适用性需结合商品资料" : "待核验"}</td></tr>`;
    })
    .join("")}</tbody></table></div>`;
}
