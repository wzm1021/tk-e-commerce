# 亚马逊数据接入合同

本版本参考本机 `e-commerce` 的 SellerSprite 注册表、normalization.py、metrics/product.py 和关键词/价格市场研究方法。保存的能力目录在 `schemas/sellersprite-capabilities.json`，其中 runtime_name 为空的能力不开放；未复制密钥或历史业务数据。

当前实现为 SellerSprite MCP 适配器，端点 `https://mcp.sellersprite.com/mcp`，凭据由平台加密存储并由网关注入 `secret-key` 请求头（[官方接入说明](https://open.sellersprite.com/mcp/16)，2026-09-20 核对），不进入 Agent、前端、技能或日志。当前接入供获授权的个人 Demo 验证；沿用参考项目边界：多人、公开实时查询和商业系统集成须先取得正式 API 文档/权限及授权，不能把 MCP 可连接当成已满足商业接入条件。正式 API 尚未实现。

管理员创建独立 sellersprite 连接，验证时调用 tools/list（支持分页），仅开放参考注册表中已有运行时名称的只读能力，使用真实 inputSchema 校验并固定到任务快照。不从名称推断参数，不把全部目录自动开放。没有可用的商品搜索工具时验证失败；未验证/未启用/未绑定连接时研究进入等待接入状态，不回退到 FastMoss。

调用复用现有授权、并发、计费、幂等、数据缓存、原始响应与证据归档。SellerSprite 快照默认不跨租户共享；共享须通过管理员现有配置。缓存使用独立连接 ID、配置、参数和 Schema 隔离。积分沿用平台当前销售规则，不表示供应商实际成本。

电商事实只来自 SellerSprite；销量、收入、搜索量继续标估算。派生评分/集中度属于样本统计，不是独立来源。父体估算不得按子体重复加总。不同站点、币种、周期不混算。未知字段和费用不静默填零。事实字段转换在服务端保留原始值和证据路径；未识别别名保持缺失，后续扩展需要真实响应契约测试。

2026-09-20 已完成小范围真实工具目录及商品取数验证，详见 [部署验收记录](../platform/docs/amazon-deployment-2026-09-20.md)。SellerSprite 正常工具目录可能同时包含凭据错误提示工具，不能仅凭其名称出现就判定密钥无效；实际商品成功响应 code=OK 仅按 SellerSprite 来源识别。商品列表的 units/revenue 为月度估算，父体 parent、评分数 ratings、卖家数 sellers 按真实字段保存原值和路径。fixture 测试仍不能替代未来接口变化后的真实验收。

## 日销量补充（2026-09-20）

已审查并开放 `asin_prediction`，输入按实时 Schema 的 `marketplace`、`asin`；[官方字段文档](https://open.sellersprite.com/api/27) 的 `data.asinDetail.asin` 用于身份核验，`dailyItemList[].date/sales/bsr` 是逐日估算，`monthItemList` 不作日销量。结合归档请求核验站点，按来源日期而非任意时区转换，排除取数当日及未来日期，重复日期视为缺口。按前一自然日和七天前的同日计算变化；缺日不补零、基期为零不计算百分比。该接口未承诺父子变体销售归属，界面必须保留口径待核验说明。

新增 CLI `platform/scripts/supplement-amazon-daily.mjs` 可为指定报告内的单个 ASIN 补查一次。创建独立、幂等的补查任务，冻结当前已验证目录，走正式网关的授权、资源控制、快照、积分和证据归档；不调用模型、不修改原任务冻结快照。补查任务通过同租户且明确绑定原报告的记录加载，重渲染保留旧 HTML。失败或结果不确定不能自动重新采购。
