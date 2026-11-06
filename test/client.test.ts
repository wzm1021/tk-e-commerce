import assert from "node:assert/strict";
import test from "node:test";
import { TikTokDataClient } from "../src/client.ts";
import { McpRpcError } from "../src/mcp-client.ts";

function makeMockFetch(businessResponse: object): typeof fetch {
  let call = 0;

  return (async (_input: string | URL | Request, init?: RequestInit) => {
    call += 1;
    const body = JSON.parse(String(init?.body ?? "{}"));

    if (call === 1) {
      assert.equal(body.method, "initialize");
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "test", version: "1" },
          },
        }),
        { headers: { "Mcp-Session-Id": "test-session" } },
      );
    }

    if (call === 2) {
      assert.equal(body.method, "notifications/initialized");
      assert.equal(
        new Headers(init?.headers).get("Mcp-Session-Id"),
        "test-session",
      );
      return new Response(null, { status: 204 });
    }

    assert.equal(body.method, "tools/call");
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          content: [{ type: "text", text: JSON.stringify(businessResponse) }],
        },
      }),
    );
  }) as typeof fetch;
}

test("初始化会话并解析 content[].text 内的业务 JSON", async () => {
  const client = new TikTokDataClient({
    endpoint: "https://example.test/mcp?key=secret&id=source",
    fetchImplementation: makeMockFetch({
      status: 1,
      code: 200,
      msg: "success",
      data: { list: [{ uid: "123" }], total: 1 },
      extra: '{"title":"达人搜索"}',
    }),
  });

  const response = await client.creators.search({
    region: "US",
    keywords: "beauty",
  });

  assert.equal(response.data.total, 1);
  assert.equal(response.data.list[0]?.uid, "123");
  assert.equal(client.mcp.sessionId, "test-session");
});

test("业务错误会抛出带 code 的 McpRpcError", async () => {
  const client = new TikTokDataClient({
    endpoint: "https://example.test/mcp",
    fetchImplementation: makeMockFetch({
      status: 0,
      code: 422,
      msg: "invalid region",
      data: null,
    }),
  });

  await assert.rejects(
    client.market.categoryRanking({ region: "XX" }),
    (error: unknown) =>
      error instanceof McpRpcError &&
      error.code === 422 &&
      error.message.includes("invalid region"),
  );
});

test("支持不返回 session id 的无状态 MCP 服务", async () => {
  let call = 0;
  const mockFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    call += 1;
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
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  const client = new TikTokDataClient({
    endpoint: "https://stateless.example.test/mcp",
    fetchImplementation: mockFetch,
  });
  await client.initialize();
  assert.equal(client.mcp.sessionId, undefined);
});
