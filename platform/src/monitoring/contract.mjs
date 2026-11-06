import { z } from "zod";
import { PLATFORMS } from "../common/platforms.mjs";
import { money, uuid, micro, requireThat } from "../common/core.mjs";
import { pointBudget, pointUnits } from "../common/data-points.mjs";

export const MonitorConfig = z
  .object({
    interval_hours: z
      .union([z.literal(12), z.literal(24), z.literal(168)])
      .default(24),
    model_connection_id: uuid.nullable().default(null),
    ai_enabled: z.boolean().default(true),
    model_budget: money.default("1"),
    data_budget: pointBudget(30).default(3),
    monthly_model_budget: money.default("30"),
    monthly_data_budget: pointBudget(2400).default(100),
    rules: z
      .object({
        percent: z.number().min(1).max(1000).default(30),
        gmv_absolute: z.number().min(1).max(1e12).default(1000),
        units_absolute: z.number().int().min(1).max(1e9).default(100),
        confirm_days: z.union([z.literal(1), z.literal(2)]).default(2),
      })
      .strict()
      .default({
        percent: 30,
        gmv_absolute: 1000,
        units_absolute: 100,
        confirm_days: 2,
      }),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      micro(v.model_budget) <= 0n ||
      micro(v.model_budget) > micro(v.monthly_model_budget)
    )
      ctx.addIssue({
        code: "custom",
        path: ["model_budget"],
        message: "单次模型预算需大于零且不超过月预算",
      });
    if (v.data_budget < 3 || v.data_budget > v.monthly_data_budget)
      ctx.addIssue({
        code: "custom",
        path: ["data_budget"],
        message: "单次数据预算至少 3 积分且不超过月预算",
      });
    if (v.interval_hours === 168 && v.rules.confirm_days !== 1)
      ctx.addIssue({
        code: "custom",
        path: ["rules", "confirm_days"],
        message: "周频巡检应选择 1 次确认",
      });
  });
export const MonitorInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    seller_id: z.string().regex(/^\d{1,40}$/),
    market: z.enum(PLATFORMS.tiktok.markets),
    config: MonitorConfig.default(() => MonitorConfig.parse({})),
  })
  .strict();

export function checkMonthlyBudget(config, used) {
  requireThat(
    BigInt(used.model) + micro(config.model_budget) <=
      micro(config.monthly_model_budget),
    "monitor_monthly_model_budget",
    409,
  );
  requireThat(
    BigInt(used.data) + pointUnits(config.data_budget) <=
      pointUnits(config.monthly_data_budget),
    "monitor_monthly_data_budget",
    409,
  );
}
