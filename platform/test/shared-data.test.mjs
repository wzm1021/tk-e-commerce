import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { createDatabase } from "../src/infra/db.mjs";
import { buildApp } from "../src/server.mjs";
import {
  id,
  digest,
  AppError,
  PriceSchema,
  passwordHash,
} from "../src/common/core.mjs";
import {
  pointUnits,
  points,
  publicBilling,
} from "../src/common/data-points.mjs";
import { snapshotKey, reusableResponse } from "../src/data/data-cache.mjs";
import { ResourceGate, resourceFor } from "../src/data/resources.mjs";
import { signJob, reserveJob, finalizeJob } from "../src/research/jobs.mjs";
import { creditWallet } from "../src/admin/admin.mjs";
import { LocalStore, SecretStore } from "../src/infra/storage.mjs";
import { backfillData } from "../scripts/backfill-data.mjs";
import { beginInvocation, settleInvocation } from "../src/data/gateway.mjs";

test("fractional point billing preserves historical ledger units and opaque product fields", () => {
  assert.equal(pointUnits("0.3"), 3n);
  assert.equal(points(33n), "3.3");
  for (const n of ["0.03", "-1", "1e4", "NaN"])
    assert.throws(() => pointUnits(n));
  const input = {
    data_spent: "13",
    request: { data_spent: "999" },
    wallets: [{ currency: "data_points", available: "17", reserved: "3" }],
    ledger: [
      { currency: "data_points", amount: "10", data_unit_scale: 1 },
      { currency: "data_points", amount: "3", data_unit_scale: 10 },
    ],
    items: [
      { kind: "model", charged: "32" },
      { kind: "data", charged: "3" },
    ],
  };
  const out = publicBilling(input);
  assert.equal(out.data_spent, "1.3");
  assert.equal(out.request.data_spent, "999");
  assert.equal(out.wallets[0].available, "1.7");
  assert.deepEqual(
    out.ledger.map((x) => x.amount),
    ["10", "0.3"],
  );
  assert.deepEqual(
    out.items.map((x) => x.charged),
    ["32", "0.3"],
  );
  assert.equal(input.data_spent, "13");
});
test("snapshot identity includes source, permission scope and schema, preserves IDs and parameter values", () => {
  const m = {
    connectionId: id(),
    config: { endpoint: "https://mcp.fastmoss.com/mcp" },
    workspace: id(),
    shared: true,
    tool: "product_detail_info",
    schema: { type: "object" },
    args: { b: 2, a: { product_id: "1732563767390343216" } },
  };
  assert.equal(
    snapshotKey(m),
    snapshotKey({
      ...m,
      workspace: id(),
      args: { a: { product_id: "1732563767390343216" }, b: 2 },
    }),
  );
  for (const v of [
    { shared: false },
    { connectionId: id() },
    { schema: { type: "array" } },
    { args: { ...m.args, b: "2" } },
    { args: { ...m.args, a: { product_id: "1732563767390343217" } } },
  ])
    assert.notEqual(snapshotKey(m), snapshotKey({ ...m, ...v }));
  assert.equal(
    reusableResponse({ content: [{ type: "text", text: '{"data":[]}' }] }),
    true,
  );
  assert.equal(reusableResponse({ isError: true, content: [] }), false);
  assert.equal(
    reusableResponse({
      content: [{ type: "text", text: '{"code":500,"error":"unavailable"}' }],
    }),
    false,
  );
});

test(
  "shared gateway: concurrency, durable snapshots, fractional charging and tenant isolation",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const db = createDatabase(process.env.TEST_DATABASE_URL),
      db2 = createDatabase(process.env.TEST_DATABASE_URL);
    const root = await mkdtemp(path.join(tmpdir(), "tidelab-cache-test-"));
    const store = new LocalStore(root),
      secrets = new SecretStore(root, randomBytes(32)),
      workerKey = randomBytes(32);
    const tenants = [id(), id(), id()],
      actor = id(),
      login = "cache-test-" + id(),
      password = "cache-validation-" + id(),
      origin = "http://127.0.0.1:4310";
    const cid = id(),
      mid = id(),
      vid = id(),
      mvid = id(),
      key = "test-resource-" + cid;
    const dataConfig = {
      endpoint: "https://mcp.fastmoss.com/mcp",
      protocol: "mcp",
    };
    const modelConfig = {
      endpoint: "https://model-cache-validation.invalid/responses",
      model: "fixture",
      protocol: "responses",
    };
    const price = PriceSchema.parse({
      currency: "USD",
      fx: "7",
      market: {
        input: "1",
        output: "2",
        cache_read: "0.1",
        cache_write: "0.1",
      },
      procurement_discount: "1",
      sale_discount: "1.5",
      max_context_tokens: 64000,
      max_output_tokens: 128,
    });
    let apps = [],
      live = 0,
      models = 0,
      modelActive = 0,
      modelPeak = 0,
      allJobs = [];
    const fakeData = async (_endpoint, _secret, _method, v, { onResponse }) => {
      live++;
      await sleep(100);
      const product_id = v.arguments.filter?.product_id || v.name;
      if (["definite-failure", "rate-limit"].includes(product_id))
        throw new AppError("fastmoss_http_error", 502, {
          data_no_charge: true,
          outcome: product_id === "rate-limit" ? "rate_limited" : "failed",
        });
      if (product_id === "uncertain") {
        await onResponse({
          status: 503,
          raw: '{"error":"fixture upstream unavailable"}',
        });
        throw new AppError("provider_transport_uncertain", 502);
      }
      const result = {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              product_id === "empty-result"
                ? { code: 0, data: [] }
                : product_id === "business-error"
                  ? { code: 500, error: "fixture" }
                  : { code: 0, data: { product_id, price: 6.99, rating: 4.4 } },
            ),
          },
        ],
      };
      await onResponse({
        status: 200,
        raw: JSON.stringify({ jsonrpc: "2.0", id: 3, result }),
      });
      return result;
    };
    const modelRequests = [];
    const fakeModel = async (_url, options) => {
      modelRequests.push(JSON.parse(options.body));
      models++;
      modelPeak = Math.max(modelPeak, ++modelActive);
      await sleep(150);
      return {
        response: new Response(
          JSON.stringify({
            id: id(),
            status: "completed",
            output: [],
            usage: { input_tokens: 10, output_tokens: 2 },
          }),
          { headers: { "content-type": "application/json" } },
        ),
        close: async () => {
          modelActive--;
        },
      };
    };
    async function job(w = tenants[0], budget = 10n, modelPrice = price) {
      const j = {
        id: id(),
        kind: "assistant",
        data_budget: String(budget),
        model_budget: "2000000",
        request: {},
        snapshot: {
          data: { id: cid, config: dataConfig },
          model: { id: mid, config: modelConfig, price: modelPrice },
          skill: { version: 1 },
        },
      };
      const scope = {
        workspace_id: w,
        job_id: j.id,
        worker_id: "cache-worker",
        fence: "1",
        exp: Date.now() + 3600000,
      };
      await db.tenant(w, async (c) => {
        await c.query(
          "INSERT INTO jobs(id,workspace_id,created_by,kind,title,request,snapshot,status,idempotency_key,data_budget,model_budget,worker_id,fence,lease_expires_at) VALUES($1,$2,$3,'assistant','mock cache test','{}',$4,'running',$5,$6,$7,'cache-worker',1,now()+interval '20 minutes')",
          [j.id, w, actor, j.snapshot, id(), j.data_budget, j.model_budget],
        );
        await reserveJob(c, w, j);
      });
      allJobs.push(scope);
      return scope;
    }
    const call = (scope, product = "1732563767390343216", appIndex = 0) =>
      apps[appIndex].inject({
        method: "POST",
        url: "/internal/job/data",
        headers: { authorization: "Bearer " + signJob(workerKey, scope) },
        payload: {
          name: "product_detail_info",
          arguments: { filter: { product_id: product } },
        },
      });
    const readJob = (s) =>
      db.tenant(
        s.workspace_id,
        async (c) =>
          (await c.query("SELECT * FROM jobs WHERE id=$1", [s.job_id])).rows[0],
      );
    const callTool = (scope, name, args) =>
      apps[0].inject({
        method: "POST",
        url: "/internal/job/data",
        headers: { authorization: "Bearer " + signJob(workerKey, scope) },
        payload: { name, arguments: args },
      });
    try {
      await db.tx(null, async (c) => {
        for (const w of tenants)
          await c.query("INSERT INTO workspaces(id,name) VALUES($1,$2)", [
            w,
            "cache validation " + w,
          ]);
        await c.query(
          "INSERT INTO users(id,login,password_hash,display_name,is_admin) VALUES($1,$2,$3,$4,true)",
          [actor, login, await passwordHash(password), "cache validation"],
        );
        for (const [connection, version, kind, config] of [
          [cid, vid, "fastmoss", dataConfig],
          [mid, mvid, "model", modelConfig],
        ]) {
          const secret = await secrets.write(
            "fixture-key-not-a-real-credential",
            `${connection}:${version}`,
          );
          await c.query(
            "INSERT INTO connections(id,name,kind,share_market_snapshots) VALUES($1,$2,$3,true)",
            [connection, "cache-validation-" + cid, kind],
          );
          await c.query(
            "INSERT INTO connection_versions(id,connection_id,config,secret_ref,verified) VALUES($1,$2,$3,$4,true)",
            [version, connection, config, secret],
          );
          await c.query(
            "UPDATE connections SET active_version_id=$2,enabled=true WHERE id=$1",
            [connection, version],
          );
          for (const w of tenants.slice(0, 2))
            await c.query(
              "INSERT INTO workspace_connections(workspace_id,connection_id) VALUES($1,$2)",
              [w, connection],
            );
        }
      });
      for (const w of tenants)
        await db.tenant(w, async (c) => {
          await c.query(
            "INSERT INTO memberships(user_id,workspace_id,role) VALUES($1,$2,'owner')",
            [actor, w],
          );
          await creditWallet(
            c,
            w,
            "data_points",
            10000n,
            "cache-fixture-" + w,
            {},
          );
          await creditWallet(
            c,
            w,
            "model_micro_cny",
            500000000n,
            "cache-fixture-" + w,
            {},
          );
        });
      for (const d of [db, db2]) {
        const app = await buildApp({
          db: d,
          store,
          secrets,
          workerKey,
          publicOrigin: origin,
          projectRoot: path.resolve(".."),
          gatewayOverrides: {
            dataRpc: fakeData,
            modelFetch: fakeModel,
            resourceOptions: { waitMs: 15000, pollMs: 20 },
            cacheOptions: { waitMs: 45000, pollMs: 150 },
          },
        });
        await app.ready();
        apps.push(app);
      }
      let first;
      await t.test(
        "32 parallel identical requests across two API instances purchase once and each consumer owns its evidence",
        async () => {
          const scopes = [];
          for (let i = 0; i < 32; i++) scopes.push(await job(tenants[i % 2]));
          const started = Date.now();
          const responses = await Promise.all(
            scopes.map((s, i) => call(s, undefined, i % 2)),
          );
          for (const r of responses) assert.equal(r.statusCode, 200, r.body);
          assert.equal(live, 1);
          assert.equal(responses.filter((r) => r.json().cache_hit).length, 31);
          const payloads = responses.map((r) => r.json());
          assert.equal(new Set(payloads.map((p) => p.snapshot_id)).size, 1);
          assert.equal(new Set(payloads.map((p) => p.invocation_id)).size, 32);
          assert.equal(new Set(payloads.map((p) => p.captured_at)).size, 1);
          let sum = 0n;
          for (const s of scopes) {
            const j = await readJob(s);
            sum += BigInt(j.data_spent);
            assert.equal(j.data_inflight, "0");
          }
          assert.equal(sum, 103n);
          first = { scope: scopes[0], payload: payloads[0] };
          const replay = await call(scopes[0]);
          assert.equal(replay.json().invocation_id, payloads[0].invocation_id);
          assert.equal(live, 1);
          const snap = await db.tenant(
            tenants[0],
            async (c) =>
              (
                await c.query("SELECT * FROM data_snapshots WHERE id=$1", [
                  payloads[0].snapshot_id,
                ])
              ).rows[0],
          );
          assert.equal(snap.sha256, digest(snap.payload));
          assert.equal(
            (
              await db.tenant(tenants[2], (c) =>
                c.query("SELECT id FROM data_snapshots WHERE id=$1", [snap.id]),
              )
            ).rowCount,
            0,
          );
          const denied = await call(await job(tenants[2]));
          assert.equal(denied.statusCode, 409);
          assert.equal(live, 1);
          t.diagnostic(
            `32 requests / 2 API instances: ${Date.now() - started}ms; 1 live + 31 hits = 10.3 points`,
          );
        },
      );
      await t.test(
        "a 0.3-point budget can use a snapshot and a miss never purchases with insufficient funds",
        async () => {
          const s = await job(tenants[0], 3n);
          assert.equal((await call(s)).statusCode, 200);
          assert.equal((await readJob(s)).data_spent, "3");
          const before = live,
            miss = await job(tenants[0], 3n);
          assert.equal((await call(miss, "budget-miss")).statusCode, 409);
          assert.equal(live, before);
          assert.equal((await readJob(miss)).data_inflight, "0");
        },
      );
      await t.test(
        "expiry refreshes and retains immutable history; private scopes do not share across tenants",
        async () => {
          await db.query(
            "INSERT INTO data_cache_policies(tool,ttl_seconds) VALUES('product_detail_info',0) ON CONFLICT(tool) DO UPDATE SET ttl_seconds=0",
          );
          const before = live;
          assert.equal((await call(await job())).json().cache_hit, false);
          assert.equal(live, before + 1);
          await db.query(
            "DELETE FROM data_cache_policies WHERE tool='product_detail_info'",
          );
          await db.query(
            "UPDATE connections SET share_market_snapshots=false WHERE id=$1",
            [cid],
          );
          const a = await call(await job(tenants[0]), "private-sku"),
            b = await call(await job(tenants[1]), "private-sku");
          assert.equal(a.statusCode, 200, a.body);
          assert.equal(b.statusCode, 200, b.body);
          assert.notEqual(a.json().snapshot_id, b.json().snapshot_id);
          assert.equal(
            (
              await db.tenant(tenants[1], (c) =>
                c.query("SELECT id FROM data_snapshots WHERE id=$1", [
                  a.json().snapshot_id,
                ]),
              )
            ).rowCount,
            0,
          );
          await assert.rejects(
            () =>
              db.tenant(tenants[0], (c) =>
                c.query("UPDATE data_snapshots SET payload='{}' WHERE id=$1", [
                  a.json().snapshot_id,
                ]),
              ),
            (e) => e.code === "42501",
          );
          await db.query(
            "UPDATE connections SET share_market_snapshots=true WHERE id=$1",
            [cid],
          );
        },
      );
      await t.test(
        "error responses are archived but cannot masquerade as cached facts; ambiguous calls block repurchase",
        async () => {
          const a = await call(await job(), "business-error");
          assert.equal(a.statusCode, 200, a.body);
          assert.equal(a.json().cache_hit, false);
          assert.equal(a.json().points_charged, 0);
          const snap = await db.tenant(
            tenants[0],
            async (c) =>
              (
                await c.query(
                  "SELECT reusable FROM data_snapshots WHERE id=$1",
                  [a.json().snapshot_id],
                )
              ).rows[0],
          );
          assert.equal(snap.reusable, false);
          const before = live,
            s = await job();
          assert.equal((await call(s, "uncertain")).statusCode, 502);
          assert.equal((await readJob(s)).data_inflight, "10");
          const retry = await call(await job(tenants[1]), "uncertain");
          assert.equal(retry.json().error, "data_fetch_pending_reconciliation");
          assert.equal(live, before + 1);
          const archived = await db.tenant(tenants[0], (c) =>
            c.query(
              "SELECT r.body FROM data_provider_responses r JOIN data_fetches f ON f.id=r.fetch_id WHERE f.connection_id=$1 AND f.state='uncertain'",
              [cid],
            ),
          );
          assert.equal(archived.rowCount, 1);
          assert.match(archived.rows[0].body, /unavailable/);
        },
      );
      await t.test(
        "0/2/3-point live tiers, 0.3 snapshots, replay and insufficient budgets settle exactly",
        async () => {
          for (const [name, args, rate] of [
            ["search_category_by_words", { query: "tiered-free-category" }, 0],
            [
              "product_sales_trend",
              { filter: { product_id: "tiered-trend", time_range_days: 7 } },
              2,
            ],
            [
              "creator_rank_top_ecommerce",
              {
                filter: {
                  date_type: "week",
                  date_value: "2026-W40",
                  region: "US",
                },
              },
              3,
            ],
          ]) {
            const s = await job(tenants[0], BigInt(rate * 10));
            const before = live;
            const response = await callTool(s, name, args);
            assert.equal(response.statusCode, 200, response.body);
            assert.equal(response.json().points_charged, rate);
            assert.equal(response.json().billing.live_points, rate);
            const replay = await callTool(s, name, args);
            assert.equal(
              replay.json().invocation_id,
              response.json().invocation_id,
            );
            assert.equal(live, before + 1);
            assert.equal((await readJob(s)).data_spent, String(rate * 10));
            assert.equal((await readJob(s)).data_inflight, "0");
            const hit = await callTool(await job(tenants[1], 3n), name, args);
            assert.equal(hit.statusCode, 200, hit.body);
            assert.equal(hit.json().cache_hit, true);
            assert.equal(hit.json().points_charged, 0.3);
          }
          const before = live;
          const insufficient = await callTool(
            await job(tenants[0], 19n),
            "product_sales_trend",
            {
              filter: {
                product_id: "insufficient-two-point-query",
                time_range_days: 7,
              },
            },
          );
          assert.equal(insufficient.statusCode, 409, insufficient.body);
          assert.equal(live, before);
        },
      );
      await t.test(
        "free tools work with an empty shared wallet without a zero-value ledger reservation",
        async () => {
          const w = tenants[0],
            s = await job(w, 0n);
          const prior = await db.tenant(w, async (c) => {
            await c.query(
              "UPDATE jobs SET billing_mode='wallet_per_call' WHERE id=$1",
              [s.job_id],
            );
            const row = (
              await c.query(
                "SELECT available FROM wallets WHERE currency='data_points'",
              )
            ).rows[0];
            await c.query(
              "UPDATE wallets SET available=0 WHERE currency='data_points'",
            );
            return row.available;
          });
          try {
            const r = await callTool(s, "search_category_by_words", {
              query: "no-wallet-balance",
            });
            assert.equal(r.statusCode, 200, r.body);
            assert.equal(r.json().points_charged, 0);
            const inv = r.json().invocation_id;
            const rows = await db.tenant(w, (c) =>
              c.query("SELECT * FROM ledger WHERE reference=$1", [inv]),
            );
            assert.equal(rows.rowCount, 0);
            const before = live;
            const denied = await callTool(s, "product_sales_trend", {
              filter: { product_id: "empty-wallet-paid", time_range_days: 7 },
            });
            assert.equal(denied.json().error, "insufficient_data_points");
            assert.equal(live, before);
          } finally {
            await db.tenant(w, (c) =>
              c.query(
                "UPDATE wallets SET available=$1 WHERE currency='data_points'",
                [prior],
              ),
            );
          }
        },
      );
      await t.test(
        "empty, business error, HTTP failure and rate-limit release all shared wallet points and are never paid snapshots",
        async () => {
          for (const product of [
            "empty-result",
            "business-error",
            "definite-failure",
            "rate-limit",
          ]) {
            const s = await job(tenants[0], 0n);
            await db.tenant(s.workspace_id, (c) =>
              c.query(
                "UPDATE jobs SET billing_mode='wallet_per_call' WHERE id=$1",
                [s.job_id],
              ),
            );
            const wallet = () =>
              db.tenant(
                s.workspace_id,
                async (c) =>
                  (
                    await c.query(
                      "SELECT available,reserved FROM wallets WHERE currency='data_points'",
                    )
                  ).rows[0],
              );
            const before = await wallet();
            const r = await call(s, product);
            assert.equal(
              r.statusCode,
              ["definite-failure", "rate-limit"].includes(product) ? 502 : 200,
              r.body,
            );
            assert.deepEqual(await wallet(), before);
            assert.equal((await readJob(s)).data_spent, "0");
            assert.equal((await readJob(s)).data_inflight, "0");
            const invocation = await db.tenant(
              s.workspace_id,
              async (c) =>
                (
                  await c.query("SELECT * FROM invocations WHERE job_id=$1", [
                    s.job_id,
                  ])
                ).rows[0],
            );
            assert.equal(invocation.charged, "0");
            assert.equal(invocation.procurement, "0");
            assert.ok(
              ["empty", "failed", "rate_limited"].includes(
                invocation.usage.outcome,
              ),
            );
            const count = live;
            const next = await call(await job(tenants[0]), product);
            assert.equal(live, count + 1);
            if (next.statusCode === 200)
              assert.equal(next.json().cache_hit, false);
          }
        },
      );
      await t.test(
        "model calls use the same distributed gate across API instances and release slots",
        async () => {
          const mk = await resourceFor(db, mid);
          await db.query(
            "UPDATE api_resource_groups SET max_concurrent=2,max_per_workspace=1 WHERE key=$1",
            [mk],
          );
          const scopes = [];
          for (let i = 0; i < 12; i++) scopes.push(await job(tenants[i % 2]));
          const responses = await Promise.all(
            scopes.map((s, i) =>
              apps[i % 2].inject({
                method: "POST",
                url: "/internal/job/v1/responses",
                headers: { authorization: "Bearer " + signJob(workerKey, s) },
                payload: {
                  input: [{ role: "user", content: "fixture " + i }],
                  tools: [],
                  stream: false,
                },
              }),
            ),
          );
          for (const r of responses) assert.equal(r.statusCode, 200, r.body);
          assert.equal(models, 12);
          assert.ok(modelPeak <= 2 && modelPeak > 1);
          assert.equal(modelActive, 0);
          assert.equal(
            Number(
              (
                await db.query(
                  "SELECT count(*) AS n FROM api_resource_tickets WHERE resource_key=$1 AND state='active'",
                  [mk],
                )
              ).rows[0].n,
            ),
            0,
          );
        },
      );
      await t.test(
        "tool-free compaction accepts prior MCP history and retries reuse one settled model charge",
        async () => {
          const scope = await job();
          const before = models;
          const payload = {
            input: [
              { role: "user", content: "Summarize progress only." },
              {
                type: "function_call",
                namespace: "mcp__fastmoss",
                name: "fastmoss_catalog",
                call_id: "previous_catalog",
                arguments: '{"keyword":"category"}',
              },
              {
                type: "function_call_output",
                call_id: "previous_catalog",
                output: "Offline category fixture",
              },
            ],
            tools: [],
            stream: false,
          };
          const submit = () =>
            apps[0].inject({
              method: "POST",
              url: "/internal/job/v1/responses",
              headers: { authorization: "Bearer " + signJob(workerKey, scope) },
              payload,
            });
          const first = await submit(),
            repeat = await submit();
          assert.equal(first.statusCode, 200, first.body);
          assert.equal(repeat.statusCode, 200, repeat.body);
          assert.deepEqual(repeat.json(), first.json());
          assert.equal(models, before + 1);
          const sent = modelRequests.at(-1);
          assert.deepEqual(sent.tools, []);
          assert.equal(sent.input[1].namespace, undefined);
          assert.ok(sent.input[1].name.startsWith("tl_"));
          assert.equal(sent.input[1].call_id, sent.input[2].call_id);
          const j = await readJob(scope);
          assert.equal(j.model_inflight, "0");
          assert.equal(j.data_spent, "0");
          assert.ok(BigInt(j.model_spent) > 0n);
          const calls = await db.tenant(scope.workspace_id, (c) =>
            c.query(
              "SELECT state,charged FROM invocations WHERE job_id=$1 AND kind='model'",
              [scope.job_id],
            ),
          );
          assert.equal(calls.rowCount, 1);
          assert.equal(calls.rows[0].state, "succeeded");
          assert.equal(calls.rows[0].charged, j.model_spent);
        },
      );
      await t.test(
        "model context guard estimates tokens from bytes and still rejects an oversized request",
        async () => {
          const scope = await job();
          const response = await apps[0].inject({
            method: "POST",
            url: "/internal/job/v1/responses",
            headers: {
              authorization: "Bearer " + signJob(workerKey, scope),
            },
            payload: {
              input: [{ role: "user", content: "x".repeat(60000) }],
              tools: [],
              stream: false,
            },
          });
          assert.equal(response.statusCode, 200, response.body);
          assert.equal(modelRequests.at(-1).input[0].content.length, 60000);
          assert.equal((await readJob(scope)).model_inflight, "0");
          const before = models;
          const oversized = await apps[0].inject({
            method: "POST",
            url: "/internal/job/v1/responses",
            headers: {
              authorization: "Bearer " + signJob(workerKey, await job()),
            },
            payload: {
              input: [{ role: "user", content: "收".repeat(60000) }],
              tools: [],
              stream: false,
            },
          });
          assert.equal(oversized.statusCode, 409, oversized.body);
          assert.equal(oversized.json().error, "model_context_budget_exceeded");
          assert.equal(models, before);
        },
      );
      await t.test(
        "1M windows accept multi-megabyte context, forward 360K output and reject excess before purchase",
        async () => {
          const largePrice = {
            ...price,
            market: {
              input: "0.01",
              output: "0.01",
              cache_read: "0.01",
              cache_write: "0.01",
            },
            max_context_tokens: 1000000,
            max_output_tokens: 360000,
          };
          const scope = await job(tenants[0], 10n, largePrice);
          const send = (text) =>
            apps[0].inject({
              method: "POST",
              url: "/internal/job/v1/responses",
              headers: { authorization: "Bearer " + signJob(workerKey, scope) },
              payload: {
                input: [{ role: "user", content: text }],
                tools: [],
                stream: false,
              },
            });
          const ok = await send("x".repeat(2100000));
          assert.equal(ok.statusCode, 200, ok.body);
          assert.ok(modelRequests.at(-1).max_output_tokens < 360000);
          assert.equal(modelRequests.at(-1).input[0].content.length, 2100000);
          const short = await send("short");
          assert.equal(short.statusCode, 200, short.body);
          assert.equal(modelRequests.at(-1).max_output_tokens, 360000);
          const before = models;
          const excess = await send("x".repeat(3100000));
          assert.equal(excess.statusCode, 409, excess.body);
          assert.equal(excess.json().error, "model_context_budget_exceeded");
          assert.equal(models, before);
          assert.equal((await readJob(scope)).model_inflight, "0");
        },
      );
      await t.test(
        "bounded queues, cancellation, rate windows and shared cooldown refuse calls before purchase",
        async () => {
          await db.query(
            "INSERT INTO api_resource_groups(key,kind,max_concurrent,max_per_workspace,queue_limit,requests_per_minute) VALUES($1,'model',1,1,1,2)",
            [key],
          );
          const g = new ResourceGate(db, { waitMs: 1500, pollMs: 10 }),
            g2 = new ResourceGate(db2, { waitMs: 1500, pollMs: 10 });
          const release = await g.acquire(key, tenants[0]);
          const waiting = g2.acquire(key, tenants[1]).then(
            () => null,
            (e) => e.code,
          );
          for (let i = 0; i < 30; i++) {
            if (
              Number(
                (
                  await db.query(
                    "SELECT count(*) AS n FROM api_resource_tickets WHERE resource_key=$1 AND state='queued'",
                    [key],
                  )
                ).rows[0].n,
              )
            )
              break;
            await sleep(20);
          }
          await assert.rejects(
            () => g.acquire(key, tenants[0]),
            (e) => e.code === "resource_queue_full",
          );
          assert.equal(await waiting, "resource_queue_timeout");
          await release();
          let checks = 0;
          await assert.rejects(
            () =>
              g.acquire(key, tenants[0], () => {
                if (++checks > 1) throw new AppError("cancelled", 409);
              }),
            (e) => e.code === "cancelled",
          );
          const r = await g.acquire(key, tenants[0]);
          await r();
          await assert.rejects(
            () => g.acquire(key, tenants[1]),
            (e) => e.code === "resource_queue_timeout",
          );
          await db.query(
            "UPDATE api_resource_groups SET requests_per_minute=100 WHERE key=$1",
            [key],
          );
          await g.cooldown(key, "30");
          await assert.rejects(
            () => g2.acquire(key, tenants[1]),
            (e) => e.code === "resource_queue_timeout",
          );
        },
      );
      await t.test(
        "legacy evidence imports idempotently without changing costs or refreshing old timestamps",
        async () => {
          const s = await job(),
            prepared = await beginInvocation(
              db,
              s,
              "data",
              "legacy-fixture",
              () => 10n,
            );
          const envelope = {
            source: "FastMoss",
            tool: "product_detail_info",
            request: { filter: { product_id: "legacy-product" } },
            captured_at: "2020-01-01T00:00:00.000Z",
            result: { content: [{ type: "text", text: '{"price":3}' }] },
            decoded: [{ price: 3 }],
            invocation_id: prepared.invocation.id,
          };
          await settleInvocation(
            db,
            store,
            s,
            prepared.invocation,
            Buffer.from(JSON.stringify(envelope)),
            { sale: 10n, procurement: 10n, usage: { legacy_fixture: true } },
          );
          const before = await readJob(s);
          const imported = await backfillData(db, store, { actor });
          assert.equal(imported.imported, 1);
          const again = await backfillData(db, store, { actor });
          assert.equal(again.imported, 0);
          assert.ok(again.already_imported >= 1);
          assert.equal((await readJob(s)).data_spent, before.data_spent);
          const saved = await db.tenant(
            s.workspace_id,
            async (c) =>
              (
                await c.query(
                  "SELECT s.* FROM data_snapshots s JOIN data_fetches f ON f.id=s.fetch_id WHERE f.invocation_id=$1",
                  [prepared.invocation.id],
                )
              ).rows[0],
          );
          assert.equal(saved.captured_at.toISOString(), envelope.captured_at);
          assert.ok(new Date(saved.expires_at) < new Date());
        },
      );
      await t.test(
        "a crashed gateway leaves orphaned reservations available for reconciliation",
        async () => {
          const s = await job(),
            inv = await beginInvocation(
              db,
              s,
              "model",
              "orphaned-fixture",
              () => 100n,
            );
          await db.tenant(s.workspace_id, async (c) => {
            await c.query(
              "UPDATE jobs SET lease_expires_at=now()-interval '1 minute' WHERE id=$1",
              [s.job_id],
            );
            await c.query(
              "INSERT INTO dispatch(job_id,workspace_id) VALUES($1,$2)",
              [s.job_id, s.workspace_id],
            );
          });
          const reply = await apps[0].inject({
            method: "POST",
            url: "/internal/worker/claim",
            headers: {
              authorization: "Bearer " + workerKey.toString("base64url"),
            },
            payload: { worker_id: "cache-recovery-" + cid.slice(0, 8) },
          });
          assert.equal(reply.statusCode, 200, reply.body);
          assert.equal((await readJob(s)).status, "reconciling");
          const call = await db.tenant(
            s.workspace_id,
            async (c) =>
              (
                await c.query("SELECT state FROM invocations WHERE id=$1", [
                  inv.invocation.id,
                ])
              ).rows[0],
          );
          assert.equal(call.state, "reconciling");
          assert.equal(
            (
              await db.query("SELECT job_id FROM dispatch WHERE job_id=$1", [
                s.job_id,
              ])
            ).rowCount,
            0,
          );
        },
      );
      await t.test(
        "replaying a pre-migration credit reference remains idempotent in tenths",
        async () => {
          await db.tenant(tenants[0], async (c) => {
            const ref = "legacy-credit-" + id(),
              detail = { fixture: "old-unit" };
            await c.query(
              "INSERT INTO ledger(id,workspace_id,currency,operation,amount,reference,detail,data_unit_scale) VALUES($1,$2,'data_points','credit',2,$3,$4,1)",
              [id(), tenants[0], ref, detail],
            );
            await c.query(
              "UPDATE wallets SET available=available+20 WHERE currency='data_points'",
            );
            const before = (
              await c.query(
                "SELECT available FROM wallets WHERE currency='data_points'",
              )
            ).rows[0].available;
            const replay = await creditWallet(
              c,
              tenants[0],
              "data_points",
              20n,
              ref,
              detail,
            );
            assert.equal(replay.duplicate, true);
            assert.equal(
              (
                await c.query(
                  "SELECT available FROM wallets WHERE currency='data_points'",
                )
              ).rows[0].available,
              before,
            );
          });
        },
      );
      await t.test(
        "admin cache controls require admin sessions and human-facing bills show tenths",
        async () => {
          assert.equal(
            (await apps[0].inject({ url: "/api/admin/data-library" }))
              .statusCode,
            401,
          );
          const auth = await apps[0].inject({
            method: "POST",
            url: "/api/auth/login",
            headers: { origin },
            payload: { login, password, audience: "admin" },
          });
          assert.equal(auth.statusCode, 200, auth.body);
          const headers = {
            origin,
            cookie: auth.cookies.map((x) => x.name + "=" + x.value).join("; "),
            "x-csrf-token": auth.cookies.find((x) => x.name.endsWith("_csrf"))
              .value,
          };
          const library = await apps[0].inject({
            url: "/api/admin/data-library",
            headers,
          });
          assert.equal(library.statusCode, 200, library.body);
          assert.ok(library.json().snapshots.length >= 5);
          const bills = await apps[0].inject({
            url: `/api/admin/workspaces/${tenants[0]}/invocations`,
            headers,
          });
          assert.equal(bills.statusCode, 200, bills.body);
          assert.ok(
            bills
              .json()
              .items.some((i) => i.kind === "data" && i.charged === "0.3"),
          );
          const update = await apps[0].inject({
            method: "PUT",
            url: "/api/admin/data-library/policy",
            headers,
            payload: { tool: "*", ttl_seconds: 900 },
          });
          assert.equal(update.statusCode, 200, update.body);
        },
      );
    } finally {
      for (const app of apps) await app.close();
      for (const w of tenants)
        await db.tenant(w, async (c) => {
          // Only synthetic calls exist in this isolated validation DB; no supplier costs are incurred.
          await c.query(
            "UPDATE invocations SET state='rejected' WHERE state IN('started','reconciling')",
          );
          await c.query(
            "UPDATE jobs SET data_inflight=0,model_inflight=0 WHERE status IN('running','reconciling')",
          );
          for (const j of (
            await c.query(
              "SELECT * FROM jobs WHERE status IN('running','reconciling') FOR UPDATE",
            )
          ).rows)
            await finalizeJob(
              c,
              w,
              j,
              "failed",
              null,
              "synthetic_fixture_cleanup",
            );
          await c.query("UPDATE workspaces SET enabled=false WHERE id=$1", [w]);
        });
      await db.query(
        "UPDATE connections SET enabled=false WHERE id=ANY($1::uuid[])",
        [[cid, mid]],
      );
      await db.query("UPDATE users SET enabled=false WHERE id=$1", [actor]);
      await db.query("DELETE FROM sessions WHERE user_id=$1", [actor]);
      await db.close();
      await db2.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
