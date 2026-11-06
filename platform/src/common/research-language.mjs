// Labels describe source fields, not new conclusions. In particular, units are
// not orders, ad attribution is not incrementality, and a missing flag is not
// proof of organic traffic. This module never rewrites stored evidence.
const labels = {
  shop_name: "店铺名称",
  shop_id: "店铺编号",
  seller_id: "店铺编号",
  product_id: "商品编号",
  video_id: "视频编号",
  creator_uid: "达人编号",
  review_id: "评论编号",
  sku_id: "商品规格编号",
  invocation_id: "来源编号",
  source_id: "来源编号",
  shop_type_code: "店铺类型",
  shop_created_date: "店铺创建日期",
  primary_category_name: "主营类目",
  shop_rating: "店铺评分",
  shop_total_gmv: "店铺累计成交额",
  shop_total_units_sold: "店铺累计销量（件）",
  product_rating: "商品评分",
  review_count: "商品累计评论数",
  total_review_count: "查询范围内的评论总数",
  review_text: "评论原文",
  review_date: "评论日期",
  review_timestamp_ms: "评论时间戳（毫秒）",
  sku_variant_text: "商品规格",
  category_l2: "二级类目",
  category_l3: "三级类目",
  category_sales_rank: "类目销量排名",
  country_sales_rank: "全站销量排名",
  category_name: "类目名称",
  currency_code: "币种",
  floor_price: "最低售价",
  unverified_floor_price: "原始最低售价（单位待核验）",
  unverified_ceiling_price: "原始最高售价（单位待核验）",
  ceiling_price: "最高售价",
  current_price: "当前售价",
  price_display: "售价",
  commission_rate_percent: "佣金比例（%）",
  stock_count: "库存数量",
  stock_units: "库存件数",
  total_gmv: "累计成交额",
  total_units_sold: "累计销量（件）",
  total_video_gmv: "视频累计归因成交额",
  product_total_gmv: "商品总成交额",
  gmv_last_7d: "近7天成交额",
  day7_gmv: "近7天成交额",
  units_sold_last_7d: "近7天销量（件）",
  period_gmv: "所选周期成交额",
  period_total_gmv: "所选周期总成交额",
  period_units_sold: "所选周期销量（件）",
  period_total_units_sold: "所选周期总销量（件）",
  window_gmv: "统计期归因成交额",
  window_units_sold: "统计期归因销量（件）",
  daily_gmv: "当日成交额",
  daily_units_sold: "当日销量（件）",
  units_sold: "销量（件）",
  order_count: "订单数",
  average_order_value: "平均成交金额（来源口径）",
  avg_daily_gmv: "日均成交额",
  avg_daily_units_sold: "日均销量（件）",
  avg_daily: "日均指标",
  estimated_ad_spend: "估算广告花费",
  ad_gmv: "广告归因成交额",
  ad_attributed_gmv: "广告归因成交额",
  ad_gmv_share_percent: "广告归因成交额占比（%）",
  ad_units_sold: "广告归因销量（件）",
  ad_play_count: "广告播放量",
  ad_video_count: "广告视频数",
  avg_daily_estimated_ad_spend: "日均估算广告花费",
  avg_daily_ad_spend: "日均估算广告花费",
  avg_daily_ad_gmv: "日均广告归因成交额",
  avg_daily_ad_units_sold: "日均广告归因销量（件）",
  avg_daily_ad_play_count: "日均广告播放量",
  video_attributed_gmv: "视频归因成交额",
  video_attributed_units_sold: "视频归因销量（件）",
  video_gmv: "视频归因成交额",
  live_gmv: "直播归因成交额",
  video_units_sold: "视频归因销量（件）",
  live_units_sold: "直播归因销量（件）",
  play_count: "播放量",
  inc_play_count: "新增播放量",
  like_count: "点赞数",
  comment_count: "评论数",
  share_count: "分享数",
  follower_count: "粉丝数",
  creator_follower_gain_count: "达人新增粉丝数",
  linked_creator_count: "关联达人数",
  linked_video_count: "关联视频数",
  linked_live_count: "关联直播数",
  linked_product_count: "关联商品数",
  product_count: "商品数",
  interaction_rate_percent: "互动率（%）",
  like_comment_ipm: "每千次播放的点赞与评论数",
  duration_seconds: "视频时长（秒）",
  start_time: "字幕开始时间（秒）",
  end_time: "字幕结束时间（秒）",
  published_at: "发布时间",
  published_at_ts: "发布时间戳",
  video_create_date: "视频发布日期",
  first_seen_date: "首次观测日期",
  last_seen_date: "最近观测日期",
  observed_active_days: "观测到的活跃天数",
  launch_time: "商品上架时间戳",
  captured_at: "数据采集时间",
  snapshot_date: "快照日期",
  start_date: "开始日期",
  end_date: "结束日期",
  time_range_days: "回看天数",
  create_time: "创建时间",
  is_ad: "广告标记",
  is_spark_ad: "原生帖子广告标记",
  has_paid_promotion: "付费推广标记",
  is_ai_generated: "AI生成标记",
  is_off_shelf: "下架状态",
  is_currently_active: "当前活跃状态",
  has_sku_options: "可选规格状态",
  cache_hit: "数据读取方式",
  viral_index: "热度指数（来源指标）",
  ad_type: "广告类型",
  commerce_type: "带货类型",
  local_shop: "本地店",
  cross_border_shop: "跨境店",
  product_card: "商品卡渠道",
  shop_account: "店铺自营账号渠道",
  ad_traffic: "广告归因口径",
  non_ad_video_traffic: "非广告视频归因口径",
  tiktok_shop: "TikTok 商店",
  detail_url: "商品链接",
  tk_url: "商品链接",
  tiktok_url: "视频链接",
  cover_url: "商品图片链接",
  caption_text: "视频文案",
  shop_base_info: "店铺基础资料",
  shop_data_trends: "店铺逐日经营数据",
  shop_sale_analysis: "店铺销售渠道分析",
  shop_product_analysis: "店铺商品结构分析",
  shop_creator_analysis: "店铺达人结构分析",
  shop_investment_analysis: "店铺广告分析",
  shop_search: "店铺搜索",
  shop_rank_top_selling: "店铺热销榜",
  market_category_analysis: "市场与类目分析",
  product_detail_info: "商品详情",
  product_detail: "商品详情",
  product_sales_trend: "商品逐日销售数据",
  product_overview: "商品经营概览",
  product_review_list: "商品评论数据",
  product_investment: "商品广告表现",
  product_video_list: "商品关联视频列表",
  product_creator_analysis: "商品关联达人分析",
  product_sku: "商品规格分析",
  video_detail_analysis: "视频详情分析",
  video_script_info: "视频字幕",
  video_data_trends: "视频逐日表现",
  ad_data_overview: "广告表现概览",
  ad_search: "广告搜索",
  policy_search: "政策搜索",
  policy_fetch: "政策页面读取",
  policy_task_forbidden: "该任务不支持政策查询",
  error_code: "错误说明",
  http_status: "响应状态",
  selection_rules: "用户研究规则",
  ad_performance_summary: "广告表现汇总",
  ad_performance: "广告表现",
  period_summary: "周期汇总",
  period_stats: "周期统计",
  query_summary: "查询汇总",
  daily_trend: "逐日经营数据",
  daily_ad_performance_trend: "逐日广告表现",
  ads_distribution: "广告归因结构",
  channel_distribution: "销售渠道结构",
  sales_channel_distribution: "销售渠道结构",
  content_distribution: "内容类型结构",
  content_type_distribution: "内容类型结构",
  follower_tier_distribution: "粉丝层级分布",
  sku_dimensions: "商品规格维度",
  sku_variants: "商品规格列表",
  top_sku: "主要商品规格",
  distribution_summary: "分布汇总",
  video_meta: "视频基本信息",
  product_contribution: "商品归因贡献",
  creator_growth: "达人粉丝变化",
  linked_products: "关联商品",
  engagement_metrics: "互动数据",
  traffic_flags: "流量标记",
  // These shorter keys are translated only inside a path or assignment.
  shop: "店铺资料",
  product: "商品资料",
  video: "视频资料",
  creator: "达人资料",
  videos: "视频列表",
  reviews: "评论样本",
  items: "样本列表",
  breakdown: "分项数据",
  summary: "汇总数据",
  query: "查询条件",
  ad: "广告资料",
  campaign: "广告计划",
  commerce: "带货表现",
  traffic: "播放表现",
  engagement: "互动表现",
  region: "市场",
  title: "名称",
  nickname: "达人昵称",
  uid: "达人编号",
  total: "返回总数",
  rating: "评分",
  roas: "广告投入回报比（归因口径）",
  page: "页码",
  pagesize: "每页数量",
  page_size: "每页数量",
  n: "样本量",
  orderby: "排序方式",
  status: "状态",
};

const enums = {
  US: "美国站",
  USD: "美元",
  MX: "墨西哥站",
  MXN: "墨西哥比索",
  BR: "巴西站",
  BRL: "巴西雷亚尔",
  local_shop: "本地店",
  cross_border_shop: "跨境店",
  complete: "研究完成",
  partial: "部分完成",
  waiting_input: "待补充资料",
  observed: "观察",
  inferred: "推断",
  pending: "待验证",
};
const flags = {
  cache_hit: ["本次实时采集", "使用历史快照"],
  is_ad: ["未标记为广告", "已标记为广告"],
  has_paid_promotion: ["未标记付费推广", "已标记付费推广"],
  is_spark_ad: ["未标记为原生帖子广告", "已标记为原生帖子广告"],
  is_off_shelf: ["在售", "已下架"],
  is_currently_active: ["当前未活跃", "当前活跃"],
  is_ai_generated: ["未标记为AI生成", "已标记为AI生成"],
  has_sku_options: ["未提供可选规格", "有可选规格"],
};
const labelFor = (key) =>
  Object.hasOwn(labels, key) ? labels[key] : undefined;
const missingLabel = "来源字段（含义待确认）";
const collections = new Set([
  "reviews",
  "videos",
  "items",
  "daily_trend",
  "daily_ad_performance_trend",
  "sku_variants",
  "sku_dimensions",
  "breakdown",
]);
const urlPattern = /(https?:\/\/[^\s<>"'`，。；（）\[\]]+)/g;
const pathPattern =
  /(?:\/(?:decoded|result|data|summary|shop|product|reviews|videos|daily_trend|ad|creator|commerce|query)(?=\/|\b)|(?:…|\.{3})\/)[A-Za-z0-9_~./-]*/g;
const scalar = String.raw`(?:"[^"\n]*"|'[^'\n]*'|&quot;[^\n]*?&quot;|&#39;[^\n]*?&#39;|\[\]|[A-Za-z0-9_:+-]+(?:\.[A-Za-z0-9_:+-]+)*)`;
const assignmentValue = new RegExp(`^(\\s*=\\s*)(${scalar})`);

function pathLabel(value) {
  const parts = value.split("/").filter(Boolean);
  const last = parts.at(-1);
  const leaf =
    last === "title" && parts.includes("product")
      ? "商品名称"
      : last === "title" && parts.includes("video")
        ? "视频标题"
        : labelFor(last) || (last === "data" ? "来源数据" : missingLabel);
  const indexed = parts.findIndex(
    (p, i) => /^\d+$/.test(p) && collections.has(parts[i - 1]),
  );
  if (indexed < 0) return leaf;
  const row = `${labels[parts[indexed - 1]]}第${Number(parts[indexed]) + 1}条记录`;
  return indexed === parts.length - 1 ? row : `${row}的${leaf}`;
}
function assignment(key, label, value) {
  value = value.replace(/^(?:&quot;|&#39;|["'])|(?:&quot;|&#39;|["'])$/g, "");
  if (Object.hasOwn(flags, key) && /^(true|false)$/.test(value))
    return flags[key][Number(value === "true")];
  if (value === "[]") return `${label}：无返回记录`;
  if (value === "null") return `${label}：未提供`;
  const shown =
    key === "orderby"
      ? labelFor(value) || value
      : [
            "region",
            "currency_code",
            "shop_type_code",
            "commerce_type",
            "status",
          ].includes(key) && Object.hasOwn(enums, value)
        ? enums[value]
        : value;
  return `${label}：${shown}`;
}

function translatePart(input) {
  let text = input
    .replaceAll("\\_", "_")
    .replace(/`([^`\n]+)`/g, (whole, code, offset, original) =>
      /^\s*=/.test(original.slice(offset + whole.length))
        ? code
        : labelFor(code) || code,
    );
  text = text.replace(
    /\b(?:request\.notes|task\.json|result\.schema\.json|result\.json)\b/g,
    (key) =>
      ({
        "request.notes": "用户补充要求",
        "task.json": "研究要求",
        "result.schema.json": "报告格式要求",
        "result.json": "研究结果",
      })[key],
  );
  // Consume a pointer and its value together before replacing bare fields.
  // A list position is one-based for readers; it is never presented as a date.
  text = text.replace(
    new RegExp(
      `${pathPattern.source}(${assignmentValue.source.slice(1)})?`,
      "g",
    ),
    (whole) => {
      const pointer = whole.match(new RegExp(`^${pathPattern.source}`))[0];
      const rest = whole.slice(pointer.length).match(assignmentValue);
      const label = pathLabel(pointer);
      return rest
        ? assignment(pointer.split("/").at(-1), label, rest[2])
        : label;
    },
  );
  text = text.replace(
    new RegExp(`\\b([a-z][a-z0-9_]*)\\s*=\\s*(${scalar})`, "g"),
    (whole, key, value) =>
      labelFor(key) || key.includes("_")
        ? assignment(key, labelFor(key) || missingLabel, value)
        : whole,
  );
  text = text.replace(
    /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g,
    (key) => labelFor(key) || key,
  );
  return text
    .replace(
      /\bpage\s+(\d+)(\+)?/g,
      (_, page, more) => `第${page}页${more ? "及之后" : ""}`,
    )
    .replace(/\bnotes\b(?=\s*[\u3400-\u9fff])/g, "补充要求")
    .replace(/在售（在售）/g, "在售")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\bcreate_time\s+desc\b/g, "创建时间从近到远")
    .replace(/创建时间\s+desc\b/g, "创建时间从近到远")
    .replace(/\brating\s+asc\b/g, "评分从低到高")
    .replace(/评分\s+asc\b/g, "评分从低到高");
}

export function researchDisplayText(value) {
  // Source URLs and original link bytes remain usable, including underscores,
  // query parameters and JSON-pointer fragments inside a URL.
  return String(value ?? "")
    .split(urlPattern)
    .map((part, i) => (i % 2 ? part : translatePart(part)))
    .join("");
}

const narrativeFields = new Set([
  "title",
  "label",
  "summary",
  "body",
  "answer",
  "reason",
  "description",
  "notice",
  "source_note",
  "rationale",
  "limitations",
  "questions",
  "assumptions",
  "discrepancies",
  "sections",
]);
const opaqueFields = new Set([
  "value",
  "request",
  "input",
  "decoded",
  "envelope",
]);
export function specialistResultPresentation(value, field = "") {
  if (opaqueFields.has(field)) return value;
  if (typeof value === "string")
    return narrativeFields.has(field) ? researchDisplayText(value) : value;
  if (Array.isArray(value))
    return value.map((item) => specialistResultPresentation(item, field));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        specialistResultPresentation(item, key),
      ]),
    );
  return value;
}
