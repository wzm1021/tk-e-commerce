import { additionalErrors, unknownError } from "./error-messages.mjs";
export const jobLabels = {
  scouting: "选品研究",
  competitor: "竞店增长拆解",
  monitoring: "竞店定时巡检",
  content: "内容与脚本实验",
  reviews: "评论与商品改进",
  ads: "广告与素材分析",
  diagnostics: "经营异动诊断",
  supply: "1688 货源匹配",
  economics: "利润情景研究",
  assistant: "商品对话助手",
};
export const stateLabels = {
  awaiting_connection: "待平台接入",
  queued: "排队中",
  running: "研究中",
  waiting_input: "待补资料",
  succeeded: "已完成",
  partial: "部分完成",
  failed: "未完成",
  cancelled: "已停止",
  reconciling: "待费用核对",
  watch: "观察",
  research: "研究",
  sample: "测样",
  test: "小测",
  approved: "已通过",
  rejected: "已否决",
  candidate: "候选货源",
  confirmed: "已确认",
  planned: "计划中",
  completed: "已完成",
  open: "待处理",
  doing: "进行中",
  done: "已完成",
  unverified: "待核验",
  passed: "通过",
};
export const money = (x) => (Number(x || 0) / 1e6).toFixed(4);
export const datetime = (x) =>
  x ? new Date(x).toLocaleString("zh-CN", { hour12: false }) : "—";
const errors = {
  body_too_large: "上传内容超过服务器限制，请缩小图片或文件后重试",
  service_unavailable: "服务暂时不可用，请稍后重试",
  request_failed: "请求失败，请稍后重试",
  invalid_response: "服务器返回异常，请刷新页面后重试",
  ai_pdf_translation_pending: "中文反馈仍在准备，请稍后下载完整报告",
  ai_pdf_image_missing: "报告截图暂时无法读取，请联系平台管理员",
  ai_report_missing: "测品报告尚未完成或无权访问",
  ai_suggestion_source_missing: "请先从候选商品导入该方案，再生成建议",
  ai_suggestion_stale: "商品已变化，请根据当前资料重新生成建议",
  ai_suggestion_not_ready: "建议尚未生成完成，请稍后再试",
  ai_suggestion_retry_later: "请等待 30 秒后再重试",
  ai_suggestion_field_invalid: "所选建议已变化，请重新载入后核对",
  ai_suggestion_missing: "未找到这条建议，请重新载入",
  ai_version_changed: "草稿已在另一处更新，请重新载入后核对",
  ai_draft_busy: "该草稿仍有进行中的测试，请等待结束或取消后再删除",
  ai_draft_missing: "草稿不存在或已删除，可在已删除草稿中恢复",
  ai_quota_integer_required: "测品次数须为 1 至 1,000,000 的整数",
  insufficient_ai_test_uses: "可用测品次数不足，请联系平台管理员分配次数",
  ai_viewport_mismatch:
    "自动截图使用了不同视口，请统一为桌面或移动页面后重新截图",
  ai_needs_info: "测试还缺少必要信息，请补充后重新确认",
  ai_audience_too_small: "符合条件的虚拟消费者不足，请放宽筛选或减少人数",
  ai_service_busy: "测品服务繁忙，请稍后重试",
  ai_confirmation_stale: "信息或截图已变化，请重新核对并确认",
  ai_image_required: "请为每个方案添加一张页面截图",
  ai_image_stale: "页面链接、商品或市场已变更，请重新截图或上传",
  ai_image_size: "截图不能为空，且不能超过 5 MB",
  ai_image_invalid: "请使用有效的 PNG、JPEG 或 WebP 静态截图",
  ai_crop_invalid: "裁剪区域超出图片，请核对像素范围",
  ai_product_required: "请补全每个方案的商品名称和当前售价",
  ai_use_required: "请填写商品用途或消费者要解决的问题",
  ai_problem_required: "不同用途的商品需要填写共同的消费者问题",
  ai_required_fields: "请填写测试名称和核心测试问题",
  ai_market_unsupported: "当前市场暂不支持 AI 测品",
  ai_market_mismatch: "导入商品的销售市场与当前测试不一致",
  ai_currency_mismatch: "币种与销售市场不一致，请核对",
  ai_pool_empty: "共享测品额度暂不可用，请联系平台管理员补充",
  ai_workspace_capacity: "当前空间已有 3 个在途测试，请稍后再试",
  ai_capture_capacity: "截图队列繁忙，请等待已有截图完成",
  ai_capture_disabled: "自动截图已停用，请手动上传商品页面截图",
  ai_capture_url: "请填写受支持市场的完整商品页面链接",
  ai_capture_identity: "链接中的商品 ID 与所填商品不一致",
  ai_account_busy: "该账号仍有在途任务，结算后才可修改",
  ai_account_unverified: "请先验证密钥，并核对累计试用次数",
  ai_account_invalid: "密钥未通过验证，请核对账号权限",
  ai_transport_uncertain: "正在核对提交状态，请勿重复发起测试",
  ai_reconciliation_required: "任务状态需要平台管理员核对，额度保持预留",
  ai_reconciliation_busy: "任务正在执行，请稍后核对",
  ai_remote_identity_mismatch: "任务归属不一致，不能关联",
  ai_sdk_unavailable: "测品服务运行环境尚未就绪，请联系管理员",
  ai_input_not_ready: "测试信息或受众条件不满足要求，请修改后复测",
  ai_result_invalid: "结果格式未通过核验，正在保留任务等待核对",
  ai_billing_unknown: "扣次状态待核对，暂不释放预留额度",
  disk_capacity: "服务器存储空间不足，请联系平台管理员处理后重试",
  sellersprite_secret_expired: "卖家精灵密钥已过期，请更新密钥后重新验证连接",
  sellersprite_product_tools_missing:
    "卖家精灵未开放商品研究接口，请检查密钥权限",
  overview_shop_missing: "此候选商品尚缺经核验的店铺资料，请先补充选品研究",
  overview_candidate_missing: "这件商品不在当前报告的候选列表中",
  overview_market_mismatch: "数据市场与候选店铺不一致，已停止展示该组数据",
  overview_shop_changed: "商品所属店铺与报告记录不一致，请重新核实",
  overview_sku_period_invalid: "商品规格支持近 7 天或 28 天",
  candidate_shop_missing:
    "这件商品的店铺 ID 或市场尚未核验，请补充选品研究后再添加监控",
  report_candidates_missing: "这份报告暂时没有可读取的候选商品",
  monitor_connection_missing:
    "巡检需要可用的数据API、模型和技能，请检查连接设置",
  monitor_monthly_model_budget:
    "本监控的月度模型预算已不足，调整预算或等待下月",
  monitor_monthly_data_budget: "本监控的月度数据预算已不足，调整预算或等待下月",
  monitor_running: "巡检任务尚未结束，请完成后再编辑规则",
  monitor_version_conflict: "规则已被更新，请重新打开后编辑",
  monitor_not_found: "未找到此竞店监控",
  monitor_duplicate: "这家店铺在当前市场已添加监控",
  monitor_archived: "该监控已归档",
  monitor_limit: "当前空间最多监控 50 家竞店",
  monitor_partial: "本轮部分数据不可用，请查看巡检记录中的原因",
  monitor_schedule_failed: "本轮未能入队，将在 1 小时后重试",
  monitor_context_required: "请从竞店监控模块创建巡检",
  monitor_event_not_found: "未找到此变化事件",
  ai_product_link_required: "请填写每款商品的商品页面链接，再确认测试。",
  ai_product_link_too_long:
    "商品链接仍然过长，请从商品详情页复制较短的链接，并保留所选商品、卖家和规格信息后重试。",
  ai_product_link_identity:
    "商品链接中的 ASIN 与填写的商品编号不一致，请核对后重试。",
  feedback_file_invalid: "附件内容无效或不支持该格式，请更换文件。",
  feedback_file_type: "支持 PNG、JPEG、WebP、PDF、DOCX、XLSX、TXT、CSV。",
  feedback_file_too_large: "单个附件不能超过 5 MB。",
  feedback_total_too_large: "全部附件合计不能超过 10 MB。",
  feedback_file_not_found: "附件不存在、已使用或无权访问，请重新上传。",
  feedback_email_required: "请先在设置中验证并绑定邮箱，再提交反馈。",
  feedback_not_found: "未找到这条反馈。",
  feedback_context_invalid: "关联页面已失效，请移除关联后重试。",
  feedback_submission_changed: "这条反馈已保存，请在我的反馈中查看。",
  feedback_upload_capacity: "今日附件上传量已达上限，请稍后再试。",
  feedback_mail_config_required: "请先保存负责人和销售收件邮箱。",
  feedback_retry_invalid: "当前邮件状态无需重试，请刷新状态。",
  feedback_delivery_uncertain: "发送结果不确定，请核对收件箱后再重试。",
  analytics_period_invalid: "请选择不超过 366 天的有效日期区间。",
  customer_not_found: "未找到该客户。",
  email_service_unavailable: "邮箱服务尚未配置，请联系平台管理员",
  email_delivery_failed: "验证码发送失败，请稍后重试",
  email_connection_failed: "无法连接邮件服务，请核对 SMTP 配置和授权码",
  mail_password_required: "请填写邮箱授权码",
  email_rate_limited: "验证码发送较频繁，请等待 60 秒；每小时最多 5 次",
  email_code_invalid: "验证码无效、已过期或尝试次数已用完，请重新发送",
  email_already_registered: "该邮箱已注册，请直接登录或找回密码",
  email_registration_required:
    "成员需要先完成邮箱注册，再由团队负责人或管理员添加",
  registered_member_required: "该邮箱尚未完成注册验证，请对方先注册账户",
  team_manager_required: "只有团队负责人和管理员可以执行此操作",
  team_owner_required: "此操作需要团队负责人权限",
  team_required: "请切换到团队空间后操作",
  team_seat_limit: "团队席位已满，请联系平台管理员扩容",
  team_creation_limit: "创建团队数量已达上限，请联系平台管理员",
  owner_transfer_required: "负责人不能直接移除或降级，请先转交负责人",
  member_not_found: "该成员不在当前团队中",
  subscription_inactive: "团队订阅待开通或已到期，请联系平台管理员",
  subscription_seats_below_members: "席位数不能少于当前成员人数",
  subscription_reference_conflict: "该订阅确认单号已用于不同内容",
  subscription_payment_kind: "实付订阅需填写正数金额，测试赠送金额必须为 0",
  keyword_generation_failed: "热词生成未完成，可重试（按实际模型用量计费）",
  keyword_output_incomplete: "模型输出未完成，可重试生成",
  model_unavailable: "所选模型未启用或未分配给当前空间，请重新选择",

  authentication_required: "请先登录",
  login_failed: "账号或密码不正确",
  csrf_invalid: "登录状态已更新，请重新登录",
  origin_forbidden: "当前访问地址未获授权",
  workspace_forbidden: "你没有该工作空间的权限",
  connection_not_ready: "平台连接尚未就绪",
  insufficient_model_micro_cny: "模型余额不足，请联系平台充值",
  invalid_resource_limits: "单租户并发上限不能超过共享并发上限",
  gateway_capacity: "平台当前请求较多，请稍后重试；未发起的调用不扣费",
  resource_queue_full: "共享资源等待队列已满，请稍后重试；未发起的调用不扣费",
  resource_queue_timeout: "共享资源排队超时，请稍后重试；未发起的调用不扣费",
  data_fetch_wait_timeout: "相同查询正在取数，请稍后重试",
  data_fetch_pending_reconciliation:
    "这项查询的供应商用量待核对，平台已暂停重复采购",
  reconcile_invocation_first: "请先在充值与账本中核对原调用费用，再解锁查询",
  invalid_data_points: "数据积分最多填写一位小数",
  insufficient_data_points: "数据积分不足，请联系平台充值",
  data_tool_price_unconfirmed:
    "该接口的实时查询单价尚未确认，请联系平台管理员；本次未扣费",
  data_response_unrecognized: "数据返回格式未能确认，预留积分待核对，尚未扣费",
  record_version_conflict: "该记录已被更新，请刷新后重试",
  duplicate_record: "这条记录已经存在",
  connection_not_verified: "请先验证连接",
  skill_publish_conflict: "技能版本已经变化，请刷新后发布",
  validation_error: "请检查填写的字段",
  "1688_documentation_required": "1688 接口仍待完整文档与权限核验",
  model_context_budget_exceeded: "请求超出任务上下文上限",
  unsupported_tool_namespace:
    "研究上下文整理时发生工具兼容错误，请联系平台处理；已完成调用按实际用量结算",
  task_budget_exhausted: "历史任务的预留额度已用完，已完成调用按实际用量结算",
  agent_execution_failed:
    "研究未完成，请联系平台查看执行记录；已确认的调用按实际用量结算",
  research_output_invalid: "模型结果格式未通过校验，已保留草稿与证据供修复",
  agent_deadline_exceeded: "研究超过本次执行时限，已保存可用的阶段结果",
  worker_lease_expired: "研究执行连接中断，已保存的资料需要恢复处理",
  late_usage_settled:
    "研究中断后的调用费用已结算，已有草稿待恢复；这不表示研究已完成",
  report_delivery_failed: "报告保存未完成，草稿和证据已保留，请联系平台恢复",
  worker_execution_failed: "研究执行服务发生异常，请联系平台检查任务记录",
  model_usage_missing: "模型供应商未返回完整用量，费用等待平台核对",
  model_response_timeout:
    "模型无反应：超过 600 秒（10 分钟）未返回完整结果，已停止等待；该次调用费用待核对，预留尚未释放",
  provider_transport_uncertain:
    "供应商响应中断，已确认的调用正常结算，其余费用等待平台核对",
  usage_unavailable: "供应商用量无法核验，费用等待平台核对",
  economics_input_invalid: "利润输入不完整或格式有误",
  invalid_1688_offer_url: "请填写与货品 ID 一致的 1688 详情链接",
  record_is_immutable: "测量和利润方案保存后不可覆盖，请新增版本",
  conversation_not_found: "对话不存在或当前工作空间无权访问",
  assistant_context_limit: "每个对话最多添加 10 项商品资料",
  assistant_context_too_large: "当前资料过多，请减少商品数量或缩短补充信息",
  assistant_output_invalid: "模型回答格式未通过校验，请重新提问",
  assistant_compaction_limit: "本轮压缩批次达到上限，请减少本轮资料后继续",
  assistant_compaction_invalid: "压缩摘要未通过校验，原始资料已保留",
  assistant_compaction_insufficient:
    "压缩后仍超出模型容量，请精简本轮问题或商品资料",
  assistant_memory_mismatch: "摘要与当前原文版本不一致，请刷新后重试",
  assistant_turn_active: "请等待当前问题完成，或先停止本轮",
  assistant_turn_limit: "此对话已达到 100 轮，请新建对话继续",
  assistant_conversation_required: "请从商品助手中发送问题",
  conversation_id_conflict: "创建请求已变化，请重新打开添加窗口",
};
export const errorLabel = (code) =>
  (Object.hasOwn(errors, code) && errors[code]) ||
  (Object.hasOwn(additionalErrors, code) && additionalErrors[code]) ||
  unknownError;

// Last display boundary for browser/file errors that do not go through the API.
export function errorText(value) {
  const message = typeof value === "string" ? value : value?.message;
  if (!message) return unknownError;
  if (
    Object.hasOwn(errors, message) ||
    Object.hasOwn(additionalErrors, message)
  )
    return errorLabel(message);
  if (
    /Failed to fetch|NetworkError|Load failed|fetch failed|network request/i.test(
      message,
    )
  )
    return errorLabel("network_error");
  if (/AbortError|aborted|cancelled/i.test(message))
    return errorLabel("request_aborted");
  if (/timeout|timed out/i.test(message)) return errorLabel("request_timeout");
  if (/NotReadableError|could not be read/i.test(message))
    return "文件读取失败，请重新选择文件后上传";
  return /[\u3400-\u9fff]/u.test(message) ? message : unknownError;
}
