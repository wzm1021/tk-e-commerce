# 内容取数指南

| 需要 | 本地方法 | 用途与限制 |
| --- | --- | --- |
| 从商品找关联视频 | `products.videoList` | 支持 `is_ad` 和发布时间范围；统计窗与发布时间分开 |
| 从店铺找视频 | `shops.videoAnalysis` | 识别内容与店铺联系，核实指标作用域 |
| 从关键词/达人找视频 | `videos.search` | 需依 Schema 提供创建时间范围，不能默认全历史搜索 |
| 视频基础与关联商品 | `videos.detailAnalysis` | 核对视频身份、互动、关联商品；不假设有留存数据 |
| 随时间的互动变化 | `videos.dataTrends` | 日播放/互动趋势；不能假设包含日 GMV |
| 口播/字幕时间轴 | `videos.scriptInfo` | `video_id` 位于根层，非 `filter` 内 |
| 判断付费影响 | `advertising.dataOverview` | 同视频的投放表现，按假设选用 |
| 验证可说的商品事实 | `products.detailInfo` | 商家文案是来源声明，不能自动变成已证实效果 |

```sh
npm run fastmoss -- products.videoList '{"filter":{"product_id":"已解析的商品ID","time_range_days":28},"orderby":[{"field":"gmv","order":"desc"}],"page":1,"pagesize":10}'
npm run fastmoss -- videos.detailAnalysis '{"filter":{"video_id":"已解析的视频ID"}}'
npm run fastmoss -- videos.dataTrends '{"filter":{"video_id":"已解析的视频ID","time_range_days":28}}'
npm run fastmoss -- videos.scriptInfo '{"video_id":"已解析的视频ID"}'
```

## 取样与降级

- 先在同商品中按销售或播放选候选，再按相似发布时间、达人规模和广告状态寻找对照。目标是探索机制，不是从精选样本估计平台总体效果。
- 列表页最高 10 条；若要 20 个候选则逐页读取并去重，不传 `pagesize: 20`。
- `videos.search.filter.create_time_range` 使用 `min/max` Unix 时间戳；先核实单位和市场时间边界，再构造数值，不把毫秒默认当秒或反之。
- `videos.detailAnalysis` 未暴露日期筛选；详情中累计指标不能直接与某 7 天广告指标拼成效率比率。
- 如果没有同龄样本或可比日趋势，只做描述性对比并指出视频年龄偏差，不用累计播放量判定脚本优劣。
- 实际画面分析需要可访问的视频或用户提供的素材，并按可用浏览/媒体工具操作；FastMoss 字幕不是视频视觉证据。视频不可查看时继续口播分析和原创拍摄设计，标明边界。
