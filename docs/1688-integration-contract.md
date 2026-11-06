# 1688 后续接入合同

状态：**尚未接入实时 1688 服务**。本文定义本项目接入点，不是已验证的远端 API 文档。后续提供 key 后，再确认具体产品、权限和正式文档；不能假设单一 API key 足够，官方方案可能使用应用密钥、签名及用户授权。

用户指定方案：[solutionKey=1697015659372 的 API 与消息列表](https://open.1688.com/solution/solutionDetail.htm?solutionKey=1697015659372#apiAndMessageList)。2026-09-05 已尝试读取：网页读取失败，浏览器随后被站点安全策略阻止，未获得页面清单。后续以用户粘贴/导出的该方案文档或允许访问的正式资料核验接口，不通过替代浏览器或隐蔽请求绕过限制。收到方案链接不代表已经验证全部接口，也不代表账户已经获得权限。

## 用户随后提供的具体接口

已从用户给出的文档 URL 的 `id` 参数提取以下标识，登记在 [1688-tools.pending.json](../schemas/1688-tools.pending.json)。这是接口身份登记，不是已读取参数/响应或成功调用的 Schema 快照。

| 能力 | 命名空间 | API 名称 | 版本 |
| --- | --- | --- | --- |
| 基础图片搜索 | com.alibaba.fenxiao.crossborder | product.search.imageQueryBasic | 1 |
| 跨境商品详情 | com.alibaba.product | alibaba.cross.productInfo | 1 |

图搜文档：[product.search.imageQueryBasic](https://open.1688.com/api/apidocdetail.htm?id=com.alibaba.fenxiao.crossborder%3Aproduct.search.imageQueryBasic-1&aopApiCategory=category_new)。详情文档：[alibaba.cross.productInfo](https://open.1688.com/api/apidocdetail.htm?id=com.alibaba.product%3Aalibaba.cross.productInfo-1&aopApiCategory=category_new)。链接已移除追踪参数及末尾中文标点，未尝试绕过浏览器限制访问。

关键词搜索、图片上传、包装字段和 SKU 字段尚未由可读取文档核验；不借用相似 API 的字段。后续优先对接这两个已指定接口，关键词搜索可作为额外能力按需补齐。

## 已确认的能力与未确认项

1688 官方跨境方案明确包含商品货盘、状态同步、图搜和词搜。官方协议也有准入、完整 API/SDK 接入及数据回传要求，内部选品场景是否可单独开通应依实际方案核实。

来源：[官方开放平台](https://aop.alibaba.com/)、[跨境综合解决方案协议](https://terms.alicdn.com/legal-agreement/terms/b_end_product_protocol/20231024161027594/20231024161027594.html)；本项目文档核实日 2026-09-05。除上表中从用户链接取得的两个接口标识外，尚未确认：请求路径、鉴权、图片上传条件、字段和单位、分页、价格、限流、搜索货盘覆盖、重量尺寸完整率。不可将博客中的接口名写入真实客户端。

## 接入顺序

1. 确认服务属于 1688 官方或用户选择的供应商，获取对应文档、业务权限与一份脱敏响应。仅把凭据保存在忽略的 `.env`，不要求用户将 secret 贴入报告。
2. 用少量已知商品验证图片搜索、词搜与详情；核对搜索命中只是相似候选，价格需定位 SKU/采购数量。
3. 保存有日期的远端 Schema 或字段映射和业务错误样本。明确哪些字段为估算、缺失或品池限制。
4. 实现图搜/词搜/详情客户端及必要的鉴权；通过单测和少量真实查询后，再接入批量编排。
5. 将响应归一化为 `tiktok-supplier-matching` 的 `supplier_results`，使用现有离线批处理验证并保留来源。

## 本项目内部边界

| 内部操作 | 依赖 | 完成标准 |
| --- | --- | --- |
| search by image | 图片上传或可接受 URL、合法权限 | 返回候选 offer 与真实来源、可区分空结果/错误 |
| search by words | 关键词、市场或品池范围 | 参数与分页经过验证 |
| read offer detail | offer ID | 返回可定位的 SKU、采购数量阶梯与计价单位；无字段则 null |
| batch orchestration | 上述操作 | 每项持久状态、去重缓存、有界重试与额度限制 |

内部操作名称不对应任何已确定的远端接口名。当前 `prepare_batch.mjs` 的 `offline_preparation` 标记始终表示本地整理，不能改称 `live` 来掩盖接入缺失。

## 利润输入边界

来自 1688 的报价和包装记录必须附 offer/SKU、单位、采集日期、来源及未知项。它们映射到利润方案的采购成本和 `shipping.parcel`，商家记录用 `basis: supplier`；用户实测用 `basis: measured`，两者分别留存。

新增供应商 API 不负责确定物流合同、平台扣费政策或真实净利润，也不自动执行采购付款。
