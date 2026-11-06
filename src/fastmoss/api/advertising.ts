import { FastMossBaseApi } from "../base-api.ts";
import type { FastMossInput } from "../generated-inputs.ts";

export class FastMossAdvertisingApi extends FastMossBaseApi {
  dataOverview(input: FastMossInput<"ad_data_overview">) {
    return this.call("ad_data_overview", input);
  }

  search(input: FastMossInput<"ad_search"> = {}) {
    return this.call("ad_search", input);
  }
}
