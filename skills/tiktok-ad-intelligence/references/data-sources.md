# 广告取数指南

| 需要 | 本地方法 | 关键限制 |
| --- | --- | --- |
| 搜索广告素材 | `advertising.search` | 关键词在 `filter` 中；搜索命中不是精确关联 |
| 单视频广告表现 | `advertising.dataOverview` | 以 `video_id` 查询，核对它是视频聚合而非单个广告行 |
| 商品投入/归因趋势 | `products.investment` | `ad_gmv` 是广告归因口径；仅有滚动天数参数 |
| 店铺投入/归因趋势 | `shops.investmentAnalysis` | 估算及日变化；支持日期范围 |
| 总销售背景 | `products.overview`、`shops.dataTrends` | 与广告窗和指标定义对齐 |
| 查店铺/商品关联视频 | `shops.videoAnalysis`、`products.videoList` | `is_ad` 过滤，不等于纯付费流量 |
| 素材事实 | `videos.detailAnalysis`、`videos.scriptInfo` | 字幕不能证明视觉内容 |

```sh
npm run fastmoss -- advertising.search '{"filter":{"keywords":"商品或店铺线索","region":"US","ad_type":1},"orderby":[{"field":"estimated_ad_spend","order":"desc"}],"page":1,"pagesize":10}'
npm run fastmoss -- advertising.dataOverview '{"filter":{"video_id":"已解析的视频ID","time_range_days":28}}'
npm run fastmoss -- products.investment '{"filter":{"product_id":"已解析的商品ID","time_range_days":28}}'
npm run fastmoss -- shops.investmentAnalysis '{"filter":{"seller_id":"已解析的店铺ID","time_range_days":28}}'
```

## 参数细节

- `advertising.search` 无精确 `seller_id` / `product_id` 筛选参数。根据返回的 shop/products/creator 实体确认关系，不仅凭关键词包含品牌名归类。
- `ad_type: 1` 表示 TikTok Shop 电商广告，2 是非电商/种草；不要将二者混成带货 ROAS 比较。
- `roas_range` 使用倍数，例如 2–5，不是 200–500；`estimated_ad_spend_range` 币种要查响应，不能默认所有市场均为美元。
- `video_create_date_range` 是发布时间，`last_seen_ad_date_range` 是最后被观察到投放时间。两者不定义广告指标统计窗。
- `advertising.dataOverview` 和 `shops.investmentAnalysis` 的天数枚举为 7/14/28/60/90/180，不接受描述中提到但枚举未允许的 -1；也支持 `start_date` / `end_date`。
- `products.investment` 只有 `product_id`、`time_range_days`，不能直接查询任意历史起止日。日序列覆盖不到的历史不伪造。
- `videos.scriptInfo` 使用根层 `video_id`。同一个视频被多条广告搜索记录引用时只取一次详情，记录聚合层级后再决定是否能汇总。

## 搜索覆盖

花费排序偏向已有投入的素材，补充较新或普通素材仅在比较需要时进行。来源缺失、关键词漏检、未观察到历史投放都可能导致覆盖不足；搜索结果不能代表整个广告账户资产库。
