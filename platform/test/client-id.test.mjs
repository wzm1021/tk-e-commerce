import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { randomId } from "../web/lib/client-id.mjs";

test("public HTTP browsers can create distinct valid request UUIDs without randomUUID", () => {
  const httpCrypto = {
    getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
  };
  const ids = Array.from({ length: 300 }, () => randomId(httpCrypto));
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids)
    assert.match(
      id,
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
    );
  assert.throws(() => randomId({}), /浏览器/);
});
