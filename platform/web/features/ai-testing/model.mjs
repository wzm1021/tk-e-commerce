import { errorText } from "../../lib/format.mjs";
import { fieldLabel } from "../../lib/validation-errors.mjs";
export const markets = {
  tiktok_us: "TikTok Shop · 美国",
  tiktok_uk: "TikTok Shop · 英国",
  tiktok_jp: "TikTok Shop · 日本",
  amazon_us: "Amazon · 美国",
  amazon_uk: "Amazon · 英国",
  amazon_jp: "Amazon · 日本",
};
export const fields = {
  name: "商品名称",
  variant: "SKU / 规格",
  use: "用途",
  material: "材质",
  dimensions: "外部尺寸",
  inner_dimensions: "内部尺寸",
  key_features: "商品卖点",
  limitations: "限制与注意事项",
  "pricing.current_price": "当前售价",
  "pricing.shipping": "运费说明",
  "pricing.delivery": "配送时效",
};
export const inherited = Object.keys(fields);
export const statuses = {
  queued: "等待执行",
  submitting: "正在提交",
  awaiting_upload: "准备截图",
  processing: "模拟中",
  reconciling: "核对任务状态",
  waiting_capacity: "等待共享额度",
  completed: "已完成",
  failed: "执行失败",
  cancelled: "已取消",
  ready: "可用",
  pending: "待验证",
  trial_exhausted: "试用次数用尽",
  monthly_exhausted: "本月额度用尽",
};
export const done = (s) => ["completed", "cancelled", "failed"].includes(s);
export function effective(data, arm) {
  const a = structuredClone(arm);
  for (const k of a.inherit) {
    if (k.startsWith("pricing."))
      a.pricing[k.slice(8)] = data.arms[0].pricing[k.slice(8)];
    else a.product[k] = data.arms[0].product[k];
  }
  if (a.id !== "A" && !a.other_product) {
    a.url = a.url || data.arms[0].url;
    a.product_id = data.arms[0].product_id;
  }
  return a;
}
export const imageUrl = (id, workspace) =>
  "/api/artifacts/" + id + "?workspace=" + encodeURIComponent(workspace);
export const valueOf = (arm, key) =>
  key.startsWith("pricing.") ? arm.pricing[key.slice(8)] : arm.product[key];
export const showValue = (v) =>
  Array.isArray(v)
    ? v.length
      ? v.join("；")
      : "未填写"
    : v == null || v === ""
      ? "未填写"
      : String(v);
export const warningText = (v) =>
  typeof v === "string"
    ? errorText(v)
    : v?.message_zh ||
      (v?.field ? fieldLabel(v.field, "ai-testing") + "：" : "") +
        "此项资料存在限制，请核对并补充；结果会说明相应限制";
export const filterLabels = {
  age: "年龄",
  gender: "性别",
  income: "收入",
  education: "教育",
  industry: "行业",
  home_ownership: "住房",
  pet_ownership: "宠物",
  parental_status: "育儿",
  relationship_status: "婚恋",
  urbanicity: "居住地区",
  cohort: "购物群体",
  income_min: "收入下限",
  average_purchase_price: "平均客单价",
  median_purchase_price: "客单价中位数",
  max_purchase_price: "最高客单价",
  average_monthly_spending: "月均消费",
  avg_purchases_per_month: "每月购买次数",
  total_purchases: "累计购买次数",
};
export function configurationFacts(data) {
  const filters = Object.entries(data.audience_filters)
    .map(
      ([k, v]) =>
        (filterLabels[k] || k) +
        "：" +
        (Array.isArray(v)
          ? v.join(" / ")
          : [
              v.min != null ? "最低 " + v.min : "",
              v.max != null ? "最高 " + v.max : "",
            ]
              .filter(Boolean)
              .join("，")),
    )
    .join("；");
  return {
    测试名称: data.name,
    市场: markets[data.market],
    币种: data.currency,
    素材语言: data.material_language,
    购物意图: data.shopper_intent === "browsing" ? "随意浏览" : "已有购买需求",
    进入方式: {
      feed_content: "内容推荐",
      search: "搜索",
      comparison: "商品比较",
      product_page: "商品页面",
    }[data.entry_point],
    消费者问题: data.shopper_problem,
    使用场景: data.usage_context,
    受众描述: data.audience_description,
    受众筛选: filters || "不限",
    测试问题: data.question,
    追问: data.follow_ups,
    虚拟消费者: data.persona_count,
    每人每方案次数: data.sessions_per_arm,
  };
}
