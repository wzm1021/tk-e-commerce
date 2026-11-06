# 竞店取数指南

| 需要回答的问题 | 本地方法 | 取数后的检查 |
| --- | --- | --- |
| 店铺是谁、属于哪个市场 | `shops.search`、`shops.baseInfo` | `seller_id`、店型、地区；基础信息含累计指标 |
| 店铺何时增长 | `shops.dataTrends` | 日 GMV/销量及内容/达人等实际可用趋势，检查完整日期 |
| 当前靠什么渠道销售 | `shops.saleAnalysis` | 渠道与内容结构分别保留 |
| 哪些商品值得深挖 | `shops.productAnalysis` | 当前商品列表、品类/价格带；匹配排序窗 |
| 核心商品的历史增量 | `products.salesTrend`、`products.overview` | 商品日序列与店铺周期一致 |
| 达人结构 | `shops.creatorAnalysis` | 当前合作名单、达人分层，非自动获得历史增量 |
| 内容/直播线索 | `shops.videoAnalysis`、`shops.liveAnalysis` | 关联关系、发布时间、实际绩效窗 |
| 广告是否伴随增长 | `shops.investmentAnalysis` | 估算投入和广告归因销售，不能当增量因果贡献 |
| 类目背景/竞店发现 | `market.categoryAnalysis`、`shops.rankTopSelling` | 类目层级、市场、已结束排行周期 |

## 可直接套用的参数形状

从项目根目录执行，下列 ID 由解析后的实际字符串替换：

```sh
npm run fastmoss -- shops.search '{"keywords":"店铺名","filter":{"region":"US"},"page":1,"pagesize":10}'
npm run fastmoss -- shops.dataTrends '{"filter":{"seller_id":"已解析的店铺ID","time_range_days":28}}'
npm run fastmoss -- shops.saleAnalysis '{"filter":{"seller_id":"已解析的店铺ID","time_range_days":7}}'
npm run fastmoss -- shops.productAnalysis '{"filter":{"seller_id":"已解析的店铺ID","time_range_days":7},"orderby":[{"field":"day7_gmv","order":"desc"}],"page":1,"pagesize":10}'
```

这些示例表达参数结构，不证明响应覆盖完整日，也不保证字段齐全。实际调用前依当前 Schema 检查。

## 历史能力限制

- `shops.dataTrends` 支持 `start_date` / `end_date`；`shops.saleAnalysis` 只支持 `time_range_days` 为 7/28/90，不能查询任意基期结构。
- `shops.productAnalysis` 的统计窗为 7/28/90；商品上架日期筛选与销售统计期不同。上架起止日期按当前快照最晚只能到四天前，不能用来判断最近三天是否没有上新。
- `shops.creatorAnalysis` 为 7/28/90/-1；`shops.videoAnalysis` 的发布时间范围和统计窗分开。缺失历史达人/视频列表时，只提供当前关系线索。
- `products.salesTrend` 需要 `product_id` 与 `time_range_days`，没有任意日期参数；覆盖的日数据可用于构造目标比较期。
- 发现层默认一页；先检查本期和可得的基期候选，避免只看本期榜首漏掉下滑商品。过去上榜而当前消失不视作零销售。
