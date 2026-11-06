import { z } from "zod";
import { digest, requireThat } from "../common/core.mjs";
import { chineseSuggestionValue } from "../../web/features/ai-testing/suggestion-language.mjs";
import { fieldValue } from "./suggestion-value.mjs";
export { fieldValue } from "./suggestion-value.mjs";
import { faithfulChineseValue } from "./suggestion-language.mjs";
import { effectiveArm, DraftInput } from "./contract.mjs";

export const suggestionFields = {
  "product.name": "商品名称",
  "product.variant": "规格 / 款式",
  "product.use": "商品用途",
  "product.material": "材质",
  "product.dimensions": "外部尺寸",
  "product.inner_dimensions": "内部尺寸",
  "product.key_features": "核心卖点",
  "product.limitations": "适用限制",
  "pricing.current_price": "商品售价",
  "pricing.shipping": "运费说明",
  "pricing.delivery": "送达时间",
  shopper_problem: "消费者要解决的问题",
  usage_context: "使用场景",
  audience_description: "想测试的人群",
  question: "主要问题",
  follow_ups: "追问",
};
const creative = new Set([
  "product.use",
  "shopper_problem",
  "usage_context",
  "audience_description",
  "question",
  "follow_ups",
]);
export const blank = (v) =>
  v == null ||
  (Array.isArray(v)
    ? !v.some((x) => String(x).trim())
    : typeof v === "string" && !v.trim());
export function readField(data, arm, path) {
  const [group, key] = path.split(".");
  return key ? effectiveArm(data, arm)[group][key] : data[path];
}
export function sourceIdentity(d, arm) {
  if (!arm || (arm.id !== "A" && !arm.other_product) || !d.sources[arm.id])
    return null;
  return digest({
    source: d.sources[arm.id],
    market: d.data.market,
    currency: d.data.currency,
    product_id: arm.product_id,
    url: arm.url,
    other_product: arm.other_product,
  });
}
export function suggestionInput(d, armId) {
  const arm = d.data.arms.find((a) => a.id === armId);
  requireThat(sourceIdentity(d, arm), "ai_suggestion_source_missing", 409);
  const missing = Object.keys(suggestionFields).filter(
    (p) =>
      (armId === "A" || p.includes(".")) && blank(readField(d.data, arm, p)),
  );
  return {
    format_version: 2,
    product_background: d.sources[armId],
    market: d.data.market,
    currency: d.data.currency,
    current_product: effectiveArm(d.data, arm),
    scenario: Object.fromEntries(
      Object.keys(suggestionFields)
        .filter((p) => !p.includes("."))
        .map((p) => [p, d.data[p]]),
    ),
    missing_fields: missing,
    source_digest: sourceIdentity(d, arm),
  };
}
// Quotes are checked against source leaf values, never against the model's own response.
function leaves(value) {
  if (value == null) return [];
  if (typeof value !== "object") return [String(value)];
  return Object.values(value).flatMap(leaves);
}
export function validateSuggestions(value, request) {
  const parsed = z
    .object({
      suggestions: z
        .array(
          z
            .object({
              path: z.enum(Object.keys(suggestionFields)),
              value: z.unknown(),
              source_value: z.unknown().optional(),
              reason: z.string().trim().min(1).max(500),
              source_quote: z.string().max(1500).default(""),
            })
            .strict(),
        )
        .max(16),
    })
    .strict()
    .parse(value);
  const seen = new Set(),
    facts = leaves(request.product_background);
  return parsed.suggestions.filter((s) => {
    if (!request.missing_fields.includes(s.path) || seen.has(s.path))
      return false;
    seen.add(s.path);
    s.value = fieldValue(s.path, s.value);
    s.kind = creative.has(s.path) ? "suggestion" : "source";
    if (s.kind === "source") {
      if (request.format_version >= 2 && s.source_value === undefined)
        return false;
      const original = fieldValue(s.path, s.source_value ?? s.value);
      if (!s.source_quote || !facts.some((f) => f.includes(s.source_quote)))
        return false;
      if (
        !(Array.isArray(original) ? original : [original]).every((v) =>
          s.source_quote.includes(String(v)),
        )
      )
        return false;
      if (request.format_version >= 2)
        s.value = faithfulChineseValue(s.path, original, s.value);
    }
    if (request.format_version >= 2)
      requireThat(
        chineseSuggestionValue(s.path, s.value),
        "ai_suggestion_chinese_required",
        502,
      );
    return true;
  });
}
export function applySuggestions(d, row, values) {
  const arm = d.data.arms.find((a) => a.id === row.arm);
  requireThat(
    sourceIdentity(d, arm) === row.source_digest,
    "ai_suggestion_stale",
    409,
  );
  requireThat(row.state === "ready", "ai_suggestion_not_ready", 409);
  const applied = {},
    skipped = [];
  for (const [path, value] of Object.entries(values)) {
    requireThat(
      row.result.suggestions.some((s) => s.path === path),
      "ai_suggestion_field_invalid",
    );
    if (!blank(readField(d.data, arm, path))) {
      skipped.push(path);
      continue;
    }
    const checked = fieldValue(path, value),
      [group, key] = path.split(".");
    if (key) {
      arm[group][key] = checked;
      const inheritKey = group === "product" ? key : path;
      arm.inherit = arm.inherit.filter((p) => p !== inheritKey);
      if (["product.variant", "pricing.current_price"].includes(path)) {
        arm.image_id = null;
        if (arm.id === "A")
          for (const other of d.data.arms.slice(1))
            if (other.inherit.includes(inheritKey)) other.image_id = null;
      }
    } else d.data[path] = checked;
    applied[path] = checked;
  }
  d.data = DraftInput.parse(d.data);
  return { applied, skipped };
}
