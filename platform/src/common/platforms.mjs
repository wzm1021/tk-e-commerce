// Shared request/UI identity. Missing platform is always a historical TikTok task.
export const PLATFORMS = {
  tiktok: {
    label: "TikTok Shop",
    provider: "fastmoss",
    source: "FastMoss",
    skill: "tiktok-product-scouting",
    markets: ["US", "GB", "TH", "VN", "MY", "ID", "PH", "SG", "MX", "BR"],
    windows: [7, 14, 28],
  },
  amazon: {
    label: "亚马逊",
    provider: "sellersprite",
    source: "SellerSprite",
    skill: "amazon-product-scouting",
    markets: ["US", "GB", "DE", "FR", "IT", "ES", "JP", "CA", "MX", "AU", "IN"],
    windows: [30, 90, 180, 365],
  },
};
export const MARKET_NAMES = {
  US: "美国",
  GB: "英国",
  TH: "泰国",
  VN: "越南",
  MY: "马来西亚",
  ID: "印度尼西亚",
  PH: "菲律宾",
  SG: "新加坡",
  MX: "墨西哥",
  BR: "巴西",
  DE: "德国",
  FR: "法国",
  IT: "意大利",
  ES: "西班牙",
  JP: "日本",
  CA: "加拿大",
  AU: "澳大利亚",
  IN: "印度",
};
export const TIKTOK_CURRENCIES = {
  US: "USD",
  GB: "GBP",
  TH: "THB",
  VN: "VND",
  MY: "MYR",
  ID: "IDR",
  PH: "PHP",
  SG: "SGD",
  MX: "MXN",
  BR: "BRL",
};
export const platformOf = (request) => request?.platform || "tiktok";
export const platformSpec = (request) => PLATFORMS[platformOf(request)];
