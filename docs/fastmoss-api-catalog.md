# FastMoss MCP 接口目录

清单依据 FastMoss 官方 MCP 配置文档与官方 CLI `v1.0.2` 内置静态目录整理，共 55 个工具。登录后的实时 Schema 可通过 `npm run fastmoss:sync-tools` 同步。

## 商品（12）

| MCP 工具 | 本地方法 |
| --- | --- |
| `product_category_info` | `products.categoryInfo` |
| `product_creator_analysis` | `products.creatorAnalysis` |
| `product_detail_info` | `products.detailInfo` |
| `product_investment` | `products.investment` |
| `product_overview` | `products.overview` |
| `product_rank_new_listed` | `products.rankNewListed` |
| `product_rank_top_selling` | `products.rankTopSelling` |
| `product_review_list` | `products.reviewList` |
| `product_sales_trend` | `products.salesTrend` |
| `product_search` | `products.search` |
| `product_sku` | `products.sku` |
| `product_video_list` | `products.videoList` |

## 达人（10）

| MCP 工具 | 本地方法 |
| --- | --- |
| `creator_cargo_summary` | `creators.cargoSummary` |
| `creator_data_trends` | `creators.dataTrends` |
| `creator_fans_distribution` | `creators.fansDistribution` |
| `creator_product_list` | `creators.productList` |
| `creator_profile_overview` | `creators.profileOverview` |
| `creator_rank_top_ecommerce` | `creators.rankTopEcommerce` |
| `creator_rank_top_growth` | `creators.rankTopGrowth` |
| `creator_rank_top_potential` | `creators.rankTopPotential` |
| `creator_search` | `creators.search` |
| `creator_video_analysis` | `creators.videoAnalysis` |

## 店铺（10）

| MCP 工具 | 本地方法 |
| --- | --- |
| `shop_base_info` | `shops.baseInfo` |
| `shop_creator_analysis` | `shops.creatorAnalysis` |
| `shop_data_trends` | `shops.dataTrends` |
| `shop_investment_analysis` | `shops.investmentAnalysis` |
| `shop_live_analysis` | `shops.liveAnalysis` |
| `shop_product_analysis` | `shops.productAnalysis` |
| `shop_rank_top_selling` | `shops.rankTopSelling` |
| `shop_sale_analysis` | `shops.saleAnalysis` |
| `shop_search` | `shops.search` |
| `shop_video_analysis` | `shops.videoAnalysis` |

## 机构 / MCN（7）

| MCP 工具 | 本地方法 |
| --- | --- |
| `agency_creator_analysis` | `agencies.creatorAnalysis` |
| `agency_product_analysis` | `agencies.productAnalysis` |
| `agency_product_list` | `agencies.productList` |
| `agency_profile_overview` | `agencies.profileOverview` |
| `agency_rank_top` | `agencies.rankTop` |
| `agency_search` | `agencies.search` |
| `agency_shop_analysis` | `agencies.shopAnalysis` |

## 视频、直播、广告（9）

| MCP 工具 | 本地方法 |
| --- | --- |
| `video_data_trends` | `videos.dataTrends` |
| `video_detail_analysis` | `videos.detailAnalysis` |
| `video_script_info` | `videos.scriptInfo` |
| `video_search` | `videos.search` |
| `live_detail_analysis` | `lives.detailAnalysis` |
| `live_products_list` | `lives.productsList` |
| `live_search` | `lives.search` |
| `ad_data_overview` | `advertising.dataOverview` |
| `ad_search` | `advertising.search` |

## 市场与辅助工具（7）

| MCP 工具 | 本地方法 |
| --- | --- |
| `market_category_analysis` | `market.categoryAnalysis` |
| `market_category_author_sales_matrix` | `market.categoryAuthorSalesMatrix` |
| `market_category_ranking` | `market.categoryRanking` |
| `credit_usage_summary` | `auxiliary.creditUsageSummary` |
| `fastmoss_detail_url_examples` | `auxiliary.detailUrlExamples` |
| `search_category_by_words` | `auxiliary.searchCategoryByWords` |
| `search_fastmoss_documents` | `auxiliary.searchDocuments` |

## 类型约定

- 每个方法直接使用 `FastMossInput<"工具名">`，类型来自实时 `tools/list` Schema。
- `generated-inputs.ts` 包含全部嵌套筛选字段、枚举、必填项、排序字段和分页参数。
- 每次运行 `npm run fastmoss:sync-tools` 都会同时更新 Schema 快照和精确输入类型。
- 每个工具的输出入口位于 `FastMossToolDataMap`，当前默认保留为 `JsonValue`。
- MCP 原始响应始终保存在返回值的 `raw` 字段，服务端 Schema 改变时不会丢数据。
