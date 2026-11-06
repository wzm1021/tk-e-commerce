import { FastMossBaseApi } from "../base-api.ts";
import type { FastMossInput } from "../generated-inputs.ts";

export class FastMossVideosApi extends FastMossBaseApi {
  dataTrends(input: FastMossInput<"video_data_trends">) {
    return this.call("video_data_trends", input);
  }

  detailAnalysis(input: FastMossInput<"video_detail_analysis">) {
    return this.call("video_detail_analysis", input);
  }

  scriptInfo(input: FastMossInput<"video_script_info">) {
    return this.call("video_script_info", input);
  }

  search(input: FastMossInput<"video_search"> = {}) {
    return this.call("video_search", input);
  }
}
