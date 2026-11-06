import { randomUUID } from "node:crypto";
import { collectionPlan } from "../../src/monitoring/engine.mjs";
export const monitorConfig = { seller_id: "7494419524321642200", market: "US" };
// Synthetic values; field shapes were checked against archived FastMoss responses.
export function monitorSources(
  asOf = "2026-09-19T12:00:00.000Z",
  productIds = ["7494419524321642201"],
) {
  const shop = {
    ...monitorConfig,
    region: "US",
    currency_code: "USD",
    shop_name: "Synthetic shop",
    snapshot_at: asOf.slice(0, 10) + " 00:03:58",
  };
  const daily_trend = Array.from({ length: 28 }, (_, i) => ({
    date: new Date(Date.parse(asOf) - (29 - i) * 86400000)
      .toISOString()
      .slice(0, 10),
    daily_gmv: i >= 21 ? 300 : 100,
    daily_units_sold: i >= 21 ? 30 : 10,
  }));
  const values = [
    { shop: { ...shop } },
    { shop: { ...shop }, daily_trend },
    {
      shop: { ...shop },
      products: {
        total: 20,
        list: productIds.map((product_id) => ({
          product: { product_id, title: `Synthetic product ${product_id}` },
          performance_summary: {
            selected_window_days: 7,
            selected_window_gmv: 100,
            selected_window_units_sold: 5,
          },
        })),
      },
    },
  ];
  return new Map(
    collectionPlan(shop.seller_id).map((call, i) => {
      const invocation_id = randomUUID();
      return [
        invocation_id,
        {
          invocation_id,
          source: "FastMoss",
          tool: call.name,
          request: call.arguments,
          captured_at: asOf,
          result: {
            content: [{ type: "text", text: JSON.stringify(values[i]) }],
          },
          decoded: [{ content_index: 0, data: values[i] }],
        },
      ];
    }),
  );
}
