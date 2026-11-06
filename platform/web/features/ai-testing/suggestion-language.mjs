// Product dimensions can remain universally readable numbers and measurement units.
export function chineseSuggestionValue(path, value) {
  if (typeof value === "number") return Number.isFinite(value);
  return (Array.isArray(value) ? value : [value]).every((text) => {
    if (typeof text !== "string" || !text.trim()) return false;
    if (/[\u3400-\u9fff]/.test(text)) return true;
    if (!["product.dimensions", "product.inner_dimensions"].includes(path))
      return false;
    return (
      /\d/.test(text) &&
      !/[^\d\s.,×x*+~–—\-()/"']/i.test(
        text.replace(/\b(?:mm|cm|m|inches|inch|in|ft)\b/gi, ""),
      )
    );
  });
}
export const needsChineseSuggestions = (suggestions) =>
  suggestions.some((s) => !chineseSuggestionValue(s.path, s.value));
