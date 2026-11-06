import test from "node:test";
import assert from "node:assert/strict";
import { workerRetry } from "../src/infra/worker-retry.mjs";
const wait = async () => {};
test("finish retries rolled-back transactions with the same draft, never uncertain requests", async () => {
  const draft = { candidates: [{ id: "original" }] };
  const submitted = [];
  const result = await workerRetry(
    async () => {
      submitted.push(draft);
      if (submitted.length < 3)
        throw Object.assign(Error(), { code: "transaction_retry" });
      return draft;
    },
    { wait },
  );
  assert.equal(result, draft);
  assert.equal(submitted.length, 3);
  assert.ok(submitted.every((x) => x === draft));
  for (const error of [
    new TypeError("transport"),
    Object.assign(Error(), { code: "lease_lost" }),
    Object.assign(Error(), { code: "evidence_value_mismatch" }),
  ]) {
    let count = 0;
    await assert.rejects(
      workerRetry(
        async () => {
          count++;
          throw error;
        },
        { wait },
      ),
      (e) => e === error,
    );
    assert.equal(count, 1);
  }
});
test("heartbeat tolerates temporary failures, bounds retries and immediately respects lost leases", async () => {
  let count = 0;
  await workerRetry(
    async () => {
      if (++count < 3) throw new TypeError("temporary");
      return {};
    },
    { heartbeat: true, wait },
  );
  assert.equal(count, 3);
  count = 0;
  await assert.rejects(
    workerRetry(
      async () => {
        count++;
        throw Object.assign(Error(), { status: 503 });
      },
      { heartbeat: true, wait },
    ),
  );
  assert.equal(count, 3);
  count = 0;
  await assert.rejects(
    workerRetry(
      async () => {
        count++;
        throw Object.assign(Error(), { code: "lease_lost", status: 409 });
      },
      { heartbeat: true, wait },
    ),
  );
  assert.equal(count, 1);
});
