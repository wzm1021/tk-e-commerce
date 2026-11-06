import test from "node:test";
import assert from "node:assert/strict";
import { allowedOrigins, fromPublicProxy } from "../src/infra/http-access.mjs";

test("HTTP beta origins must be explicit and exact; wildcard or malformed configuration fails closed", () => {
  const local = "http://127.0.0.1:4310",
    remote = "http://203.0.113.10:4310";
  const origins = allowedOrigins([local, remote, local]);
  assert.equal(origins.size, 2);
  assert.ok(origins.has(remote));
  for (const value of [
    remote + ".evil",
    remote + "/",
    "null",
    "https://203.0.113.10:4310",
    "http://203.0.113.10",
  ])
    assert.ok(!origins.has(value));
  for (const invalid of [
    [],
    ["*"],
    ["null"],
    [remote + "/path"],
    [remote + "?next=x"],
    ["http://user:pass@example.com"],
    ["file:///tmp/test"],
    [""],
  ])
    assert.throws(() => allowedOrigins(invalid));
});

test("public-ingress marker is accepted only from the local proxy socket", () => {
  const request = (address, marker) => ({
    raw: { socket: { remoteAddress: address } },
    headers: { "x-tidelab-public-ingress": marker },
  });
  for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1"])
    assert.equal(fromPublicProxy(request(address, "1")), true);
  assert.equal(fromPublicProxy(request("203.0.113.3", "1")), false);
  assert.equal(fromPublicProxy(request("127.0.0.1", undefined)), false);
  assert.equal(fromPublicProxy(request("127.0.0.1", ["1", "1"])), false);
});
