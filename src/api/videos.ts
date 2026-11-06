import { BaseApi } from "../base-api.ts";
import type {
  ClawecResponse,
  SearchInput,
  VideoDetailData,
  VideoIdentityInput,
  VideoSearchData,
  VideoTrendData,
} from "../types.ts";

export class VideosApi extends BaseApi {
  detail(input: VideoIdentityInput): Promise<ClawecResponse<VideoDetailData>> {
    return this.call("aigc_ec_tiktok_data_video_detail", input);
  }

  trends(input: VideoIdentityInput): Promise<ClawecResponse<VideoTrendData>> {
    return this.call("aigc_ec_tiktok_data_video_data_trends", input);
  }

  search(input: SearchInput = {}): Promise<ClawecResponse<VideoSearchData>> {
    return this.call("aigc_ec_tiktok_data_video_search", input);
  }
}
