import type { JsonObject, JsonValue } from "../types.ts";
import type { McpCallToolResult } from "../mcp-client.ts";

export type FastMossLanguage = "EN_US" | "ZH_CN";

export interface FastMossSortRule extends JsonObject {
  field?: string;
  order?: "asc" | "desc" | (string & {});
}

export interface FastMossPageInput extends JsonObject {
  filter?: JsonObject;
  orderby?: FastMossSortRule[];
  page?: number;
  pagesize?: number;
}

export interface FastMossRequiredFilterInput extends JsonObject {
  filter: JsonObject;
}

export interface FastMossRequiredFilterPageInput extends FastMossPageInput {
  filter: JsonObject;
}

export interface FastMossSearchInput extends FastMossPageInput {
  keywords?: string;
  lang?: FastMossLanguage;
}

export interface FastMossLanguageInput extends JsonObject {
  filter?: JsonObject;
  lang?: FastMossLanguage;
}

export interface FastMossRequiredFilterLanguageInput
  extends FastMossRequiredFilterInput {
  lang?: FastMossLanguage;
}

export interface FastMossRequiredFilterLanguagePageInput
  extends FastMossRequiredFilterPageInput {
  lang?: FastMossLanguage;
}

export type FastMossCategoryAnalysisType =
  | "basic_metrics"
  | "sales_trends"
  | "price_distribution";

export interface FastMossCategoryAnalysisInput
  extends FastMossRequiredFilterLanguageInput {
  analysis_type: FastMossCategoryAnalysisType;
}

export interface FastMossVideoScriptInput extends JsonObject {
  video_id: string;
}

export interface FastMossCategoryWordsInput extends JsonObject {
  query: string | string[];
  max_total_results?: number;
  top_k?: number;
}

export interface FastMossDocumentSearchInput extends JsonObject {
  query: string | string[];
  source_file?: string;
  top_k?: number;
}

export interface FastMossToolResponse<TData = JsonValue> {
  /** structuredContent 优先，否则为 content[].text 解析后的 JSON/文本。 */
  data: TData;
  /** 完整 MCP 工具响应，便于审计与适配服务端 Schema 变化。 */
  raw: McpCallToolResult;
}

// 官方当前未公开无需登录即可下载的 outputSchema。
// 每个工具都保留独立映射项，取得真实样本后只需收紧对应 value 类型。
export interface FastMossToolDataMap {
  ad_data_overview: JsonValue;
  ad_search: JsonValue;
  agency_creator_analysis: JsonValue;
  agency_product_analysis: JsonValue;
  agency_product_list: JsonValue;
  agency_profile_overview: JsonValue;
  agency_rank_top: JsonValue;
  agency_search: JsonValue;
  agency_shop_analysis: JsonValue;
  creator_cargo_summary: JsonValue;
  creator_data_trends: JsonValue;
  creator_fans_distribution: JsonValue;
  creator_product_list: JsonValue;
  creator_profile_overview: JsonValue;
  creator_rank_top_ecommerce: JsonValue;
  creator_rank_top_growth: JsonValue;
  creator_rank_top_potential: JsonValue;
  creator_search: JsonValue;
  creator_video_analysis: JsonValue;
  product_category_info: JsonValue;
  product_creator_analysis: JsonValue;
  product_detail_info: JsonValue;
  product_investment: JsonValue;
  product_overview: JsonValue;
  product_rank_new_listed: JsonValue;
  product_rank_top_selling: JsonValue;
  product_review_list: JsonValue;
  product_sales_trend: JsonValue;
  product_search: JsonValue;
  product_sku: JsonValue;
  product_video_list: JsonValue;
  shop_base_info: JsonValue;
  shop_creator_analysis: JsonValue;
  shop_data_trends: JsonValue;
  shop_investment_analysis: JsonValue;
  shop_live_analysis: JsonValue;
  shop_product_analysis: JsonValue;
  shop_rank_top_selling: JsonValue;
  shop_sale_analysis: JsonValue;
  shop_search: JsonValue;
  shop_video_analysis: JsonValue;
  market_category_analysis: JsonValue;
  market_category_author_sales_matrix: JsonValue;
  market_category_ranking: JsonValue;
  live_detail_analysis: JsonValue;
  live_products_list: JsonValue;
  live_search: JsonValue;
  video_data_trends: JsonValue;
  video_detail_analysis: JsonValue;
  video_script_info: JsonValue;
  video_search: JsonValue;
  credit_usage_summary: JsonValue;
  fastmoss_detail_url_examples: JsonValue;
  search_category_by_words: JsonValue;
  search_fastmoss_documents: JsonValue;
}

export type FastMossToolName = keyof FastMossToolDataMap;
