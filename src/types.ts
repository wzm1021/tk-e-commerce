export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue | undefined };

export type TikTokRegion =
  | "US"
  | "UK"
  | "ID"
  | "VN"
  | "TH"
  | "MY"
  | "PH"
  | "SG"
  | (string & {});

export type CategoryId = number;

export const TIKTOK_PRIMARY_CATEGORIES = {
  womenClothing: 2,
  menClothing: 3,
  kidsClothing: 4,
  shoes: 6,
  bags: 7,
  fashionAccessories: 8,
  sportsOutdoor: 9,
  homeSupplies: 10,
  kitchenSupplies: 11,
  textilesDecor: 12,
  appliances: 13,
  beautyPersonalCare: 14,
  computersOffice: 15,
  phonesElectronics: 16,
  petSupplies: 17,
  motherBaby: 18,
  toysHobbies: 19,
  furniture: 20,
  toolsHardware: 21,
  homeImprovement: 22,
  automotive: 23,
  foodBeverage: 24,
  health: 25,
  booksMedia: 26,
  jewelry: 28,
  collectibles: 30,
  secondHand: 31,
} as const satisfies Record<string, CategoryId>;

export interface RegionInput {
  region?: TikTokRegion;
}

export interface RequiredRegionInput {
  region: TikTokRegion;
}

export interface SearchInput extends RegionInput {
  keywords?: string;
}

export interface RequiredSearchInput extends RequiredRegionInput {
  keywords: string;
  category_id?: CategoryId;
}

export interface VideoIdentityInput extends RequiredRegionInput {
  videoId: string;
}

export interface CreatorIdentityInput extends RequiredRegionInput {
  uid: string;
}

export interface CreatorProfileInput extends RequiredRegionInput {
  uid?: string;
  uniqueId?: string;
}

export interface ShopIdentityInput extends RequiredRegionInput {
  sellerId: string;
}

export interface ProductIdentityInput extends RequiredRegionInput {
  productId: string;
}

export interface ProductVideoListInput extends ProductIdentityInput {
  isAd?: boolean;
}

export interface LiveIdentityInput extends RequiredRegionInput {
  roomId: string;
}

export interface CategoryInput extends RegionInput {
  categoryId?: CategoryId;
}

export interface RequiredCategoryInput extends RequiredRegionInput {
  categoryId: CategoryId;
}

export type CategoryAnalysisType =
  | "basic_metrics"
  | "sales_trends"
  | "price_distribution";

export interface CategoryAnalysisInput extends RequiredRegionInput {
  analysisType: CategoryAnalysisType;
  categoryId?: CategoryId;
  categoryPath?: number[];
}

export type AuthorProductType = 1 | 2;

export interface CreatorRankInput extends RegionInput {
  categoryId?: CategoryId;
  authorProductType?: AuthorProductType;
}

export interface CreatorRankLegacyInput extends RequiredRegionInput {
  category_id?: CategoryId;
  author_product_type?: AuthorProductType;
}

export interface ClawecResponse<TData = JsonValue> {
  status: number;
  code: number;
  msg: string;
  data: TData;
  /** 服务返回的展示元数据；原始形态是 JSON 字符串。 */
  extra?: string;
}

export interface ClawecTableColumn {
  cover?: boolean;
  field?: string;
  label?: string;
  url?: boolean;
  [key: string]: JsonValue | undefined;
}

export interface ClawecExtra {
  title?: string;
  table?: {
    cards?: JsonObject[];
    columns?: ClawecTableColumn[];
    data?: JsonObject[];
    [key: string]: JsonValue | undefined;
  };
  [key: string]: JsonValue | undefined;
}

export interface ListData<TItem extends JsonObject = JsonObject> {
  list: TItem[];
  total?: number;
  [key: string]: JsonValue | undefined;
}

export interface CreatorCategory extends JsonObject {
  id?: number;
  name?: string;
}

export interface CreatorSearchItem extends JsonObject {
  uid?: string;
  uniqueId?: string;
  nickname?: string;
  avatar?: string;
  region?: string;
  followerCount?: number;
  category?: CreatorCategory;
  creator?: JsonObject;
}

export interface ProductSearchItem extends JsonObject {
  product_id?: string;
  title?: string;
  shop?: JsonObject;
}

// 服务未发布 outputSchema。以下命名类型为各接口保留独立扩展点，
// 在未观察到稳定字段前使用 JsonValue，避免把猜测字段伪装成契约。
export type VideoDetailData = JsonValue;
export type VideoTrendData = JsonValue;
export type VideoSearchData = ListData;
export type CreatorFansDistributionData = JsonValue;
export type CreatorTrendData = JsonValue;
export type CreatorRankData = JsonValue;
export type CreatorProductListData = JsonValue;
export type CreatorProfileData = JsonValue;
export type CreatorSearchData = ListData<CreatorSearchItem>;
export type ShopInvestmentData = JsonValue;
export type ShopTrendData = JsonValue;
export type ShopSearchData = ListData;
export type ShopCreatorAnalysisData = JsonValue;
export type ShopProductAnalysisData = JsonValue;
export type ShopSaleAnalysisData = JsonValue;
export type ShopBaseInfoData = JsonValue;
export type MarketAuthorSalesMatrixData = JsonValue;
export type MarketCategoryRankingData = JsonValue;
export type MarketCategoryAnalysisData = JsonValue;
export type LiveProductsData = JsonValue;
export type LiveDetailData = JsonValue;
export type LiveSearchData = ListData;
export type ProductRankingData = JsonValue;
export type ProductVideoListData = JsonValue;
export type ProductReviewData = JsonValue;
export type ProductSkuData = JsonValue;
export type ProductCreatorAnalysisData = JsonValue;
export type ProductInvestmentData = JsonValue;
export type ProductSalesTrendData = JsonValue;
export type ProductOverviewData = JsonValue;
export type ProductDetailData = JsonValue;
export type ProductSearchData = ListData<ProductSearchItem>;

export function parseExtra(response: ClawecResponse): ClawecExtra | undefined {
  if (!response.extra) return undefined;

  try {
    return JSON.parse(response.extra) as ClawecExtra;
  } catch {
    return undefined;
  }
}
