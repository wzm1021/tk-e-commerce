import { FastMossBaseApi } from "../base-api.ts";
import type { FastMossInput } from "../generated-inputs.ts";

export class FastMossProductsApi extends FastMossBaseApi {
  categoryInfo() {
    return this.call("product_category_info");
  }

  creatorAnalysis(input: FastMossInput<"product_creator_analysis">) {
    return this.call("product_creator_analysis", input);
  }

  detailInfo(input: FastMossInput<"product_detail_info">) {
    return this.call("product_detail_info", input);
  }

  investment(input: FastMossInput<"product_investment">) {
    return this.call("product_investment", input);
  }

  overview(input: FastMossInput<"product_overview">) {
    return this.call("product_overview", input);
  }

  rankNewListed(input: FastMossInput<"product_rank_new_listed"> = {}) {
    return this.call("product_rank_new_listed", input);
  }

  rankTopSelling(input: FastMossInput<"product_rank_top_selling"> = {}) {
    return this.call("product_rank_top_selling", input);
  }

  reviewList(input: FastMossInput<"product_review_list"> = {}) {
    return this.call("product_review_list", input);
  }

  salesTrend(input: FastMossInput<"product_sales_trend"> = {}) {
    return this.call("product_sales_trend", input);
  }

  search(input: FastMossInput<"product_search"> = {}) {
    return this.call("product_search", input);
  }

  sku(input: FastMossInput<"product_sku">) {
    return this.call("product_sku", input);
  }

  videoList(input: FastMossInput<"product_video_list">) {
    return this.call("product_video_list", input);
  }
}
