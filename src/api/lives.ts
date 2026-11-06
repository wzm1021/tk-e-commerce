import { BaseApi } from "../base-api.ts";
import type {
  ClawecResponse,
  LiveDetailData,
  LiveIdentityInput,
  LiveProductsData,
  LiveSearchData,
  SearchInput,
} from "../types.ts";

export class LivesApi extends BaseApi {
  products(input: LiveIdentityInput): Promise<ClawecResponse<LiveProductsData>> {
    return this.call("aigc_ec_tiktok_data_live_products", input);
  }

  detail(input: LiveIdentityInput): Promise<ClawecResponse<LiveDetailData>> {
    return this.call("aigc_ec_tiktok_data_live_detail", input);
  }

  search(input: SearchInput = {}): Promise<ClawecResponse<LiveSearchData>> {
    return this.call("aigc_ec_tiktok_data_live_search", input);
  }
}
