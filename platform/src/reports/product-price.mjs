const numeric = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;
export const PRICE_UNIT_WARNING =
  "来源数值价格与展示售价的单位尚未核验，售价暂不用于筛选或利润计算；原始价格保留在来源证据中。";

// BR samples can mix centavos in numeric fields with reais in display text.
// Do not infer a country-wide /100 conversion or modify archived evidence.
export function productPriceWarning(product, market) {
  if (!product || !numeric(product.floor_price)) return null;
  if (
    market !== "BR" &&
    product.region !== "BR" &&
    product.currency_code !== "BRL"
  )
    return null;
  // Search uses R$ 29,90; detail uses separate R$29.90 display fields.
  const amount =
    "(\\d{1,3}(?:\\.\\d{3})*,\\d{2}|\\d{1,3}(?:,\\d{3})*\\.\\d{2}|\\d+[.,]\\d{2})";
  const parse = (value) => {
    const commaDecimal = value.at(-3) === ",";
    return Number(
      commaDecimal
        ? value.replaceAll(".", "").replace(",", ".")
        : value.replaceAll(",", ""),
    );
  };
  const lows = [],
    highs = [];
  for (const [field, values] of [
    ["floor_price_display", lows],
    ["ceiling_price_display", highs],
  ]) {
    if (!product[field]) continue;
    const match = new RegExp(`^R\\$\\s*${amount}$`).exec(
      String(product[field]).trim(),
    );
    if (!match) return PRICE_UNIT_WARNING;
    values.push(parse(match[1]));
  }
  if (product.price_display) {
    const match = new RegExp(
      `^R\\$\\s*${amount}(?:\\s*[-–—]\\s*(?:R\\$\\s*)?${amount})?$`,
    ).exec(String(product.price_display).trim());
    if (!match) return PRICE_UNIT_WARNING;
    lows.push(parse(match[1]));
    highs.push(parse(match[2] || match[1]));
  }
  if (!lows.length) return PRICE_UNIT_WARNING;
  if (highs.some((high) => high < Math.max(...lows))) return PRICE_UNIT_WARNING;
  if (!highs.length && product.ceiling_price === product.floor_price)
    highs.push(...lows);
  if (
    lows.some(
      (low) =>
        !Number.isFinite(low) || Math.abs(product.floor_price - low) > 0.005,
    ) ||
    (numeric(product.ceiling_price) &&
      (!highs.length ||
        product.ceiling_price < product.floor_price ||
        highs.some(
          (high) =>
            !Number.isFinite(high) ||
            Math.abs(product.ceiling_price - high) > 0.005,
        )))
  )
    return PRICE_UNIT_WARNING;
  return null;
}
