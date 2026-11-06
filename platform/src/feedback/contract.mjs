import { z } from "zod";
export const FILE_LIMIT = 5 * 1024 * 1024,
  TOTAL_LIMIT = 10 * 1024 * 1024;
export const FeedbackInput = z
  .object({
    id: z.string().uuid(),
    category: z.enum(["problem", "data", "suggestion", "other"]),
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(10000),
    attachments: z
      .array(z.string().uuid())
      .max(5)
      .refine((v) => new Set(v).size === v.length),
    context: z
      .object({
        kind: z.enum(["page", "job", "report", "ai_test"]),
        id: z.string().max(80),
        workspace_id: z.string().uuid().optional(),
      })
      .strict()
      .nullable()
      .default(null),
  })
  .strict();
const email = z
  .string()
  .trim()
  .email()
  .max(254)
  .transform((v) => v.toLowerCase());
export const FeedbackMailConfig = z
  .object({
    enabled: z.boolean(),
    owner_email: email,
    sales_emails: z.array(email).min(1).max(10),
  })
  .strict();
export const categories = {
  problem: "问题故障",
  data: "数据异常",
  suggestion: "功能建议",
  other: "其他",
};
export const publicFile = ({ id, name, mime, size_bytes }) => ({
  id,
  name,
  mime,
  size_bytes,
});
export function notificationState(rows, planned) {
  if (!rows.length) return planned ? "pending" : "pending_configuration";
  if (rows.every((x) => x.state === "accepted")) return "accepted";
  if (rows.some((x) => x.state === "uncertain")) return "uncertain";
  if (rows.some((x) => x.state === "failed")) return "failed";
  return "pending";
}
