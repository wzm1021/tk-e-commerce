export const AI_TEST_PERSONA_MIN = 10;
export const AI_TEST_PERSONA_MAX = 20;
export const AI_TEST_PERSONA_DEFAULT = 20;
export const AI_TEST_PERSONA_ERROR =
  "虚拟消费者人数须为 10–20 的整数，每次最多 20 人。";
export const AI_TEST_PRODUCT_URL_MAX = 8192;
export const AI_TEST_PRODUCT_URL_ERROR =
  "商品页面链接过长（最多 8,192 字符），请从商品详情页复制较短的链接后重试。";

export function productLinkError(arm) {
  return arm.url.length > AI_TEST_PRODUCT_URL_MAX
    ? `方案 ${arm.id}：${AI_TEST_PRODUCT_URL_ERROR}`
    : "";
}

export function validPersonaCount(value) {
  return (
    Number.isInteger(value) &&
    value >= AI_TEST_PERSONA_MIN &&
    value <= AI_TEST_PERSONA_MAX
  );
}
