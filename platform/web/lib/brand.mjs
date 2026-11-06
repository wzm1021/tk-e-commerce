export const BRAND_NAME_ZH = "探阔";
export const BRAND_NAME_EN = "Tanviko";
export const BRAND_NAME = `${BRAND_NAME_ZH} ${BRAND_NAME_EN}`;
export const BRAND_TAGLINE = "看清机会，行动有据。";

// Existing SMTP settings may still contain the former default sender name.
// Preserve custom sender names while presenting the current platform brand.
export function mailSenderName(value) {
  const name = typeof value === "string" ? value.trim() : "";
  return !name || /^(?:tide\s*lab|潮准(?:\s*tide\s*lab)?)$/i.test(name)
    ? BRAND_NAME
    : name;
}
