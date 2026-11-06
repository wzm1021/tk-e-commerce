import { z } from "zod";
export function fieldValue(path, value) {
  const array = [
    "product.key_features",
    "product.limitations",
    "follow_ups",
  ].includes(path);
  if (path === "pricing.current_price")
    return z.number().positive().finite().parse(value);
  if (array)
    return z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(path === "follow_ups" ? 300 : 200),
      )
      .min(1)
      .max(path === "follow_ups" ? 3 : 10)
      .parse(value);
  return z
    .string()
    .trim()
    .min(1)
    .max(path === "audience_description" ? 500 : 300)
    .parse(value);
}
