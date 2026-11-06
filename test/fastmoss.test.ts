import assert from "node:assert/strict";
import test from "node:test";
import { FastMossClient } from "../src/fastmoss/client.ts";
import { compareNumericMetrics } from "../src/cross-validation.ts";

test("FastMoss 客户端添加 api_key 并解析工具文本 JSON", async () => {
  let call = 0;
  const mockFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    call += 1;
    assert.equal(new URL(String(input)).searchParams.get("api_key"), "test-key");
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (call === 1) {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: { protocolVersion: "2025-06-18", capabilities: {} },
        }),
      );
    }
    if (call === 2) return new Response(null, { status: 204 });

    assert.equal(body.params.name, "product_search");
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          content: [
            { type: "text", text: '{"items":[{"product_id":"123"}]}' },
          ],
        },
      }),
    );
  }) as typeof fetch;

  const client = new FastMossClient({
    apiKey: "test-key",
    fetchImplementation: mockFetch,
  });
  const response = await client.products.search({ keywords: "beauty" });
  assert.deepEqual(response.data, { items: [{ product_id: "123" }] });
});

test("交叉验证器按相对差异标记结果", () => {
  const result = compareNumericMetrics(
    {
      source: "clawec",
      entityType: "product",
      entityId: "123",
      metric: "day7_gmv",
      value: 100,
      unit: "USD",
      period: "7d",
      asOf: "2026-08-28",
    },
    {
      source: "fastmoss",
      entityType: "product",
      entityId: "123",
      metric: "day7_gmv",
      value: 110,
      unit: "USD",
      period: "7d",
      asOf: "2026-08-28",
    },
  );

  assert.equal(result.status, "warning");
  assert.equal(result.absoluteDifference, 10);
});
