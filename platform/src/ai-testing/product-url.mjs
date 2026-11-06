import { requireThat } from "../common/core.mjs";

const SDK_URL_MAX = 500;
const amazonHosts = {
  amazon_us: "amazon.com",
  amazon_uk: "amazon.co.uk",
  amazon_jp: "amazon.co.jp",
};
const tracking = new Set([
  "ref",
  "ref_",
  "tag",
  "linkCode",
  "linkId",
  "ascsubtag",
  "dib",
  "dib_tag",
  "qid",
  "sr",
  "sprefix",
  "crid",
  "keywords",
]);

// Keep the original URL in drafts, screenshots and confirmation. Only adapt the
// SDK's shared product URL, whose upstream schema still caps it at 500 characters.
export function productTestUrl(value, market, productId) {
  if (value.length <= SDK_URL_MAX) return value;
  const url = new URL(value),
    host = amazonHosts[market],
    asin = url.pathname.match(
      /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:\/|$)/,
    )?.[1];
  requireThat(
    host &&
      [host, `www.${host}`].includes(url.hostname) &&
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      asin,
    "ai_product_link_too_long",
  );
  requireThat(!productId || asin === productId, "ai_product_link_identity");
  url.pathname = `/dp/${asin}`;
  for (const key of [...url.searchParams.keys()])
    if (tracking.has(key) || /^(?:utm_|pd_rd_|pf_rd_)/.test(key))
      url.searchParams.delete(key);
  // Seller, offer, variant and unknown parameters must never be truncated.
  requireThat(url.href.length <= SDK_URL_MAX, "ai_product_link_too_long");
  return url.href;
}
