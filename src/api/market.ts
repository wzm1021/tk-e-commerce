import { BaseApi } from "../base-api.ts";
import type {
  CategoryAnalysisInput,
  ClawecResponse,
  MarketAuthorSalesMatrixData,
  MarketCategoryAnalysisData,
  MarketCategoryRankingData,
  RegionInput,
  RequiredCategoryInput,
} from "../types.ts";

export class MarketApi extends BaseApi {
  authorSalesMatrix(
    input: RequiredCategoryInput,
  ): Promise<ClawecResponse<MarketAuthorSalesMatrixData>> {
    return this.call("aigc_ec_tiktok_data_market_author_sales_matrix", input);
  }

  categoryRanking(
    input: RegionInput = {},
  ): Promise<ClawecResponse<MarketCategoryRankingData>> {
    return this.call("aigc_ec_tiktok_data_market_category_ranking", input);
  }

  categoryAnalysis(
    input: CategoryAnalysisInput,
  ): Promise<ClawecResponse<MarketCategoryAnalysisData>> {
    return this.call("aigc_ec_tiktok_data_market_category_analysis", input);
  }
}
