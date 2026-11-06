import test from "node:test";
import assert from "node:assert/strict";
import { BRAND_NAME, mailSenderName } from "../web/lib/brand.mjs";

test("existing default mail sender names adopt the brand without changing custom senders", () => {
  for (const legacy of [
    undefined,
    "",
    "Tidelab",
    "TIDE LAB",
    "潮准",
    "潮准 TideLab",
  ])
    assert.equal(mailSenderName(legacy), BRAND_NAME);
  assert.equal(mailSenderName(BRAND_NAME), BRAND_NAME);
  assert.equal(mailSenderName("客户服务团队"), "客户服务团队");
});
