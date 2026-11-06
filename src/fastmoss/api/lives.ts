import { FastMossBaseApi } from "../base-api.ts";
import type { FastMossInput } from "../generated-inputs.ts";

export class FastMossLivesApi extends FastMossBaseApi {
  detailAnalysis(input: FastMossInput<"live_detail_analysis">) {
    return this.call("live_detail_analysis", input);
  }

  productsList(input: FastMossInput<"live_products_list">) {
    return this.call("live_products_list", input);
  }

  search(input: FastMossInput<"live_search"> = {}) {
    return this.call("live_search", input);
  }
}
