# 经营诊断取数指南

## 起步与按需深挖

| 假设/检查 | 本地方法 | 能与不能回答的内容 |
| --- | --- | --- |
| 店铺身份与日变化 | `shops.search`、`shops.baseInfo`、`shops.dataTrends` | 识别店铺与完整趋势；基础信息可能为累计值 |
| 商品身份与日变化 | `products.search`、`products.detailInfo`、`products.salesTrend` | 检查 GMV/销量；日缺口不补零 |
| 商品贡献变化 | `shops.productAnalysis` 后对候选调用 `products.salesTrend` | 当前列表用于找线索，历史贡献依赖商品日趋势 |
| 渠道结构 | `shops.saleAnalysis`、`products.overview` | 有对应基期才做渠道变化；当前份额不代替历史 |
| 达人活动变化 | `shops.creatorAnalysis`、`products.creatorAnalysis`、`creators.dataTrends` | 核实统计期与指标是否针对目标商品/店铺 |
| 内容变化 | `shops.videoAnalysis`、`products.videoList`、`videos.dataTrends` | 互动趋势不是订单趋势，核实发布时间和投放状态 |
| 直播变化 | `shops.liveAnalysis`、`lives.detailAnalysis` | 场次与绩效；无匹配历史不计算直播贡献变化 |
| 广告变化 | `shops.investmentAnalysis`、`products.investment` | 估算投入与归因销售，不是增量效果 |
| SKU/买家线索 | `products.sku`、`products.reviewList` | 仅在假设需要时；不等于真实库存/退款数据 |
| 行业共同变化 | `market.categoryAnalysis` | 保持市场、类目层级和周期可比 |

```sh
npm run fastmoss -- shops.dataTrends '{"filter":{"seller_id":"已解析的店铺ID","time_range_days":28}}'
npm run fastmoss -- products.salesTrend '{"filter":{"product_id":"已解析的商品ID","time_range_days":28}}'
npm run fastmoss -- products.overview '{"filter":{"product_id":"已解析的商品ID","time_range_days":28}}'
```

## 时间与结构限制

- `shops.dataTrends` 和 `products.overview` 支持日期范围；`products.salesTrend` 只支持滚动天数。从实际日数据选出完整的目标期，覆盖不到时说明限制。
- `shops.saleAnalysis` 只有 7/28/90；`shops.productAnalysis` 也是这些统计窗，均无通用历史起止日期。没有历史快照时，不能要求同一接口返回上一个任意周期。
- 不用“28 天累计减 7 天累计”冒充前一个 7 天；即使做差有效，也得到 21 天且要验证截止时点与口径一致。
- `products.creatorAnalysis` 只有商品 ID 等列表参数，没有任意时间窗。其达人累计业绩与目标商品贡献要分开，不能替代两个周期的合作变化。
- `videos.dataTrends` 发布的是日播放、点赞、评论、分享等互动趋势说明；不要从接口名推断有日 GMV。
- 类目分析按完成的排行周期查询，其周期与自定义诊断期不重合时只能作为背景，不能参与精确差分。

## 后台证据的最小补充

只针对仍在影响结论的假设索取：

- 怀疑缺货：SKU 级库存与缺货起止时间，关联商品映射。
- 怀疑流量/转化变化：同窗曝光、点击、订单及口径；观看量不足以补全漏斗。
- 怀疑价格/促销/组合变化：订单行实际成交价、数量、折扣与商品 ID。
- 怀疑退款/履约/处罚：对应事件与状态时间、口径明确的订单/退款数据或平台通知。
- 怀疑投放效率：实际花费、归因窗口与同窗广告指标。

用户未提供时保留假设，说明什么观察会支持或否定它；不要停止所有可完成的 FastMoss 分析。
