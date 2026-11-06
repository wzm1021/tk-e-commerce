import { FastMossBaseApi } from "../base-api.ts";
import type { FastMossInput } from "../generated-inputs.ts";

export class FastMossCreatorsApi extends FastMossBaseApi {
  cargoSummary(input: FastMossInput<"creator_cargo_summary">) {
    return this.call("creator_cargo_summary", input);
  }

  dataTrends(input: FastMossInput<"creator_data_trends">) {
    return this.call("creator_data_trends", input);
  }

  fansDistribution(input: FastMossInput<"creator_fans_distribution">) {
    return this.call("creator_fans_distribution", input);
  }

  productList(input: FastMossInput<"creator_product_list">) {
    return this.call("creator_product_list", input);
  }

  profileOverview(input: FastMossInput<"creator_profile_overview">) {
    return this.call("creator_profile_overview", input);
  }

  rankTopEcommerce(input: FastMossInput<"creator_rank_top_ecommerce"> = {}) {
    return this.call("creator_rank_top_ecommerce", input);
  }

  rankTopGrowth(input: FastMossInput<"creator_rank_top_growth"> = {}) {
    return this.call("creator_rank_top_growth", input);
  }

  rankTopPotential(input: FastMossInput<"creator_rank_top_potential"> = {}) {
    return this.call("creator_rank_top_potential", input);
  }

  search(input: FastMossInput<"creator_search"> = {}) {
    return this.call("creator_search", input);
  }

  videoAnalysis(input: FastMossInput<"creator_video_analysis">) {
    return this.call("creator_video_analysis", input);
  }
}
