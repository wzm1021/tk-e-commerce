import { readFile } from "node:fs/promises";
import { requireThat } from "../common/core.mjs";
import { pointUnits } from "../common/data-points.mjs";

export const dataPriceCard = JSON.parse(
  await readFile(
    new URL("../../../schemas/fastmoss-pricing.json", import.meta.url),
    "utf8",
  ),
);

export function liveDataPrice(provider, tool) {
  if (provider === "sellersprite")
    return { version: "sellersprite-flat-v1", points: 1, units: 10n };
  requireThat(provider === "fastmoss", "data_provider_price_missing", 409);
  const price = dataPriceCard.tools[tool];
  requireThat(
    Number.isInteger(price) && price >= 0 && price <= 3,
    "data_tool_price_unconfirmed",
    409,
  );
  return {
    version: dataPriceCard.version,
    points: price,
    units: pointUnits(price),
  };
}

export function publicDataPricing(provider = "fastmoss") {
  return {
    version:
      provider === "fastmoss" ? dataPriceCard.version : "sellersprite-flat-v1",
    mode: provider === "fastmoss" ? "per_tool" : "flat",
    points_per_call: provider === "fastmoss" ? null : 1,
    points_per_snapshot: 0.3,
    tiers: provider === "fastmoss" ? dataPriceCard.tiers : null,
    tools: provider === "fastmoss" ? dataPriceCard.tools : null,
    free_outcomes:
      provider === "fastmoss" ? ["empty", "failed", "rate_limited"] : [],
  };
}
