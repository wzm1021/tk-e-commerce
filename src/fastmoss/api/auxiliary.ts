import { FastMossBaseApi } from "../base-api.ts";
import type { FastMossInput } from "../generated-inputs.ts";

export class FastMossAuxiliaryApi extends FastMossBaseApi {
  creditUsageSummary() {
    return this.call("credit_usage_summary");
  }

  detailUrlExamples() {
    return this.call("fastmoss_detail_url_examples");
  }

  searchCategoryByWords(input: FastMossInput<"search_category_by_words">) {
    return this.call("search_category_by_words", input);
  }

  searchDocuments(input: FastMossInput<"search_fastmoss_documents">) {
    return this.call("search_fastmoss_documents", input);
  }
}
