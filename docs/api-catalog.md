# MCP 接口与本地类型对照

该清单来自 2026-08-28 对数据源 `Tiktok接口 1.0.0` 的 `tools/list` 实际枚举，共 34 项。

> 服务没有发布 `outputSchema`。下表的输出类型是本地为每类数据预留的稳定类型入口；未知字段会原样保留为 `JsonValue`，获得真实样本后可在 `src/types.ts` 中逐步收紧。

## 视频（3）

| MCP 工具 | 本地方法 | 输入类型 | 输出数据类型 |
| --- | --- | --- | --- |
| `aigc_ec_tiktok_data_video_detail` | `videos.detail` | `VideoIdentityInput` | `VideoDetailData` |
| `aigc_ec_tiktok_data_video_data_trends` | `videos.trends` | `VideoIdentityInput` | `VideoTrendData` |
| `aigc_ec_tiktok_data_video_search` | `videos.search` | `SearchInput` | `VideoSearchData` |

## 达人（7）

| MCP 工具 | 本地方法 | 输入类型 | 输出数据类型 |
| --- | --- | --- | --- |
| `aigc_ec_tiktok_data_creator_fans_distribution` | `creators.fansDistribution` | `CreatorIdentityInput` | `CreatorFansDistributionData` |
| `aigc_ec_tiktok_data_creator_data_trends` | `creators.trends` | `CreatorIdentityInput` | `CreatorTrendData` |
| `aigc_ec_tiktok_data_creator_rank_top_ecommerce` | `creators.rankTopEcommerce` | `CreatorRankInput` | `CreatorRankData` |
| `aigc_ec_tiktok_data_creator_rank_top_ecommerce_20007005` | `creators.rankTopEcommerceLegacy` | `CreatorRankLegacyInput` | `CreatorRankData` |
| `aigc_ec_tiktok_data_creator_product_list` | `creators.productList` | `CreatorIdentityInput` | `CreatorProductListData` |
| `aigc_ec_tiktok_data_creator_profile` | `creators.profile` | `CreatorProfileInput` | `CreatorProfileData` |
| `aigc_ec_tiktok_data_creator_search` | `creators.search` | `SearchInput` | `CreatorSearchData` |

## 店铺（7）

| MCP 工具 | 本地方法 | 输入类型 | 输出数据类型 |
| --- | --- | --- | --- |
| `aigc_ec_tiktok_data_shop_investment_analysis` | `shops.investmentAnalysis` | `ShopIdentityInput` | `ShopInvestmentData` |
| `aigc_ec_tiktok_data_shop_data_trends` | `shops.trends` | `ShopIdentityInput` | `ShopTrendData` |
| `aigc_ec_tiktok_data_shop_search` | `shops.search` | `SearchInput` | `ShopSearchData` |
| `aigc_ec_tiktok_data_shop_creator_analysis` | `shops.creatorAnalysis` | `ShopIdentityInput` | `ShopCreatorAnalysisData` |
| `aigc_ec_tiktok_data_shop_product_analysis` | `shops.productAnalysis` | `ShopIdentityInput` | `ShopProductAnalysisData` |
| `aigc_ec_tiktok_data_shop_sale_analysis` | `shops.saleAnalysis` | `ShopIdentityInput` | `ShopSaleAnalysisData` |
| `aigc_ec_tiktok_data_shop_base_info` | `shops.baseInfo` | `ShopIdentityInput` | `ShopBaseInfoData` |

## 市场/类目（3）

| MCP 工具 | 本地方法 | 输入类型 | 输出数据类型 |
| --- | --- | --- | --- |
| `aigc_ec_tiktok_data_market_author_sales_matrix` | `market.authorSalesMatrix` | `RequiredCategoryInput` | `MarketAuthorSalesMatrixData` |
| `aigc_ec_tiktok_data_market_category_ranking` | `market.categoryRanking` | `RegionInput` | `MarketCategoryRankingData` |
| `aigc_ec_tiktok_data_market_category_analysis` | `market.categoryAnalysis` | `CategoryAnalysisInput` | `MarketCategoryAnalysisData` |

## 直播（3）

| MCP 工具 | 本地方法 | 输入类型 | 输出数据类型 |
| --- | --- | --- | --- |
| `aigc_ec_tiktok_data_live_products` | `lives.products` | `LiveIdentityInput` | `LiveProductsData` |
| `aigc_ec_tiktok_data_live_detail` | `lives.detail` | `LiveIdentityInput` | `LiveDetailData` |
| `aigc_ec_tiktok_data_live_search` | `lives.search` | `SearchInput` | `LiveSearchData` |

## 商品（11）

| MCP 工具 | 本地方法 | 输入类型 | 输出数据类型 |
| --- | --- | --- | --- |
| `aigc_ec_tiktok_data_product_rank_new_listed` | `products.rankNewListed` | `CategoryInput` | `ProductRankingData` |
| `aigc_ec_tiktok_data_product_rank_top_selling` | `products.rankTopSelling` | `CategoryInput` | `ProductRankingData` |
| `aigc_ec_tiktok_data_product_video_list` | `products.videoList` | `ProductVideoListInput` | `ProductVideoListData` |
| `aigc_ec_tiktok_data_product_review` | `products.reviews` | `ProductIdentityInput` | `ProductReviewData` |
| `aigc_ec_tiktok_data_product_sku` | `products.skus` | `ProductIdentityInput` | `ProductSkuData` |
| `aigc_ec_tiktok_data_product_creator_analysis` | `products.creatorAnalysis` | `ProductIdentityInput` | `ProductCreatorAnalysisData` |
| `aigc_ec_tiktok_data_product_investment` | `products.investment` | `ProductIdentityInput` | `ProductInvestmentData` |
| `aigc_ec_tiktok_data_product_sales_trend` | `products.salesTrend` | `ProductIdentityInput` | `ProductSalesTrendData` |
| `aigc_ec_tiktok_data_product_overview` | `products.overview` | `ProductIdentityInput` | `ProductOverviewData` |
| `aigc_ec_tiktok_data_product_detail` | `products.detail` | `ProductIdentityInput` | `ProductDetailData` |
| `aigc_ec_tiktok_data_product_search` | `products.search` | `RequiredSearchInput` | `ProductSearchData` |

## 标识符获取顺序

- 只有关键词时，先调用对应 `search`：商品拿 `productId`、达人拿 `uid`、店铺拿 `sellerId`、视频拿 `videoId`、直播拿 `roomId`。
- 类目接口使用 `TIKTOK_PRIMARY_CATEGORIES` 中的一级类目 ID；`market.categoryAnalysis` 也接受一至三级的 `categoryPath`。
- 所有标识符都使用字符串保存，避免 JavaScript 对长整型 ID 的精度损失。
