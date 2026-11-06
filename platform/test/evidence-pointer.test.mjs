import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalEvidencePointer,
  decodeMcpContent,
} from "../src/data/evidence.mjs";
import { pointer } from "../src/reports/reports.mjs";
test("real MCP text shape: normalize exact values and video URLs without changing facts", () => {
  const result = {
    content: [
      { type: "text", text: "not JSON" },
      {
        type: "text",
        text: '{"product":{"id":1732603669387448750,"rating":4.2},"videos":[{"url":"https://www.tiktok.com/@a/video/123"}],"a/b":{"~x":null}}',
      },
    ],
  };
  const envelope = {
    source: "FastMoss",
    result,
    decoded: decodeMcpContent(result),
  };
  for (const [suffix, value] of [
    ["/product/id", "1732603669387448750"],
    ["/product/rating", 4.2],
    ["/videos/0/url", "https://www.tiktok.com/@a/video/123"],
    ["/a~1b/~0x", null],
  ]) {
    const original = "/result/content/1/text" + suffix;
    const corrected = canonicalEvidencePointer(envelope, original, value);
    assert.equal(corrected, "/decoded/0/data" + suffix);
    assert.deepEqual(pointer(envelope, corrected), value);
  }
  for (const value of [4.3, "4.2", null]) {
    const original = "/result/content/1/text/product/rating";
    assert.equal(canonicalEvidencePointer(envelope, original, value), original);
  }
  const original = "/result/content/1/text/product/rating";
  envelope.decoded[0].data.product.rating = 4.3;
  assert.equal(canonicalEvidencePointer(envelope, original, 4.3), original);
  assert.equal(canonicalEvidencePointer(undefined, original, 4.2), original);
  assert.equal(
    canonicalEvidencePointer(envelope, "/wrong/path", 4.2),
    "/wrong/path",
  );
});
