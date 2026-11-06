import { FastMossBaseApi } from "../base-api.ts";
import type { FastMossInput } from "../generated-inputs.ts";

export class FastMossShopsApi extends FastMossBaseApi {
  baseInfo(input: FastMossInput<"shop_base_info">) {
    return this.call("shop_base_info", input);
  }

  creatorAnalysis(input: FastMossInput<"shop_creator_analysis">) {
    return this.call("shop_creator_analysis", input);
  }

  dataTrends(input: FastMossInput<"shop_data_trends">) {
    return this.call("shop_data_trends", input);
  }

  investmentAnalysis(input: FastMossInput<"shop_investment_analysis">) {
    return this.call("shop_investment_analysis", input);
  }

  liveAnalysis(input: FastMossInput<"shop_live_analysis">) {
    return this.call("shop_live_analysis", input);
  }

  productAnalysis(input: FastMossInput<"shop_product_analysis">) {
    return this.call("shop_product_analysis", input);
  }

  rankTopSelling(input: FastMossInput<"shop_rank_top_selling"> = {}) {
    return this.call("shop_rank_top_selling", input);
  }

  saleAnalysis(input: FastMossInput<"shop_sale_analysis">) {
    return this.call("shop_sale_analysis", input);
  }

  search(input: FastMossInput<"shop_search"> = {}) {
    return this.call("shop_search", input);
  }

  videoAnalysis(input: FastMossInput<"shop_video_analysis">) {
    return this.call("shop_video_analysis", input);
  }
}
