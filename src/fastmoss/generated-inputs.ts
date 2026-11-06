// 此文件由 scripts/generate-fastmoss-input-types.ts 自动生成。
// Schema 同步时间：2026-08-28T09:03:52.204Z
// 请勿手工编辑；运行 npm run fastmoss:sync-tools 更新。
import type { JsonValue } from "../types.ts";

export interface FastMossInputMap {
  "ad_data_overview": {
    /** Filter parameters. */
    "filter": {
      /** End date, YYYY-MM-DD. */
      "end_date"?: string;
      /** Start date, YYYY-MM-DD. */
      "start_date"?: string;
      /** Days: 7/14/28/90; recent=28; -1=cumulative. */
      "time_range_days"?: 7 | 14 | 28 | 60 | 90 | 180;
      /** Video ID; use video_search first if only a title/creator is known. */
      "video_id": string;
    };
  };
  "ad_search": {
    /** Filter parameters. */
    "filter"?: {
      /** Ad type: 1 TikTok Shop commerce ad, 2 non-commerce/planting ad. */
      "ad_type"?: number;
      /** Level-1 product category ID. */
      "category_l1_id"?: number;
      /** Level-2 product category ID. */
      "category_l2_id"?: number;
      /** Level-3 product category ID. */
      "category_l3_id"?: number;
      /** Estimated ad spend range in the form {"min": number, "max": number}. */
      "estimated_ad_spend_range"?: {
        /** Maximum value. */
        "max"?: number;
        /** Minimum value. */
        "min"?: number;
      };
      /** Search keywords for ad caption, product, creator, or shop clues. */
      "keywords"?: string;
      /** Last-seen ad date range in the form {"start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD"}. */
      "last_seen_ad_date_range"?: {
        /** End date, YYYY-MM-DD. */
        "end_date"?: string;
        /** Start date, YYYY-MM-DD. */
        "start_date"?: string;
      };
      /** Range for the number of days the ad was observed as active, in the form {"min": number, "max": number}. */
      "observed_active_days_range"?: {
        /** Maximum value. */
        "max"?: number;
        /** Minimum value. */
        "min"?: number;
      };
      /** Video play-count range in the form {"min": number, "max": number}. */
      "play_count_range"?: {
        /** Maximum value. */
        "max"?: number;
        /** Minimum value. */
        "min"?: number;
      };
      /** Country or region code where the ad is detected, e.g. US, ID, VN. */
      "region"?: string;
      /** ROAS range as a multiplier, not a percent. Example: {"min":2,"max":5} means ROAS 2x-5x. */
      "roas_range"?: {
        /** Maximum value. */
        "max"?: number;
        /** Minimum value. */
        "min"?: number;
      };
      /** Video publish-date range in the form {"start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD"}. */
      "video_create_date_range"?: {
        /** End date, YYYY-MM-DD. */
        "end_date"?: string;
        /** Start date, YYYY-MM-DD. */
        "start_date"?: string;
      };
    };
    /** Sort options. */
    "orderby"?: Array<{
      /** Sort field: last_seen_ad_date, first_seen_ad_date, play_count, estimated_ad_spend, roas, units_sold, gmv, or observed_active_days. */
      "field"?: "last_seen_ad_date" | "first_seen_ad_date" | "play_count" | "estimated_ad_spend" | "roas" | "units_sold" | "gmv" | "observed_active_days";
      /** Sort direction: asc or desc. Default desc. */
      "order"?: "asc" | "desc";
    }>;
    /** Page number. Default 1, max 500. */
    "page"?: number;
    /** Page size. Default 10, max 10. */
    "pagesize"?: number;
  };
  "agency_creator_analysis": {
    /** Filter parameters. */
    "filter": {
      /** Unique MCN agency ID; use agency_search first when only the agency name is known. */
      "agency_id": string;
      /** Days: 7/14/28/90; recent=28; -1=cumulative. */
      "time_range_days"?: 7 | 28 | 90;
    };
    /** Sort options. */
    "orderby"?: Array<{
      /** Field parameter. */
      "field": "follower_count" | "agency_collaboration_units_sold" | "agency_collaboration_gmv";
      /** Order parameter. */
      "order"?: "asc" | "desc";
    }>;
    /** Page number. Default 1, max 500. */
    "page"?: number;
    /** Page size. Default 10, max 10. */
    "pagesize"?: number;
  };
  "agency_product_analysis": {
    /** Filter parameters. */
    "filter": {
      /** Unique MCN agency ID; use agency_search first when only the agency name is known. */
      "agency_id": string;
      /** Days: 7/14/28/90; recent=28; -1=cumulative. */
      "time_range_days"?: 7 | 28 | 90;
    };
  };
  "agency_product_list": {
    /** Filter parameters. */
    "filter": {
      /** Unique MCN agency ID; use agency_search first when only the agency name is known. */
      "agency_id": string;
      /** Inclusive product-price upper bound; currency follows the agency market. */
      "maximum_price"?: number;
      /** Inclusive product-price lower bound; currency follows the agency market. */
      "minimum_price"?: number;
      /** Product category ID. */
      "product_category_id"?: number;
      /** Days: 7/14/28/90; recent=28; -1=cumulative. */
      "time_range_days"?: 7 | 28 | 90;
    };
    /** Sort options. */
    "orderby"?: Array<{
      /** Field parameter. */
      "field": "agency_collaboration_units_sold" | "agency_collaboration_gmv";
      /** Order parameter. */
      "order"?: "asc" | "desc";
    }>;
    /** Page number. Default 1, max 500. */
    "page"?: number;
    /** Page size. Default 10, max 10. */
    "pagesize"?: number;
  };
  "agency_profile_overview": {
    /** Filter parameters. */
    "filter": {
      /** Unique MCN agency ID; use agency_search first when only the agency name is known. */
      "agency_id": string;
      /** Days: 7/14/28/90; recent=28; -1=cumulative. */
      "time_range_days"?: 7 | 28 | 90;
    };
  };
  "agency_rank_top": {
    /** Filter parameters. */
    "filter": {
      /** Ranking period: day, week, or month; MCN agency rankings support only week/month. */
      "date_type"?: "week" | "month";
      /** Completed period only: yesterday YYYY-MM-DD, last week YYYY-ww or YYYY-Www, last month YYYY-MM; do not use the current period. */
      "date_value"?: string;
      /** Country or region code, e.g. US, UK, ID. */
      "region"?: string;
    };
    /** Sort options. */
    "orderby"?: Array<{
      /** Field parameter. */
      "field": "gmv" | "collaborating_creator_count" | "collaborating_product_count" | "estimated_commission_amount";
      /** Order parameter. */
      "order"?: "asc" | "desc";
    }>;
    /** Page number. Default 1, max 500. */
    "page"?: number;
    /** Page size. Default 10, max 10. */
    "pagesize"?: number;
  };
  "agency_search": {
    /** Filter parameters. */
    "filter": {
      /** Country or region code, e.g. US, UK, ID. */
      "region"?: string;
      /** Agency-name keyword, maximum 120 characters. */
      "search_keyword"?: string;
    };
    /** Sort options. */
    "orderby"?: Array<{
      /** Field parameter. */
      "field": "recent_7d_gmv";
      /** Order parameter. */
      "order"?: "asc" | "desc";
    }>;
    /** Page number. Default 1, max 500. */
    "page"?: number;
    /** Page size. Default 10, max 10. */
    "pagesize"?: number;
  };
  "agency_shop_analysis": {
    /** Filter parameters. */
    "filter": {
      /** Unique MCN agency ID; use agency_search first when only the agency name is known. */
      "agency_id": string;
      /** Product category ID. */
      "product_category_id"?: number;
      /** Days: 7/14/28/90; recent=28; -1=cumulative. */
      "time_range_days"?: 7 | 28 | 90;
    };
    /** Sort options. */
    "orderby"?: Array<{
      /** Field parameter. */
      "field": "collaborating_product_count" | "agency_collaboration_units_sold" | "agency_collaboration_gmv";
      /** Order parameter. */
      "order"?: "asc" | "desc";
    }>;
    /** Page number. Default 1, max 500. */
    "page"?: number;
    /** Page size. Default 10, max 10. */
    "pagesize"?: number;
  };
  "creator_cargo_summary": {
    /** Filter parameters. */
    "filter": {
      /** Creator UID; use creator_search first if only a handle/nickname is known. */
      "uid": string;
    };
  };
  "creator_data_trends": {
    /** Filter parameters. */
    "filter": {
      /** End date, YYYY-MM-DD; must be supplied together with start_date. */
      "end_date"?: string;
      /** Metric: follower_change/play/like/comment/collect_count/share/units_sold/gmv; video_*=video commerce, live_*=live commerce, showcase_*=showcase commerce. */
      "field_type": "follower_change" | "play_count" | "like_count" | "comment_count" | "collect_count" | "share_count" | "units_sold" | "gmv" | "video_units_sold" | "video_gmv" | "live_units_sold" | "live_gmv" | "showcase_units_sold" | "showcase_gmv";
      /** Start date, YYYY-MM-DD; must be supplied together with end_date. */
      "start_date"?: string;
      /** Time range in days. Allowed values: 7, 14, 28, 90; when start_date and end_date are both provided, they take precedence; default 28 applies only without that date pair. */
      "time_range_days"?: 7 | 14 | 28 | 90;
      /** Creator UID; use creator_search first if only a handle/nickname is known. */
      "uid": string;
    };
  };
  "creator_fans_distribution": {
    /** Filter parameters. */
    "filter": {
      /** Creator UID; use creator_search first if only a handle/nickname is known. */
      "uid": string;
    };
  };
  "creator_product_list": {
    /** Filter parameters. */
    "filter": {
      /** First-level product category ID only; second-level or third-level category IDs are not supported. */
      "category_id"?: number;
      /** Days: 7/14/28/90; recent=28; -1=cumulative. */
      "time_range_days"?: string;
      /** Creator UID; use creator_search first if only a handle/nickname is known. */
      "uid": string;
    };
    /** Sort options. Only the first sort rule takes effect. Fields: units_sold, gmv, commission_rate_percent. */
    "orderby"?: Array<{
      "field"?: "units_sold" | "gmv" | "commission_rate_percent";
      "order"?: "asc" | "desc";
    }>;
    /** Page number. Default 1, max 500. */
    "page"?: number;
    /** Page size. Default 10, max 10. */
    "pagesize"?: number;
  };
  "creator_profile_overview": {
    /** Filter parameters. */
    "filter": {
      /** Language. Default EN_US, optional ZH_CN. */
      "lang"?: string;
      /** Creator UID; use creator_search first if only a handle/nickname is known. */
      "uid": string;
    };
  };
  "creator_rank_top_ecommerce": {
    /** Filter parameters. */
    "filter"?: {
      /** Account type parameter. */
      "account_type"?: number;
      /** Creator category ID. */
      "creator_category_id"?: number;
      /** Ranking period: day, week, or month; MCN agency rankings support only week/month. */
      "date_type": "day" | "week" | "month";
      /** Completed period only: yesterday YYYY-MM-DD, last week YYYY-ww or YYYY-Www, last month YYYY-MM; do not use the current period. */
      "date_value": string;
      /** Ecommerce type parameter. */
      "ecommerce_type"?: number;
      /** Product category ID. */
      "product_category_id"?: number;
      /** Country or region code, e.g. US, UK, ID. */
      "region"?: string;
    };
    /** Sort options. */
    "orderby"?: Array<{
      "field"?: "creator_usd_gmv" | "video_usd_gmv" | "live_usd_gmv";
      "order"?: "asc" | "desc";
    }>;
    /** Page number. Default 1, max 500. */
    "page"?: number;
    /** Page size. Default 10, max 10. */
    "pagesize"?: number;
  };
  "creator_rank_top_growth": {
    /** Filter parameters. */
    "filter"?: {
      /** Category ID; confirm category first if only a category name is known. */
      "category_id"?: number;
      /** Ranking period: day, week, or month; MCN agency rankings support only week/month. */
      "date_type": "day" | "week" | "month";
      /** Completed period only: yesterday YYYY-MM-DD, last week YYYY-ww or YYYY-Www, last month YYYY-MM; do not use the current period. */
      "date_value": string;
      /** Country or region code, e.g. US, UK, ID. */
      "region"?: string;
      /** Verification type: 1 regular creators, 2 Blue V creators. */
      "verify_type"?: 1 | 2;
    };
    /** Sort options. */
    "orderby"?: Array<{
      "field"?: "follower_inc_count";
      "order"?: "asc" | "desc";
    }>;
    /** Page number. Default 1, max 500. */
    "page"?: number;
    /** Page size. Default 10, max 10. */
    "pagesize"?: number;
  };
  "creator_rank_top_potential": {
    /** Filter parameters. */
    "filter"?: {
      /** Category path from level 1 to level 3, e.g. [100, 200, 300]. */
      "category_path"?: Array<number>;
      /** Creator category ID. */
      "creator_category_id"?: number;
      /** Ranking period: day, week, or month; MCN agency rankings support only week/month. */
      "date_type": "day" | "week" | "month";
      /** Completed period only: yesterday YYYY-MM-DD, last week YYYY-ww or YYYY-Www, last month YYYY-MM; do not use the current period. */
      "date_value": string;
      /** Ecommerce type parameter. */
      "ecommerce_type"?: number;
      /** Follower age: 1=18-24, 2=25-34, 3=35+. */
      "follower_age_type"?: Record<string, JsonValue | undefined>;
      /** Follower count range: {"min": number, "max": number}. */
      "follower_count_range"?: {
        /** Maximum value. */
        "max"?: number;
        /** Minimum value. */
        "min"?: number;
      };
      /** Follower gender type parameter. */
      "follower_gender_type"?: number;
      /** Country or region code, e.g. US, UK, ID. */
      "region"?: string;
    };
    /** Sort options. */
    "orderby"?: Array<{
      "field"?: "potential_index";
      "order"?: "asc" | "desc";
    }>;
    /** Page number. Default 1, max 500. */
    "page"?: number;
    /** Page size. Default 10, max 10. */
    "pagesize"?: number;
  };
  "creator_search": {
    /** Filter parameters. */
    "filter"?: {
      /** Creator category ID; do not confuse it with promoted-product category IDs. */
      "creator_category_id"?: number;
      /** Creator type: 1 personal, 2 shop. */
      "creator_type"?: number;
      /** Follower age: 1=18-24, 2=25-34, 3=35+. */
      "follower_age_type"?: number;
      /** Follower gender type parameter. */
      "follower_gender_type"?: number;
      /** Follower count range: {"min": number, "max": number}. */
      "follower_range"?: {
        /** Maximum value. */
        "max"?: number;
        /** Minimum value. */
        "min"?: number;
      };
      /** Is ecommerce creator parameter. */
      "is_ecommerce_creator"?: boolean;
      /** Is mcn creator parameter. */
      "is_mcn_creator"?: boolean;
      /** Level-1 promoted-product category ID. */
      "product_category_l1_id"?: number;
      /** Level-2 promoted-product category ID. */
      "product_category_l2_id"?: number;
      /** Level-3 promoted-product category ID. */
      "product_category_l3_id"?: number;
      /** Country or region code, e.g. US, UK, ID. */
      "region"?: string;
      /** Creator UID; use creator_search first if only a handle/nickname is known. */
      "uid"?: string;
      /** Unique id. */
      "unique_id"?: string;
      /** Verification type: 1 regular creators, 2 Blue V creators. */
      "verify_type"?: number;
    };
    /** Search keywords: product, shop, creator, video, live, or category terms. */
    "keywords"?: string;
    /** Sort options. */
    "orderby"?: Array<{
      "field"?: "follower_count" | "day28_follower_count" | "video_count" | "video_avg_play_count" | "video_avg_digg_count" | "day28_units_sold" | "day28_gmv";
      "order"?: "asc" | "desc";
    }>;
    /** Page number. Default 1, max 500. */
    "page"?: number;
    /** Page size. Default 10, max 10. */
    "pagesize"?: number;
  };
  "creator_video_analysis": {
    /** Filter parameters. */
    "filter": {
      /** End date, YYYY-MM-DD. */
      "end_date"?: string;
      /** Sort options. */
      "orderby"?: Array<{
        "field"?: "create_time" | "play_count" | "digg_count" | "share_count" | "comment_count" | "sold_count" | "sale_amount";
        "order"?: "asc" | "desc";
      }>;
      /** Page number. Default 1, max 500. */
      "page"?: number;
      /** Page size. Default 10, max 10. */
      "pagesize"?: number;
      /** Start date, YYYY-MM-DD. */
      "start_date"?: string;
      /** Days: 7/14/28/90; recent=28; -1=cumulative. */
      "time_range_days"?: 7 | 14 | 28 | 90;
      /** Type parameter. */
      "type"?: string;
      /** Creator UID; use creator_search first if only a handle/nickname is known. */
      "uid": string;
    };
  };
  "credit_usage_summary": Record<string, JsonValue | undefined>;
  "fastmoss_detail_url_examples": Record<string, JsonValue | undefined>;
  "live_detail_analysis": {
    /** Filter parameters. */
    "filter": {
      /** Live room ID; use live_search first if only a title/host/shop is known. */
      "room_id": string;
    };
    /** Language. Default EN_US, optional ZH_CN. */
    "lang"?: string;
  };
  "live_products_list": {
    /** Filter parameters. */
    "filter": {
      /** Product category ID; omit it to include all categories. Passing 1 also means all. */
      "category_id"?: number;
      /** Live room ID; use live_search first if only a title/host/shop is known. */
      "room_id": string;
      /** Shop seller_id; omit it to include all shops. Passing 1 also means all. */
      "seller_id"?: string;
    };
    /** Language. Default EN_US, optional ZH_CN. */
    "lang"?: string;
    /** Sort options; only the first sort rule takes effect. Fields: units_sold, gmv. */
    "orderby"?: Array<{
      "field"?: "units_sold" | "gmv";
      "order"?: "asc" | "desc";
    }>;
    /** Page number. Default 1, max 500. */
    "page"?: number;
    /** Page size. Default 10, max 10; timeline snapshots are returned only when pagesize <= 10. */
    "pagesize"?: number;
  };
  "live_search": {
    /** Filter parameters. */
    "filter"?: {
      /** Creator category ID. */
      "creator_category"?: number;
      /** Follower count range: {"min": number, "max": number}. */
      "follower_range"?: {
        /** Maximum value. */
        "max"?: number;
        /** Minimum value. */
        "min"?: number;
      };
      /** Live type: 1 shop live, 2 creator live. */
      "live_type"?: number;
      /** Product category ID. */
      "product_category"?: number;
      /** Country or region code, e.g. US, UK, ID. */
      "region"?: string;
      /** Live room ID; use live_search first if only a title/host/shop is known. */
      "room_id"?: string;
      /** Sold range range in the form {"min": number, "max": number}. */
      "sold_range"?: {
        /** Maximum value. */
        "max"?: number;
        /** Minimum value. */
        "min"?: number;
      };
      /** Live start-time range object with Unix timestamps, e.g. {"min":1742976585,"max":1742976585}. */
      "start_time": {
        /** Maximum value. */
        "max"?: number;
        /** Minimum value. */
        "min"?: number;
      };
      /** Viewer range range in the form {"min": number, "max": number}. */
      "viewer_range"?: {
        /** Maximum value. */
        "max"?: number;
        /** Minimum value. */
        "min"?: number;
      };
    };
    /** Search keywords: product, shop, creator, video, live, or category terms. */
    "keywords"?: string;
    /** Language. Default EN_US, optional ZH_CN. */
    "lang"?: string;
    /** Sort options. */
    "orderby"?: Array<{
      "field"?: "start_time" | "total_viewer_count" | "total_units_sold" | "total_gmv";
      "order"?: "asc" | "desc";
    }>;
    /** Page number. Default 1, max 500. */
    "page"?: number;
    /** Page size. Default 10, max 10. */
    "pagesize"?: number;
  };
  "market_category_analysis": {
    /** Analysis type parameter. */
    "analysis_type": "basic_metrics" | "sales_trends" | "price_distribution";
    /** Filter parameters. */
    "filter": {
      /** Product category ID. Only level-1 category IDs are supported; level-2 or level-3 category IDs are not supported. Default -100 means all categories. */
      "category_id"?: number;
      /** Ranking period: day, week, or month; MCN agency rankings support only week/month. */
      "date_type"?: string;
      /** Completed period only: yesterday YYYY-MM-DD, last week YYYY-ww or YYYY-Www, last month YYYY-MM; do not use the current period. */
      "date_value"?: string;
      /** Country or region code, e.g. US, UK, ID. */
      "region"?: string;
    };
    /** Language. Default EN_US, optional ZH_CN. */
    "lang"?: string;
  };
  "market_category_author_sales_matrix": {
    /** Filter parameters. */
    "filter"?: {
      /** Category ID; confirm category first if only a category name is known. */
      "category_id"?: number;
      /** Completed period only: yesterday YYYY-MM-DD, last week YYYY-ww or YYYY-Www, last month YYYY-MM; do not use the current period. */
      "date_value"?: string;
      /** Country or region code, e.g. US, UK, ID. */
      "region"?: string;
      /** Sold type parameter. */
      "sold_type"?: number;
    };
    /** Language. Default EN_US, optional ZH_CN. */
    "lang"?: string;
  };
  "market_category_ranking": {
    /** Filter parameters. */
    "filter"?: {
      /** Parent category ID. Only level-1 category IDs are supported; level-2 or level-3 category IDs are not supported. Omit it or set -100 for level-1 ranking, or pass a level-1 category for its level-2 ranking. */
      "category_id"?: number;
      /** Ranking period: day, week, or month; MCN agency rankings support only week/month. */
      "date_type"?: string;
      /** Completed period only: yesterday YYYY-MM-DD, last week YYYY-ww or YYYY-Www, last month YYYY-MM; do not use the current period. */
      "date_value"?: string;
      /** Country or region code, e.g. US, UK, ID. */
      "region"?: string;
    };
    /** Language. Default EN_US, optional ZH_CN. */
    "lang"?: string;
    /** Sort options. Only the first sort rule takes effect. Use ranking fields such as category_units_sold. */
    "orderby"?: Array<{
      "field"?: "category_units_sold" | "category_units_sold_yoy_percent" | "category_gmv_yoy_percent" | "top_50_products_units_sold_share_percent" | "top_10_shops_units_sold_share_percent";
      "order"?: "asc" | "desc";
    }>;
    /** Page number. Default 1, max 500. */
    "page"?: number;
    /** Page size. Default 10, max 10. */
    "pagesize"?: number;
  };
  "product_category_info": Record<string, JsonValue | undefined>;
  "product_creator_analysis": {
    /** Filter parameters. */
    "filter": {
      /** Product ID; use product_search first if only a product name is known. */
      "product_id": string;
    };
    /** Sort options. */
    "orderby"?: Array<{
      "field"?: "product_gmv" | "product_units_sold" | "creator_total_like_count" | "follower_count";
      "order"?: "asc" | "desc";
    }>;
    /** Page number. Default 1, max 500. */
    "page"?: number;
    /** Page size. Default 10, max 10. */
    "pagesize"?: number;
  };
  "product_detail_info": {
    /** Filter parameters. */
    "filter": {
      /** Product ID; use product_search first if only a product name is known. */
      "product_id": string;
    };
  };
  "product_investment": {
    /** Filter parameters. */
    "filter": {
      /** Product ID; use product_search first if only a product name is known. */
      "product_id": string;
      /** Days: 7/14/28/90; recent=28; -1=cumulative. */
      "time_range_days"?: number;
    };
  };
  "product_overview": {
    /** Filter parameters. */
    "filter": {
      /** End date, YYYY-MM-DD. */
      "end_date"?: string;
      /** Product ID; use product_search first if only a product name is known. */
      "product_id": string;
      /** Start date, YYYY-MM-DD. */
      "start_date"?: string;
      /** Days: 7/14/28/90; recent=28; -1=cumulative. */
      "time_range_days"?: number;
    };
  };
  "product_rank_new_listed": {
    /** Filter parameters. */
    "filter"?: {
      /** Category ID; confirm category first if only a category name is known. */
      "category_id"?: number;
      /** Level-1 product category ID. */
      "category_l1_id"?: number;
      /** Level-2 product category ID. */
      "category_l2_id"?: number;
      /** Level-3 product category ID. */
      "category_l3_id"?: number;
      /** Whether it is cross-border. */
      "is_cross_border"?: boolean;
      /** Whether it is fully managed. */
      "is_fully_managed"?: boolean;
      /** Product listing end date, YYYY-MM-DD. The latest allowed date is 4 days ago; do not use today or the most recent 1-3 days. */
      "listing_end_date": string;
      /** Product listing start date, YYYY-MM-DD. The latest allowed date is 4 days ago; do not use today or the most recent 1-3 days. */
      "listing_start_date": string;
      /** Country or region code, e.g. US, UK, ID. */
      "region"?: string;
    };
    /** Sort options. */
    "orderby"?: Array<{
      "field"?: "day3_units_sold" | "day3_gmv" | "total_units_sold" | "lifetime_gmv";
      "order"?: "asc" | "desc";
    }>;
    /** Page number. Default 1, max 500. */
    "page"?: number;
    /** Page size. Default 10, max 10. */
    "pagesize"?: number;
  };
  "product_rank_top_selling": {
    /** Filter parameters. */
    "filter"?: {
      /** Category ID; confirm category first if only a category name is known. */
      "category_id"?: number;
      /** Ranking period: day, week, or month; MCN agency rankings support only week/month. */
      "date_type": "day" | "week" | "month";
      /** Completed period only: yesterday YYYY-MM-DD, last week YYYY-ww or YYYY-Www, last month YYYY-MM; do not use the current period. */
      "date_value": string;
      /** Country or region code, e.g. US, UK, ID. */
      "region"?: string;
    };
    /** Sort options. */
    "orderby"?: Array<{
      "field"?: "period_units_sold" | "period_gmv" | "total_units_sold" | "total_gmv" | "units_sold_growth_rate_percent";
      "order"?: "asc" | "desc";
    }>;
    /** Page number. Default 1, max 500. */
    "page"?: number;
    /** Page size. Default 10, max 10. */
    "pagesize"?: number;
  };
  "product_review_list": {
    /** Filter parameters. */
    "filter"?: {
      /** Product ID; use product_search first if only a product name is known. */
      "product_id": string;
      /** Days: 7/14/28/90; recent=28; -1=cumulative. */
      "time_range_days"?: number;
    };
    /** Sort options. */
    "orderby"?: Array<{
      "field"?: "rating" | "create_time" | "review_id";
      "order"?: "asc" | "desc";
    }>;
    /** Page number. Default 1, max 500. */
    "page"?: number;
    /** Page size. Default 10, max 10. */
    "pagesize"?: number;
  };
  "product_sales_trend": {
    /** Filter parameters. */
    "filter"?: {
      /** Product ID; use product_search first if only a product name is known. */
      "product_id": string;
      /** Days: 7/14/28/90; recent=28; -1=cumulative. */
      "time_range_days": number;
    };
  };
  "product_search": {
    /** Filter parameters. */
    "filter"?: {
      /** Category path from level 1 to level 3, e.g. [100, 200, 300]. */
      "category_path"?: Array<number>;
      /** Commission-rate range as percent-number values. Example: {"min":10,"max":20} means 10%-20%; pass 10 for 10%. */
      "commission_rate_range"?: {
        /** Maximum value. */
        "max"?: number;
        /** Minimum value. */
        "min"?: number;
      };
      /** Creator count range range in the form {"min": number, "max": number}. */
      "creator_count_range"?: {
        /** Maximum value. */
        "max"?: number;
        /** Minimum value. */
        "min"?: number;
      };
      /** Last-28-day GMV range; maps to day28_sale_amount. */
      "day28_gmv_range"?: {
        /** Maximum value. */
        "max"?: number;
        /** Minimum value. */
        "min"?: number;
      };
      /** Last-28-day units-sold range; maps to day28_sold_count. */
      "day28_units_sold_range"?: {
        /** Maximum value. */
        "max"?: number;
        /** Minimum value. */
        "min"?: number;
      };
      /** Last-7-day GMV range; maps to day7_sale_amount. */
      "day7_gmv_range"?: {
        /** Maximum value. */
        "max"?: number;
        /** Minimum value. */
        "min"?: number;
      };
      /** Last-7-day units-sold range; maps to day7_sold_count. */
      "day7_units_sold_range"?: {
        /** Maximum value. */
        "max"?: number;
        /** Minimum value. */
        "min"?: number;
      };
      /** Product price range: {"min": number, "max": number}. */
      "floor_price_range"?: {
        /** Maximum value. */
        "max"?: number;
        /** Minimum value. */
        "min"?: number;
      };
      /** Whether it is cross-border. */
      "is_cross_border"?: boolean;
      /** Is free shipping parameter. */
      "is_free_shipping"?: boolean;
      /** Whether it is fully managed. */
      "is_fully_managed"?: boolean;
      /** Is local warehouse parameter. */
      "is_local_warehouse"?: boolean;
      /** Is new listed parameter. */
      "is_new_listed"?: boolean;
      /** Whether it is fully managed. */
      "is_sshop"?: boolean;
      /** Is top selling parameter. */
      "is_top_selling"?: boolean;
      /** Listing status. Allowed values: on_sale, off_shelf. Omit it to avoid filtering by listing status. */
      "listing_status"?: "on_sale" | "off_shelf";
      /** Product ID; use product_search first if only a product name is known. */
      "product_id"?: string;
      /** Country or region code, e.g. US, UK, ID. */
      "region"?: string;
      /** Shop type: 1 local, 2 cross-border; deprecated. */
      "shop_type"?: number;
      /** Total GMV range; maps to sale_amount. */
      "total_gmv_range"?: {
        /** Maximum value. */
        "max"?: number;
        /** Minimum value. */
        "min"?: number;
      };
      /** Units sold range range in the form {"min": number, "max": number}. */
      "units_sold_range"?: {
        /** Maximum value. */
        "max"?: number;
        /** Minimum value. */
        "min"?: number;
      };
    };
    /** Search keywords: product, shop, creator, video, live, or category terms. */
    "keywords"?: string;
    /** Sort options. */
    "orderby"?: Array<{
      "field"?: "day7_units_sold" | "day7_gmv" | "day28_units_sold" | "day28_gmv" | "commission_rate" | "total_units_sold" | "total_gmv" | "creator_count";
      "order"?: "asc" | "desc";
    }>;
    /** Page number. Default 1, max 500. */
    "page"?: number;
    /** Page size. Default 10, max 10. */
    "pagesize"?: number;
  };
  "product_sku": {
    /** Filter parameters. */
    "filter": {
      /** Product ID; use product_search first if only a product name is known. */
      "product_id": string;
      /** Time range in days. Allowed values: 7 or 28. Default: 7. */
      "time_range_days"?: 7 | 28;
    };
  };
  "product_video_list": {
    /** Filter parameters. */
    "filter": {
      /** Creation/publish time range: {"min": unix_timestamp, "max": unix_timestamp}. */
      "create_time_range"?: {
        "max"?: number;
        "min"?: number;
      };
      /** Whether it uses ad traffic. */
      "is_ad"?: boolean;
      /** Product ID; use product_search first if only a product name is known. */
      "product_id": string;
      /** Days: 7/14/28/90; recent=28; -1=cumulative. */
      "time_range_days"?: number;
    };
    /** Sort options. */
    "orderby"?: Array<{
      "field"?: "gmv" | "units_sold" | "digg_count" | "play_count" | "share_count";
      "order"?: "asc" | "desc";
    }>;
    /** Page number. Default 1, max 500. */
    "page"?: number;
    /** Page size. Default 10, max 10. */
    "pagesize"?: number;
  };
  "search_category_by_words": {
    /** Max deduplicated candidates. Default 15. */
    "max_total_results"?: number;
    /** Product or category terms, string or array; map natural-language category clues into category_id. */
    "query": Array<string> | string;
    /** Candidate categories per keyword. Default 5. */
    "top_k"?: number;
  };
  "search_fastmoss_documents": {
    /** Feature terms, terminology, rule questions, or operation questions; string or array. */
    "query": Array<string> | string;
    /** Optional source file; use it to narrow the search scope and reduce noise. */
    "source_file"?: string;
    /** Knowledge snippets per query. Default 5. */
    "top_k"?: number;
  };
  "shop_base_info": {
    /** Filter parameters. */
    "filter": {
      /** Shop seller_id; use shop_search first if only a shop name is known. */
      "seller_id": string;
    };
  };
  "shop_creator_analysis": {
    /** Filter parameters. */
    "filter": {
      /** Selling mode: 1 video, 2 live. */
      "author_product_type"?: 1 | 2;
      /** Follower count range: {"min": number, "max": number}. */
      "follower_count_range"?: {
        /** Maximum value. */
        "max"?: number;
        /** Minimum value. */
        "min"?: number;
      };
      /** Shop seller_id; use shop_search first if only a shop name is known. */
      "seller_id": string;
      /** Units sold range: {"min": number, "max": number}. */
      "sold_count_range"?: {
        /** Maximum value. */
        "max"?: number;
        /** Minimum value. */
        "min"?: number;
      };
      /** Days: 7/14/28/90; recent=28; -1=cumulative. */
      "time_range_days"?: 7 | 28 | 90 | -1;
    };
    /** Sort options. */
    "orderby"?: Array<{
      "field"?: "follower_count" | "sold_count" | "sale_amount";
      "order"?: "asc" | "desc";
    }>;
    /** Page number. Default 1, max 500. */
    "page"?: number;
    /** Page size. Default 10, max 10. */
    "pagesize"?: number;
  };
  "shop_data_trends": {
    /** Filter parameters. */
    "filter": {
      /** End date, YYYY-MM-DD. */
      "end_date"?: string;
      /** Shop seller_id; use shop_search first if only a shop name is known. */
      "seller_id": string;
      /** Start date, YYYY-MM-DD. */
      "start_date"?: string;
      /** Days: 7/14/28/90; recent=28; -1=cumulative. */
      "time_range_days"?: 7 | 28 | 90;
    };
  };
  "shop_investment_analysis": {
    /** Filter parameters. */
    "filter": {
      /** End date, YYYY-MM-DD. */
      "end_date"?: string;
      /** Shop seller_id; use shop_search first if only a shop name is known. */
      "seller_id": string;
      /** Start date, YYYY-MM-DD. */
      "start_date"?: string;
      /** Days: 7/14/28/90; recent=28; -1=cumulative. */
      "time_range_days"?: 7 | 14 | 28 | 60 | 90 | 180;
    };
  };
  "shop_live_analysis": {
    /** Filter parameters. */
    "filter": {
      /** Live type: 0 all, 1 shop live, 2 affiliate live. */
      "is_shop"?: number;
      /** Shop seller_id; use shop_search first if only a shop name is known. */
      "seller_id": string;
      /** Summary end date parameter. */
      "summary_end_date"?: string;
      /** Summary start date parameter. */
      "summary_start_date"?: string;
      /** Days: 7/14/28/90; recent=28; -1=cumulative. */
      "time_range_days"?: 7 | 28 | 90;
    };
    /** Sort options. */
    "orderby"?: Array<{
      "field"?: "start_time" | "product_count" | "total_user_count" | "units_sold" | "gmv";
      "order"?: "asc" | "desc";
    }>;
    /** Page number. Default 1, max 500. */
    "page"?: number;
    /** Page size. Default 10, max 10. */
    "pagesize"?: number;
  };
  "shop_product_analysis": {
    /** Filter parameters. */
    "filter": {
      /** Category ID; confirm category first if only a category name is known. */
      "category_id"?: number;
      /** Product listing end date, YYYY-MM-DD. The latest allowed date is 4 days ago; do not use today or the most recent 1-3 days. */
      "listing_end_date"?: string;
      /** Product listing start date, YYYY-MM-DD. The latest allowed date is 4 days ago; do not use today or the most recent 1-3 days. */
      "listing_start_date"?: string;
      /** Listing age in days, commonly 7/14/28/90. */
      "listing_time_range_days"?: 7 | 14 | 28 | 90;
      /** Shop seller_id; use shop_search first if only a shop name is known. */
      "seller_id": string;
      /** Days: 7/14/28/90; recent=28; -1=cumulative. */
      "time_range_days"?: 7 | 28 | 90;
    };
    /** Sort options. */
    "orderby"?: Array<{
      "field"?: "launch_time" | "commission_rate_percent" | "day7_units_sold" | "day28_units_sold" | "day90_units_sold" | "day7_gmv" | "day28_gmv" | "day90_gmv" | "total_units_sold" | "total_gmv";
      "order"?: "asc" | "desc";
    }>;
    /** Page number. Default 1, max 500. */
    "page"?: number;
    /** Page size. Default 10, max 10. */
    "pagesize"?: number;
  };
  "shop_rank_top_selling": {
    /** Filter parameters. */
    "filter"?: {
      /** Category ID; confirm category first if only a category name is known. */
      "category_id"?: number;
      /** Ranking period: day, week, or month; MCN agency rankings support only week/month. */
      "date_type": "day" | "week" | "month";
      /** Completed period only: yesterday YYYY-MM-DD, last week YYYY-ww or YYYY-Www, last month YYYY-MM; do not use the current period. */
      "date_value": string;
      /** Whether it is cross-border. */
      "is_cross_border"?: boolean;
      /** Country or region code, e.g. US, UK, ID. */
      "region"?: string;
      /** Shop type: 1 brand shop, 2 retail shop. */
      "shop_type"?: number;
    };
    /** Sort options. */
    "orderby"?: Array<{
      "field"?: "units_sold" | "usd_gmv";
      "order"?: "asc" | "desc";
    }>;
    /** Page number. Default 1, max 500. */
    "page"?: number;
    /** Page size. Default 10, max 10. */
    "pagesize"?: number;
  };
  "shop_sale_analysis": {
    /** Filter parameters. */
    "filter": {
      /** Shop seller_id; use shop_search first if only a shop name is known. */
      "seller_id": string;
      /** Sales analysis period in days. Allowed values: 7, 28, 90. Default 28. */
      "time_range_days"?: 7 | 28 | 90;
    };
  };
  "shop_search": {
    /** Filter parameters. */
    "filter"?: {
      /** Brand name parameter. */
      "brand_name"?: string;
      /** Category ID; confirm category first if only a category name is known. */
      "category_id"?: number;
      /** Creator count range: {"min": number, "max": number}. */
      "creator_range"?: {
        /** Maximum value. */
        "max"?: number;
        /** Minimum value. */
        "min"?: number;
      };
      /** Creator UID; use creator_search first if only a handle/nickname is known. */
      "creator_uid"?: string;
      /** Creator unique id. */
      "creator_unique_id"?: string;
      /** Whether it is fully managed. */
      "is_fully_managed"?: boolean;
      /** Is local parameter. */
      "is_local"?: boolean;
      /** Rating range range in the form {"min": number, "max": number}. */
      "rating_range"?: {
        /** Maximum value. */
        "max"?: number;
        /** Minimum value. */
        "min"?: number;
      };
      /** Country or region code, e.g. US, UK, ID. */
      "region"?: string;
      /** Shop seller_id; use shop_search first if only a shop name is known. */
      "seller_id"?: string;
      /** Shop name parameter. */
      "shop_name"?: string;
    };
    /** Search keywords: product, shop, creator, video, live, or category terms. */
    "keywords"?: string;
    /** Sort options. */
    "orderby"?: Array<{
      "field"?: "day7_units_sold" | "day7_gmv" | "total_units_sold" | "total_gmv";
      "order"?: "asc" | "desc";
    }>;
    /** Page number. Default 1, max 500. */
    "page"?: number;
    /** Page size. Default 10, max 10. */
    "pagesize"?: number;
  };
  "shop_video_analysis": {
    /** Filter parameters. */
    "filter": {
      /** Whether it uses ad traffic. */
      "is_ad"?: boolean;
      /** Publish end date parameter. */
      "publish_end_date"?: string;
      /** Publish start date parameter. */
      "publish_start_date"?: string;
      /** Video publish age in days, commonly 7/28/90. */
      "publish_time_range_days"?: 7 | 28 | 90;
      /** Shop seller_id; use shop_search first if only a shop name is known. */
      "seller_id": string;
      /** Days: 7/14/28/90; recent=28; -1=cumulative. */
      "time_range_days"?: 7 | 28 | 90;
    };
    /** Sort options. */
    "orderby"?: Array<{
      "field"?: "video_create_time" | "units_sold" | "gmv" | "digg_count" | "play_count";
      "order"?: "asc" | "desc";
    }>;
    /** Page number. Default 1, max 500. */
    "page"?: number;
    /** Page size. Default 10, max 10. */
    "pagesize"?: number;
  };
  "video_data_trends": {
    /** Filter parameters. */
    "filter": {
      /** End date, YYYY-MM-DD. */
      "end_date"?: string;
      /** Start date, YYYY-MM-DD. */
      "start_date"?: string;
      /** Days: 7/14/28/90; recent=28; -1=cumulative. */
      "time_range_days"?: number;
      /** Video ID; use video_search first if only a title/creator is known. */
      "video_id": string;
    };
  };
  "video_detail_analysis": {
    /** Filter parameters. */
    "filter": {
      /** Video ID; use video_search first if only a title/creator is known. */
      "video_id": string;
    };
    /** Language. Default EN_US, optional ZH_CN. */
    "lang"?: string;
    /** Sort options. */
    "orderby"?: Array<{
      "field"?: "units_sold" | "gmv" | "launch_time" | "commission_rate";
      "order"?: "asc" | "desc";
    }>;
    /** Page number. Default 1, max 500. */
    "page"?: number;
    /** Page size. Default 10, max 10. */
    "pagesize"?: number;
  };
  "video_script_info": {
    /** Video ID; use video_search first if only a title/creator is known. */
    "video_id": string;
  };
  "video_search": {
    /** Filter parameters. */
    "filter"?: {
      /** Creation/publish time range: {"min": unix_timestamp, "max": unix_timestamp}. */
      "create_time_range": {
        /** Maximum value. */
        "max"?: number;
        /** Minimum value. */
        "min"?: number;
      };
      /** Creator category ID. */
      "creator_category_id"?: number;
      /** Creator UID; use creator_search first if only a handle/nickname is known. */
      "creator_uid"?: number;
      /** Creator unique id. */
      "creator_unique_id"?: string;
      /** Digg count range range in the form {"min": number, "max": number}. */
      "digg_count_range"?: {
        /** Maximum value. */
        "max"?: number;
        /** Minimum value. */
        "min"?: number;
      };
      /** Follower count range: {"min": number, "max": number}. */
      "follower_count_range"?: {
        /** Maximum value. */
        "max"?: number;
        /** Minimum value. */
        "min"?: number;
      };
      /** Interaction-rate range as percent-number values. Example: {"min":10,"max":20} means 10%-20%; pass 10 for 10%. */
      "interact_rate_range"?: {
        /** Maximum value. */
        "max"?: number;
        /** Minimum value. */
        "min"?: number;
      };
      /** Is ecommerce parameter. */
      "is_ecommerce"?: boolean;
      /** Play count range range in the form {"min": number, "max": number}. */
      "play_count_range"?: {
        /** Maximum value. */
        "max"?: number;
        /** Minimum value. */
        "min"?: number;
      };
      /** Product category ID. */
      "product_category_id"?: number;
      /** Country or region code, e.g. US, UK, ID. */
      "region"?: string;
    };
    /** Search keywords: product, shop, creator, video, live, or category terms. */
    "keywords"?: string;
    /** Language. Default EN_US, optional ZH_CN. */
    "lang"?: string;
    /** Sort options. */
    "orderby"?: Array<{
      "field"?: "follower_count" | "create_time" | "play_count" | "digg_count" | "units_sold" | "interact_rate";
      "order"?: "asc" | "desc";
    }>;
    /** Page number. Default 1, max 500. */
    "page"?: number;
    /** Page size. Default 10, max 10. */
    "pagesize"?: number;
  };
}

export type FastMossInput<TName extends keyof FastMossInputMap> =
  FastMossInputMap[TName];
