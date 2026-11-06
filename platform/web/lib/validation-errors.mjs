// Public field labels and remedies. Never render arbitrary provider messages or input values.
const labels = {
  data: "填写内容",
  body: "填写内容",
  name: "名称",
  label: "方案名称",
  product: "商品信息",
  pricing: "价格与配送",
  scenario: "购物场景",
  audience: "受众设置",
  arms: "对比方案",
  url: "商品页面链接",
  product_id: "商品编号",
  asin: "ASIN",
  platform_product_id: "商品编号",
  variant: "规格",
  use: "商品用途",
  material: "材质",
  dimensions: "外部尺寸",
  inner_dimensions: "内部尺寸",
  key_features: "商品卖点",
  limitations: "限制与注意事项",
  current_price: "当前售价",
  proposed_price: "拟调整售价",
  shipping: "运费说明",
  delivery: "配送时效",
  tax: "税费说明",
  change_summary: "变化说明",
  image_id: "页面截图",
  content_type: "图片格式",
  market: "销售市场",
  currency: "币种",
  material_language: "素材语言",
  shopper_intent: "购物意图",
  entry_point: "进入方式",
  shopper_problem: "消费者问题",
  usage_context: "使用场景",
  audience_description: "受众描述",
  description: "描述",
  audience_filters: "受众筛选",
  filters: "受众筛选",
  question: "测试问题",
  primary: "核心测试问题",
  follow_ups: "追问",
  persona_count: "虚拟消费者人数",
  sessions_per_arm: "每人每方案模拟次数",
  other_product: "对比商品设置",
  inherit: "继承字段",
  external_ref: "关联记录",
  partner_product_id: "关联商品编号",
  opportunity_id: "商品机会",
  id: "记录编号",
  version: "版本",
  digest: "确认记录",
  confirmed: "确认选项",
  arm: "方案",
  age: "年龄",
  gender: "性别",
  income: "收入",
  education: "教育程度",
  industry: "行业",
  home_ownership: "住房情况",
  pet_ownership: "宠物情况",
  parental_status: "育儿情况",
  relationship_status: "婚恋情况",
  urbanicity: "居住地区",
  cohort: "购物群体",
  income_min: "收入下限",
  average_purchase_price: "平均客单价",
  median_purchase_price: "客单价中位数",
  max_purchase_price: "最高客单价",
  average_monthly_spending: "月均消费",
  avg_purchases_per_month: "每月购买次数",
  total_purchases: "累计购买次数",
  min: "下限",
  max: "上限",
  login: "账号",
  email: "邮箱",
  password: "密码",
  current_password: "当前密码",
  new_password: "新密码",
  code: "验证码",
  display_name: "显示名称",
  company_name: "公司名称",
  company_size: "公司规模",
  contact_name: "联系人",
  phone: "联系电话",
  role: "角色",
  user_id: "用户",
  workspace_id: "工作空间",
  amount: "金额",
  seats: "席位数",
  reference: "确认单号",
  payment_kind: "付款方式",
  starts_at: "开始时间",
  ends_at: "结束时间",
  date_from: "开始日期",
  date_to: "结束日期",
  from: "开始日期",
  to: "结束日期",
  period: "统计周期",
  kind: "类型",
  title: "标题",
  message: "说明",
  content: "内容",
  notes: "备注",
  status: "状态",
  enabled: "启用状态",
  model: "模型",
  model_id: "模型",
  model_connection_id: "模型连接",
  connection_id: "连接",
  api_key: "密钥",
  secret: "密钥",
  endpoint: "服务地址",
  base_url: "服务地址",
  protocol: "协议",
  files: "附件",
  file: "文件",
  filename: "文件名",
  mime: "文件格式",
  attachment_ids: "附件",
  attachment_id: "附件",
  context: "关联内容",
  category: "类别",
  severity: "影响程度",
  keywords: "关键词",
  query: "查询内容",
  product_ids: "商品编号",
  shop_id: "店铺编号",
  selection_rules: "选品要求",
  budget: "预算",
  model_budget: "模型预算",
  data_budget: "数据预算",
  host: "服务器地址",
  port: "端口",
  username: "用户名",
  sender: "发件人",
  recipients: "收件人",
  owner_email: "负责人邮箱",
  sales_email: "销售邮箱",
  monthly_limit: "月度额度",
  trial_used: "已用试用次数",
  priority: "优先级",
  trial_limit: "试用额度",
};

export function fieldLabel(path, scope = "") {
  const parts = (
    Array.isArray(path)
      ? path
      : String(path || "")
          .replace(/\[(\d+)\]/g, ".$1")
          .split(".")
  )
    .map(String)
    .filter(Boolean);
  while (["data", "body", "spec"].includes(parts[0]) && parts.length > 1)
    parts.shift();
  if (!parts.length) return "填写内容";
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const key = parts[i];
    if (key === "arms" && /^[0-5]$/.test(parts[i + 1] || "")) {
      out.push("方案 " + String.fromCharCode(65 + Number(parts[++i])));
    } else if (/^\d{1,3}$/.test(key)) out.push(`第 ${Number(key) + 1} 项`);
    else if (key === "name" && parts[i - 1] === "product") out.push("商品名称");
    else if (key === "name" && scope === "ai-testing" && i === 0)
      out.push("测品名称");
    else if (key === "description" && parts[i - 1] === "audience")
      out.push("受众描述");
    else if (labels[key]) out.push(labels[key]);
    else out.push("填写项");
  }
  return out.join(" · ");
}

const finite = (v) =>
  typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e9;
function boundMessage(issue) {
  const big = issue.code === "too_big",
    n = big ? issue.maximum : issue.minimum;
  if (!finite(n)) return "超出允许范围，请按页面提示调整";
  const origin = issue.origin || issue.type;
  if (origin === "string")
    return big
      ? `请缩短至 ${n} 个字符以内`
      : n === 1
        ? "不能为空，请填写内容"
        : `请至少填写 ${n} 个字符`;
  if (origin === "array" || origin === "set")
    return big
      ? `最多选择或填写 ${n} 项，请减少数量`
      : `请至少选择或填写 ${n} 项`;
  const op = big
    ? issue.inclusive === false
      ? "小于"
      : "不大于"
    : issue.inclusive === false
      ? "大于"
      : "不小于";
  return `请填写${op} ${n} 的数值`;
}

export function validationMessage(issue, { trusted = true } = {}) {
  // Keep deliberate local Chinese constraints, such as the 10–20 persona rule.
  if (
    trusted &&
    typeof issue.message === "string" &&
    /[\u3400-\u9fff]/u.test(issue.message)
  )
    return issue.message.slice(0, 300);
  if (["too_big", "too_small"].includes(issue.code)) return boundMessage(issue);
  if (issue.code === "invalid_type") {
    if (issue.expected === "int" || issue.expected === "integer")
      return "请填写整数，不要输入小数";
    return (
      {
        string: "请填写文字内容",
        number: "请填写有效数字",
        boolean: "请选择或确认此选项",
        array: "请按列表填写或重新选择",
        object: "内容格式不正确，请重新填写",
      }[issue.expected] || "此项缺失或格式不正确，请重新填写"
    );
  }
  if (issue.code === "invalid_format")
    return (
      {
        email: "请填写完整、有效的邮箱地址",
        url: "请填写完整、有效的链接",
        uuid: "所选记录已失效，请重新选择",
        datetime: "请填写有效的日期和时间",
      }[issue.format] || "格式不正确，请按页面说明重新填写"
    );
  if (["invalid_value", "invalid_enum_value"].includes(issue.code))
    return "请选择页面提供的有效选项";
  if (issue.code === "unrecognized_keys")
    return "包含不支持的字段，请刷新页面后重新填写";
  // Compatibility with older API instances and the provider's flattened Zod errors.
  const m = String(issue.message || "");
  let match = m.match(
    /^Too (big|small): expected (string|array|number|int) to have ([<>]=?)(\d+(?:\.\d+)?) (characters|items)?/i,
  );
  if (match)
    return boundMessage({
      code: match[1].toLowerCase() === "big" ? "too_big" : "too_small",
      origin: match[2].toLowerCase(),
      minimum: Number(match[4]),
      maximum: Number(match[4]),
      inclusive: match[3].includes("="),
    });
  match = m.match(
    /^Too (big|small): expected (?:number|int) to be ([<>]=?)(\d+(?:\.\d+)?)/i,
  );
  if (match)
    return boundMessage({
      code: match[1].toLowerCase() === "big" ? "too_big" : "too_small",
      origin: "number",
      minimum: Number(match[3]),
      maximum: Number(match[3]),
      inclusive: match[2].includes("="),
    });
  if (/expected int(?:eger)?\b/i.test(m)) return "请填写整数，不要输入小数";
  if (/invalid.*email/i.test(m)) return "请填写完整、有效的邮箱地址";
  if (/invalid.*url/i.test(m)) return "请填写完整、有效的链接";
  if (/invalid.*uuid/i.test(m)) return "所选记录已失效，请重新选择";
  if (/expected number/i.test(m)) return "请填写有效数字";
  if (/expected string/i.test(m)) return "请填写文字内容";
  if (/unrecognized key/i.test(m))
    return "包含不支持的字段，请刷新页面后重新填写";
  if (/invalid (option|enum|value)/i.test(m)) return "请选择页面提供的有效选项";
  return "内容不符合要求，请核对后重新填写";
}

export function validationFields(issues, scope = "", options) {
  if (!Array.isArray(issues)) return [];
  return issues.slice(0, 12).map((issue) => {
    const path = Array.isArray(issue.path)
      ? issue.path.join(".")
      : String(issue.path || "").slice(0, 200);
    return {
      path,
      label: fieldLabel(path, scope),
      message: validationMessage(issue, options),
    };
  });
}

export function nativeValidationMessage(input) {
  const v = input.validity;
  if (v.valueMissing) return "此项为必填，请填写或选择后再提交";
  if (v.typeMismatch)
    return input.type === "email"
      ? "请填写完整、有效的邮箱地址"
      : "请填写完整、有效的链接";
  if (v.rangeUnderflow) return `请填写不小于 ${input.min} 的数值`;
  if (v.rangeOverflow) return `请填写不大于 ${input.max} 的数值`;
  if (v.tooShort) return `请至少填写 ${input.minLength} 个字符`;
  if (v.tooLong) return `请缩短至 ${input.maxLength} 个字符以内`;
  if (v.stepMismatch)
    return input.step === "1"
      ? "请填写整数，不要输入小数"
      : "数值精度不正确，请按页面提示填写";
  if (v.badInput) return "请填写有效数字";
  return "格式不正确，请按页面提示重新填写";
}

export function fieldErrorsText(fields, scope = "") {
  if (!Array.isArray(fields)) return "";
  return validationFields(
    fields.filter((x) => x && typeof x === "object"),
    scope,
  )
    .map((x) => `${x.label}：${x.message}`)
    .join("\n");
}
