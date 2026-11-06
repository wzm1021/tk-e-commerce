import test from "node:test";
import assert from "node:assert/strict";
import { makeApi } from "../web/lib/api.mjs";

function mockResponse(t, response) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  globalThis.document = { cookie: "tidelab_session_csrf=test-csrf" };
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "document", original);
    else delete globalThis.document;
  });
  t.mock.method(globalThis, "fetch", async () =>
    response instanceof Response ? response.clone() : response,
  );
}

test("HTML upload rejections retain HTTP status and show a readable size error", async (t) => {
  mockResponse(
    t,
    new Response("<html><h1>413 Request Entity Too Large</h1></html>", {
      status: 413,
      headers: { "content-type": "text/html" },
    }),
  );
  await assert.rejects(
    makeApi()("/api/ai-tests/draft/image", {
      method: "POST",
      body: { arm: "A", data: "base64" },
    }),
    {
      message: "上传内容超过服务器限制，请缩小图片或文件后重试",
      code: "body_too_large",
      status: 413,
    },
  );
});

test("empty gateway errors and malformed successful responses are explained", async (t) => {
  for (const [status, body, code] of [
    [502, "", "service_unavailable"],
    [503, "upstream unavailable", "service_unavailable"],
    [404, "<html>Not found</html>", "request_failed"],
    [200, "<html>Login page</html>", "invalid_response"],
    [413, "null", "body_too_large"],
  ]) {
    await t.test(String(status) + " " + code, async (t) => {
      mockResponse(t, new Response(body, { status }));
      await assert.rejects(makeApi()("/api/test"), { code, status });
    });
  }
});

test("JSON validation errors retain field details and existing translations", async (t) => {
  mockResponse(
    t,
    Response.json(
      {
        error: "ai_image_invalid",
        fields: [{ path: "data", message: "图片无法解码" }],
      },
      { status: 400 },
    ),
  );
  await assert.rejects(makeApi()("/api/test"), {
    message: "请使用有效的 PNG、JPEG 或 WebP 静态截图：填写内容：图片无法解码",
    code: "ai_image_invalid",
    status: 400,
  });
});

test("successful JSON still applies presentation and sends workspace and CSRF", async (t) => {
  mockResponse(t, Response.json({ name: "FastMoss 商品", value: "FastMoss" }));
  assert.deepEqual(
    await makeApi("web", "workspace")("/api/test", {
      method: "POST",
      body: { version: 2 },
    }),
    { name: "数据API 商品", value: "FastMoss" },
  );
  const [, request] = fetch.mock.calls[0].arguments;
  assert.equal(request.headers["X-Workspace-Id"], "workspace");
  assert.equal(request.headers["X-CSRF-Token"], "test-csrf");
  assert.equal(request.body, '{"version":2}');
});

test("aborted response reads preserve cancellation rather than replacing it", async (t) => {
  const aborted = new DOMException("Aborted", "AbortError");
  mockResponse(t, {
    status: 200,
    ok: true,
    json: async () => {
      throw aborted;
    },
  });
  await assert.rejects(makeApi()("/api/test"), (error) => error === aborted);
});

test("network failures and unknown API codes stay Chinese for both workbench and admin", async (t) => {
  mockResponse(
    t,
    Response.json({ error: "future_provider_error" }, { status: 502 }),
  );
  for (const audience of ["web", "admin"])
    await assert.rejects(
      makeApi(audience)("/api/test"),
      (e) =>
        e.code === "future_provider_error" &&
        /[\u3400-\u9fff]/u.test(e.message) &&
        !e.message.includes("future_provider_error"),
    );
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("Failed to fetch");
  });
  await assert.rejects(makeApi()("/api/test"), {
    code: "network_error",
    message: "网络连接中断，请检查网络后重试",
  });
});

test("upstream spec errors identify a concrete Chinese field and retain the error code", async (t) => {
  mockResponse(
    t,
    Response.json(
      {
        error: "ai_invalid_spec",
        fields: [
          {
            path: "arms.1.pricing.shipping",
            message: "Too big: expected string to have <=200 characters",
          },
        ],
      },
      { status: 502 },
    ),
  );
  await assert.rejects(
    makeApi()("/api/ai-tests/draft/estimate", { method: "POST", body: {} }),
    (e) => {
      assert.equal(e.code, "ai_invalid_spec");
      assert.match(
        e.message,
        /方案 B · 价格与配送 · 运费说明：请缩短至 200 个字符以内/,
      );
      assert.doesNotMatch(e.message, /ai_invalid_spec|Too big|arms\.1/);
      return true;
    },
  );
});
