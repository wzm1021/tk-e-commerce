// Presentation-only vocabulary. The saved SDK evidence is never rewritten.
export const reasonLabels = {
  positive_fit: ["符合需求，能解决实际问题", "与实际需求不够匹配"],
  price_budget: ["价格与预算合适", "价格或预算方面的顾虑"],
  information_gap: ["仍需了解部分商品信息", "关键信息不够完整"],
  fit_size: ["尺寸与使用场景合适", "担心尺寸或适配性"],
  quality_durability: ["认可品质与耐用性", "担心品质或耐用性"],
  trust_credibility: ["商品信息与评价带来信任", "对商品信息或卖家信任不足"],
  trust: ["商品信息与评价带来信任", "对商品或卖家的可信度有顾虑"],
  shipping_delivery: ["配送条件符合需要", "担心运费或送达时间"],
  shipping: ["配送条件符合需要", "担心运费或送达时间"],
  returns_refunds: ["退换货安排让人放心", "担心退换货或售后保障"],
  aesthetics_design: ["喜欢外观与设计", "外观或设计不符合偏好"],
  design_aesthetics: ["喜欢外观与设计", "外观或设计不符合偏好"],
  usability: ["使用方便，操作简单", "担心安装或使用不方便"],
  functionality: ["功能符合需要", "对功能或实际效果有顾虑"],
  value: ["认为物有所值", "对性价比有顾虑"],
  need_relevance: ["有明确的使用需要", "目前没有明确购买需要"],
  no_need: ["购买需求相关因素", "当前没有购买需要"],
  alternatives: ["相比其他选择更有吸引力", "已有替代品或更合适的选择"],
  safety: ["对使用安全有信心", "担心使用安全"],
  other: ["其他购买考虑", "其他购买顾虑"],
};
export const profileLabels = {
  age: "年龄",
  gender: "性别",
  income: "收入区间",
  education: "教育程度",
  industry: "行业",
  home_ownership: "住房情况",
  pet_ownership: "养宠情况",
  parental_status: "育儿情况",
  relationship_status: "婚恋情况",
  urbanicity: "居住地区",
  cohort: "购物人群",
  interests: "兴趣",
  average_purchase_price: "平均客单价",
  median_purchase_price: "客单价中位数",
  max_purchase_price: "最高客单价",
  average_monthly_spending: "月均消费",
  avg_purchases_per_month: "月均购买次数",
  total_purchases: "累计购买次数",
};
export const valueLabels = {
  Female: "女性",
  Male: "男性",
  Other: "其他",
  Unknown: "未知",
  Urban: "城市",
  Suburban: "郊区",
  Rural: "乡村",
  Renter: "租房",
  Homeowner: "自有住房",
  "No Pets": "未养宠物",
  Cat: "养猫",
  Dog: "养狗",
  Parent: "有子女",
  "No Children": "无子女",
  Married: "已婚",
  Single: "单身",
  Divorced: "离异",
  Undergraduate: "本科",
  Graduate: "研究生",
  "High School": "高中",
  Education: "教育",
  "Ambiguity Aversion": "倾向避开信息不明确的选择",
  "Loss Aversion": "更在意潜在损失",
};
export const recommendationLabels = {
  test_design: "真实测试设计",
  rollout: "推广与上线建议",
  page_optimization: "商品页面改进",
  risk_mitigation: "风险控制",
  success_metrics: "验证指标",
};
export const stabilityLabels = {
  clear: "差异清晰",
  directional: "存在方向性",
  no_difference: "未发现明确差异",
  insufficient: "样本不足",
};
export const labelOf = (table, key, fallback) =>
  Object.hasOwn(table, key || "") ? table[key] : fallback;
export const list = (v) => (Array.isArray(v) ? v : []);
export const confidenceLevel = (v) =>
  Number.isFinite(v) && v > 0 && v <= 1
    ? `${Number((v * 100).toFixed(2))}%`
    : "未提供";
export function sourceText(v) {
  if (typeof v === "string") return v.trim();
  if (!v || typeof v !== "object") return "";
  for (const k of [
    "zh",
    "question_zh",
    "text_zh",
    "message_zh",
    "label_zh",
    "question",
    "text",
    "message",
    "label",
    "en",
    "message_en",
  ])
    if (typeof v[k] === "string" && v[k].trim()) return v[k].trim();
  return "";
}
export function chineseSection(v) {
  if (!v || typeof v !== "object") return {};
  return v.zh && typeof v.zh === "object"
    ? v.zh
    : v.en && typeof v.en === "object"
      ? v.en
      : v;
}
export function needsTranslation(v) {
  const s = sourceText(v);
  return Boolean(
    s &&
    !Object.hasOwn(valueLabels, s) &&
    (/[\u3040-\u30ff\uac00-\ud7af]/.test(s) ||
      (/[A-Za-z]/.test(s) && !/[\u3400-\u9fff]/.test(s))),
  );
}
export function reportText(
  v,
  translations = [],
  fallback = "中文内容暂未准备好",
) {
  const s = sourceText(v);
  if (!s) return "未提供";
  if (Object.hasOwn(valueLabels, s)) return valueLabels[s];
  if (!needsTranslation(s)) return s;
  const translated = translations.find((t) => t.source === s)?.zh;
  return translated || fallback;
}
export function reasonText(v, concern = false, translations = []) {
  const code = typeof v === "string" ? v : v?.category;
  if (Object.hasOwn(reasonLabels, code || ""))
    return reasonLabels[code][concern ? 1 : 0];
  const text = sourceText(v) || (typeof code === "string" ? code : "");
  if (text && !/^[a-z][a-z0-9_]*$/.test(text))
    return reportText(text, translations);
  return concern ? "其他顾虑（尚未分类）" : "其他购买考虑（尚未分类）";
}
// Only customer-visible narrative text is sent for translation, never IDs, URLs,
// credentials, screenshots, model names, raw JSON, or numeric metrics.
export function reportSources(result) {
  const values = new Set();
  const add = (v) => {
    const s = sourceText(v);
    if (needsTranslation(s)) values.add(s);
  };
  const addMany = (v) => list(v).forEach(add);
  for (const a of Object.values(result.arms || {})) {
    addMany(a.common_questions);
    for (const key of ["top_buy_reasons", "top_concerns"])
      for (const v of list(a[key]))
        if (
          !Object.hasOwn(
            reasonLabels,
            (typeof v === "string" ? v : v?.category) || "",
          )
        ) {
          const s = sourceText(v);
          if (!/^[a-z][a-z0-9_]*$/.test(s)) add(s);
        }
  }
  const narrative = chineseSection(result.narrative);
  for (const k of ["headline", "summary", "comparison"]) add(narrative[k]);
  for (const k of ["audience_insights", "main_concerns", "limitations"])
    addMany(narrative[k]);
  for (const step of list(narrative.next_steps)) {
    add(step.action);
    add(step.based_on);
  }
  for (const rows of Object.values(result.recommendations || {}))
    for (const v of list(rows)) {
      add(v.title);
      add(v.detail);
      add(v.principle);
    }
  add(result.decision?.label_zh || result.decision?.label_en);
  add(result.decision?.reason_zh || result.decision?.reason_en);
  for (const s of list(result.segments)) add(s.value);
  for (const s of Object.values(result.segment_insights || {})) add(s);
  for (const p of list(result.personas)) {
    for (const [k, v] of Object.entries(p.profile || {}))
      if (Object.hasOwn(profileLabels, k))
        Array.isArray(v) ? addMany(v) : add(v);
    for (const a of Object.values(p.arms || {})) {
      add(a.primary_reason);
      add(a.primary_concern);
      addMany(a.questions);
    }
  }
  const definitions = chineseSection(result.definitions);
  for (const key of ["buy_rate", "ci", "sessions_unparsed"])
    add(definitions[key]);
  addMany(result.data_gaps);
  addMany(result.scope_warnings);
  return [...values];
}
