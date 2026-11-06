import { BaseApi } from "../base-api.ts";
import type {
  CategoryInput,
  ClawecResponse,
  ProductCreatorAnalysisData,
  ProductDetailData,
  ProductIdentityInput,
  ProductInvestmentData,
  ProductOverviewData,
  ProductRankingData,
  ProductReviewData,
  ProductSalesTrendData,
  ProductSearchData,
  ProductSkuData,
  ProductVideoListData,
  ProductVideoListInput,
  RequiredSearchInput,
} from "../types.ts";

export class ProductsApi extends BaseApi {
  rankNewListed(
    input: CategoryInput = {},
  ): Promise<ClawecResponse<ProductRankingData>> {
    return this.call("aigc_ec_tiktok_data_product_rank_new_listed", input);
  }

  rankTopSelling(
    input: CategoryInput = {},
  ): Promise<ClawecResponse<ProductRankingData>> {
    return this.call("aigc_ec_tiktok_data_product_rank_top_selling", input);
  }

  videoList(
    input: ProductVideoListInput,
  ): Promise<ClawecResponse<ProductVideoListData>> {
    return this.call("aigc_ec_tiktok_data_product_video_list", input);
  }

  reviews(input: ProductIdentityInput): Promise<ClawecResponse<ProductReviewData>> {
    return this.call("aigc_ec_tiktok_data_product_review", input);
  }

  skus(input: ProductIdentityInput): Promise<ClawecResponse<ProductSkuData>> {
    return this.call("aigc_ec_tiktok_data_product_sku", input);
  }

  creatorAnalysis(
    input: ProductIdentityInput,
  ): Promise<ClawecResponse<ProductCreatorAnalysisData>> {
    return this.call("aigc_ec_tiktok_data_product_creator_analysis", input);
  }

  investment(
    input: ProductIdentityInput,
  ): Promise<ClawecResponse<ProductInvestmentData>> {
    return this.call("aigc_ec_tiktok_data_product_investment", input);
  }

  salesTrend(
    input: ProductIdentityInput,
  ): Promise<ClawecResponse<ProductSalesTrendData>> {
    return this.call("aigc_ec_tiktok_data_product_sales_trend", input);
  }

  overview(
    input: ProductIdentityInput,
  ): Promise<ClawecResponse<ProductOverviewData>> {
    return this.call("aigc_ec_tiktok_data_product_overview", input);
  }

  detail(input: ProductIdentityInput): Promise<ClawecResponse<ProductDetailData>> {
    return this.call("aigc_ec_tiktok_data_product_detail", input);
  }

  search(input: RequiredSearchInput): Promise<ClawecResponse<ProductSearchData>> {
    return this.call("aigc_ec_tiktok_data_product_search", input);
  }
}
