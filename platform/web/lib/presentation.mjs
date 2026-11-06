// Customer-facing wording only. IDs, provider kinds, links and evidence values
// stay intact so viewing a result cannot change a subsequent API operation.
export function displayText(value) {
  return String(value ?? "")
    .replace(
      /https?:\/\/(?:[\w-]+\.)*fastmoss\.com\b[^\s<>"'，。；）]*/gi,
      "数据API",
    )
    .replace(/fastmoss/gi, "数据API")
    .replace(
      /https?:\/\/(?:[\w-]+\.)*sellersprite\.com\b[^\s<>"'，。；）]*/gi,
      "电商数据",
    )
    .replace(/sellersprite|卖家精灵/gi, "电商数据");
}

const textFields = new Set([
  "title",
  "name",
  "label",
  "summary",
  "body",
  "answer",
  "reason",
  "description",
  "notice",
  "message",
  "notes",
  "source",
  "source_note",
  "assessment_summary",
  "rationale",
  "limitations",
  "questions",
  "assumptions",
  "discrepancies",
  "selection_rules",
]);
const opaqueFields = new Set([
  "value",
  "request",
  "input",
  "decoded",
  "envelope",
]);

export function customerPresentation(value, field = "") {
  if (opaqueFields.has(field)) return value;
  if (typeof value === "string")
    return textFields.has(field) ? displayText(value) : value;
  if (Array.isArray(value))
    return value.map((item) => customerPresentation(item, field));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        customerPresentation(item, key),
      ]),
    );
  return value;
}
