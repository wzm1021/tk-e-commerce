import { z } from "zod";
import {
  fieldLabel,
  validationFields,
  validationMessage,
} from "../../web/lib/validation-errors.mjs";

// FacetLab Product Tests API v1, https://qyzkdesign.com/docs (2026-10-21).
// Used only to recover a precise path from flattened provider errors, never to
// alter the customer's data or claim that an unreported constraint failed.
const text = (max) => z.string().trim().min(1).max(max);
const optional = (max) => text(max).optional();
const facts = z.object({
  name: optional(300),
  variant: optional(300),
  use: optional(300),
  material: optional(300),
  dimensions: optional(300),
  inner_dimensions: optional(300),
  key_features: z.array(text(200)).max(10).optional(),
  limitations: z.array(text(200)).max(10).optional(),
});
const prices = z.object({
  current_price: z.number().positive().optional(),
  shipping: optional(200),
  delivery: optional(200),
});
const specSchema = z.object({
  name: text(200),
  material_language: optional(20),
  product: facts.extend({
    name: text(300),
    url: optional(500),
    asin: optional(300),
    platform_product_id: optional(300),
  }),
  pricing: prices,
  scenario: z
    .object({ shopper_problem: optional(300), usage_context: optional(300) })
    .optional(),
  audience: z.object({ description: optional(500) }).optional(),
  question: z.object({
    primary: text(300),
    follow_ups: z.array(text(300)).max(3).optional(),
  }),
  arms: z
    .array(
      z.object({
        label: text(120),
        change_summary: optional(300),
        product: facts.optional(),
        pricing: prices.optional(),
      }),
    )
    .min(2)
    .max(6),
  persona_count: z.number().int().min(10).max(200).optional(),
  sessions_per_arm: z.number().int().min(3).max(10).optional(),
});
const groups = new Set([
  "name",
  "market",
  "currency",
  "material_language",
  "product",
  "pricing",
  "scenario",
  "audience",
  "question",
  "arms",
  "persona_count",
  "sessions_per_arm",
  "external_ref",
]);
function safePath(value) {
  const path = Array.isArray(value)
    ? value.join(".")
    : typeof value === "string"
      ? value.replace(/\[(\d+)\]/g, ".$1")
      : "";
  return path.length <= 160 &&
    groups.has(path.split(".")[0]) &&
    !fieldLabel(path).includes("填写项")
    ? path
    : "";
}
export function providerValidationFields(details, spec) {
  const parsed = specSchema.safeParse(spec);
  const localIssues = parsed.success ? [] : parsed.error.issues;
  const issues = [];
  const precise = details?.issues || details?.errors;
  if (Array.isArray(precise))
    for (const item of precise.slice(0, 12)) {
      const path = safePath(item?.path);
      if (!path) continue;
      issues.push({
        path,
        message: validationMessage(
          {
            code: item.code,
            message: item.message,
            origin: item.origin,
            expected: item.expected,
            format: item.format,
            minimum: item.minimum,
            maximum: item.maximum,
            inclusive: item.inclusive,
          },
          { trusted: false },
        ),
      });
    }
  if (
    !issues.length &&
    details?.fieldErrors &&
    typeof details.fieldErrors === "object"
  ) {
    for (const [field, messages] of Object.entries(details.fieldErrors).slice(
      0,
      12,
    )) {
      const path = safePath(field);
      if (!path || !Array.isArray(messages)) continue;
      const matched = localIssues.filter(
        (x) =>
          x.path.join(".") === path || x.path.join(".").startsWith(path + "."),
      );
      if (matched.length) issues.push(...matched);
      else
        for (const message of messages.slice(0, 3)) {
          const remedy = validationMessage({ message }, { trusted: false });
          issues.push({
            path,
            message:
              remedy +
              (groups.has(path) &&
              [
                "product",
                "pricing",
                "scenario",
                "audience",
                "question",
                "arms",
              ].includes(path)
                ? "；服务只标明了此分组，请检查该组内容"
                : ""),
          });
        }
    }
  }
  if (!issues.length)
    issues.push({
      path: "",
      message:
        "测品服务未返回具体字段，请重新核对草稿；若仍失败，请联系平台管理员",
    });
  const unique = [
    ...new Map(
      validationFields(issues, "ai-testing").map((x) => [
        x.path + x.message,
        x,
      ]),
    ).values(),
  ];
  return unique.slice(0, 12);
}
