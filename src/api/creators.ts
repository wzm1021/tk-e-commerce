import { BaseApi } from "../base-api.ts";
import type {
  ClawecResponse,
  CreatorFansDistributionData,
  CreatorIdentityInput,
  CreatorProductListData,
  CreatorProfileData,
  CreatorProfileInput,
  CreatorRankData,
  CreatorRankInput,
  CreatorRankLegacyInput,
  CreatorSearchData,
  CreatorTrendData,
  SearchInput,
} from "../types.ts";

export class CreatorsApi extends BaseApi {
  fansDistribution(
    input: CreatorIdentityInput,
  ): Promise<ClawecResponse<CreatorFansDistributionData>> {
    return this.call("aigc_ec_tiktok_data_creator_fans_distribution", input);
  }

  trends(input: CreatorIdentityInput): Promise<ClawecResponse<CreatorTrendData>> {
    return this.call("aigc_ec_tiktok_data_creator_data_trends", input);
  }

  rankTopEcommerce(
    input: CreatorRankInput = {},
  ): Promise<ClawecResponse<CreatorRankData>> {
    return this.call("aigc_ec_tiktok_data_creator_rank_top_ecommerce", input);
  }

  /** 服务端的历史重复接口，参数使用 snake_case；保留以兼容现有 MCP。 */
  rankTopEcommerceLegacy(
    input: CreatorRankLegacyInput,
  ): Promise<ClawecResponse<CreatorRankData>> {
    return this.call(
      "aigc_ec_tiktok_data_creator_rank_top_ecommerce_20007005",
      input,
    );
  }

  productList(
    input: CreatorIdentityInput,
  ): Promise<ClawecResponse<CreatorProductListData>> {
    return this.call("aigc_ec_tiktok_data_creator_product_list", input);
  }

  profile(
    input: CreatorProfileInput,
  ): Promise<ClawecResponse<CreatorProfileData>> {
    return this.call("aigc_ec_tiktok_data_creator_profile", input);
  }

  search(input: SearchInput = {}): Promise<ClawecResponse<CreatorSearchData>> {
    return this.call("aigc_ec_tiktok_data_creator_search", input);
  }
}
