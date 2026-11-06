import { FastMossBaseApi } from "../base-api.ts";
import type { FastMossInput } from "../generated-inputs.ts";

export class FastMossMarketApi extends FastMossBaseApi {
  categoryAnalysis(input: FastMossInput<"market_category_analysis">) {
    return this.call("market_category_analysis", input);
  }

  categoryAuthorSalesMatrix(
    input: FastMossInput<"market_category_author_sales_matrix"> = {},
  ) {
    return this.call("market_category_author_sales_matrix", input);
  }

  categoryRanking(input: FastMossInput<"market_category_ranking"> = {}) {
    return this.call("market_category_ranking", input);
  }
}
