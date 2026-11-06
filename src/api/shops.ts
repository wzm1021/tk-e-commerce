import { BaseApi } from "../base-api.ts";
import type {
  ClawecResponse,
  SearchInput,
  ShopBaseInfoData,
  ShopCreatorAnalysisData,
  ShopIdentityInput,
  ShopInvestmentData,
  ShopProductAnalysisData,
  ShopSaleAnalysisData,
  ShopSearchData,
  ShopTrendData,
} from "../types.ts";

export class ShopsApi extends BaseApi {
  investmentAnalysis(
    input: ShopIdentityInput,
  ): Promise<ClawecResponse<ShopInvestmentData>> {
    return this.call("aigc_ec_tiktok_data_shop_investment_analysis", input);
  }

  trends(input: ShopIdentityInput): Promise<ClawecResponse<ShopTrendData>> {
    return this.call("aigc_ec_tiktok_data_shop_data_trends", input);
  }

  search(input: SearchInput = {}): Promise<ClawecResponse<ShopSearchData>> {
    return this.call("aigc_ec_tiktok_data_shop_search", input);
  }

  creatorAnalysis(
    input: ShopIdentityInput,
  ): Promise<ClawecResponse<ShopCreatorAnalysisData>> {
    return this.call("aigc_ec_tiktok_data_shop_creator_analysis", input);
  }

  productAnalysis(
    input: ShopIdentityInput,
  ): Promise<ClawecResponse<ShopProductAnalysisData>> {
    return this.call("aigc_ec_tiktok_data_shop_product_analysis", input);
  }

  saleAnalysis(
    input: ShopIdentityInput,
  ): Promise<ClawecResponse<ShopSaleAnalysisData>> {
    return this.call("aigc_ec_tiktok_data_shop_sale_analysis", input);
  }

  baseInfo(
    input: ShopIdentityInput,
  ): Promise<ClawecResponse<ShopBaseInfoData>> {
    return this.call("aigc_ec_tiktok_data_shop_base_info", input);
  }
}
