import { FastMossBaseApi } from "../base-api.ts";
import type { FastMossInput } from "../generated-inputs.ts";

export class FastMossAgenciesApi extends FastMossBaseApi {
  creatorAnalysis(input: FastMossInput<"agency_creator_analysis">) {
    return this.call("agency_creator_analysis", input);
  }

  productAnalysis(input: FastMossInput<"agency_product_analysis">) {
    return this.call("agency_product_analysis", input);
  }

  productList(input: FastMossInput<"agency_product_list">) {
    return this.call("agency_product_list", input);
  }

  profileOverview(input: FastMossInput<"agency_profile_overview">) {
    return this.call("agency_profile_overview", input);
  }

  rankTop(input: FastMossInput<"agency_rank_top">) {
    return this.call("agency_rank_top", input);
  }

  search(input: FastMossInput<"agency_search">) {
    return this.call("agency_search", input);
  }

  shopAnalysis(input: FastMossInput<"agency_shop_analysis">) {
    return this.call("agency_shop_analysis", input);
  }
}
