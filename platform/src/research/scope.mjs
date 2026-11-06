import { z } from "zod";

export const SPECIALIST_KINDS = [
  "competitor",
  "content",
  "reviews",
  "ads",
  "diagnostics",
];

export function researchKinds(scope) {
  const value = z
    .enum(["scouting", "specialist", "monitoring"])
    .optional()
    .parse(scope);
  if (value === "monitoring") return ["monitoring"];
  return value === "scouting"
    ? ["scouting"]
    : value === "specialist"
      ? SPECIALIST_KINDS
      : null;
}
