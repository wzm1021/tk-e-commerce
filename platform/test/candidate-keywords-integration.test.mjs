import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createDatabase } from "../src/infra/db.mjs";
import { LocalStore, SecretStore } from "../src/infra/storage.mjs";
import { buildApp } from "../src/server.mjs";
import { id, passwordHash, PriceSchema } from "../src/common/core.mjs";
import { saveArtifact } from "../src/files/artifacts.mjs";

test(
  "candidate keywords isolate tenants, reuse evidence, bill once, cache and handle failure",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const db = createDatabase(process.env.TEST_DATABASE_URL),
      root = await mkdtemp(path.join(tmpdir(), "keywords-test-")),
      store = new LocalStore(root),
      secrets = new SecretStore(root, randomBytes(32));
    const workspace = id(),
      other = id(),
      actor = id(),
      otherActor = id(),
      report = id(),
      original = id(),
      product = "1729613111070136690",
      seller = "7494419524321642200",
      password = "qa-only-" + id(),
      origin = "http://127.0.0.1:4310";
    let app,
      calls = 0;
    try {
      assert.deepEqual(
        (
          await db.query(
            "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
          )
        ).rows[0],
        { rolsuper: false, rolbypassrls: false },
      );
      const encoded = await passwordHash(password);
      await db.tx(null, async (c) => {
        for (const [wid, uid] of [
          [workspace, actor],
          [other, otherActor],
        ]) {
          await c.query(
            "INSERT INTO workspaces(id,name) VALUES($1,'overview QA')",
            [wid],
          );
          await c.query(
            "INSERT INTO users(id,login,password_hash,display_name) VALUES($1,$3,$2,'QA')",
            [uid, encoded, uid],
          );
          await c.query(
            "INSERT INTO memberships(user_id,workspace_id,role) VALUES($1,$2,'owner')",
            [uid, wid],
          );
        }
        const cid = id(),
          vid = id(),
          secret = await secrets.write("fixture", `${cid}:${vid}`);
        await c.query(
          "INSERT INTO connections(id,name,kind,enabled) VALUES($1,'keywords QA','model',true)",
          [cid],
        );
        await c.query(
          "INSERT INTO connection_versions(id,connection_id,config,secret_ref,verified) VALUES($1,$2,$3,$4,true)",
          [
            vid,
            cid,
            {
              endpoint: "https://keywords.invalid/v1/responses",
              model: "qa-model",
            },
            secret,
          ],
        );
        await c.query(
          "UPDATE connections SET active_version_id=$2 WHERE id=$1",
          [cid, vid],
        );
        await c.query(
          "INSERT INTO workspace_connections(workspace_id,connection_id) VALUES($1,$2)",
          [workspace, cid],
        );
        await c.query(
          "INSERT INTO price_cards(id,connection_id,name,data,active) VALUES($1,$2,'QA',$3,true)",
          [
            id(),
            cid,
            PriceSchema.parse({
              currency: "USD",
              fx: "7",
              market: {
                input: "1",
                output: "1",
                cache_read: "0",
                cache_write: "0",
              },
              procurement_discount: "0.4",
              sale_discount: "0.6",
              max_context_tokens: 32768,
              max_output_tokens: 2048,
              note: "TEST ONLY",
            }),
          ],
        );
      });
      await db.tenant(workspace, async (c) => {
        await c.query(
          "INSERT INTO wallets(workspace_id,currency,available) VALUES($1,'model_micro_cny',1000000)",
          [workspace],
        );
        await c.query(
          "INSERT INTO jobs(id,workspace_id,created_by,kind,title,request,status,idempotency_key) VALUES($1,$2,$3,'scouting','overview QA',$4,'succeeded',$5)",
          [original, workspace, actor, { market: "GB" }, id()],
        );
        const invocation = id();
        const artifact = await saveArtifact(
          c,
          store,
          workspace,
          Buffer.from(
            JSON.stringify([
              {
                product_id: "existing",
                title: "Existing",
                evidence: [
                  {
                    metric: "keywords",
                    value: ["knee support"],
                    invocation_id: invocation,
                    pointer: "/keywords",
                  },
                ],
              },
              { product_id: "invalid", title: "Invalid response" },
              { product_id: "uncertain", title: "Uncertain response" },
              { product_id: "timeout", title: "Timeout response" },
              {
                product_id: product,
                title: "Knee pads",
                assessment: {
                  facts: {
                    shop_id: {
                      value: seller,
                      invocation_id: invocation,
                      pointer: "/decoded/0/data/shop/shop_id",
                    },
                    shop_name: { value: "Shop QA", invocation_id: invocation },
                    region: { value: "GB" },
                  },
                },
              },
            ]),
          ),
          { name: "candidates.json", kind: "report" },
        );
        await c.query(
          "INSERT INTO records(id,workspace_id,kind,data,created_by) VALUES($1,$2,'report',$3,$4)",
          [
            report,
            workspace,
            { job_id: original, candidates_artifact_id: artifact.id },
            actor,
          ],
        );
      });
      app = await buildApp({
        db,
        store,
        secrets,
        workerKey: randomBytes(32),
        publicOrigin: origin,
        projectRoot: path.resolve(".."),
        gatewayOverrides: {
          modelTimeoutMs: 200,
          dataRpc: () => {
            throw Error("must not call data");
          },
          modelFetch: async (_endpoint, options) => {
            calls++;
            const request = JSON.parse(options.body);
            assert.equal(request.stream, false);
            assert.deepEqual(request.tools, []);
            if (request.input[0].content.includes("Timeout response")) {
              assert.equal(options.transportTimeoutMs, 610000);
              return {
                response: new Response(
                  new ReadableStream({
                    start(controller) {
                      options.signal.addEventListener(
                        "abort",
                        () => controller.error(options.signal.reason),
                        { once: true },
                      );
                    },
                  }),
                  { headers: { "Content-Type": "application/json" } },
                ),
                close: async () => {},
              };
            }
            await new Promise((r) => setTimeout(r, 60));
            if (request.input[0].content.includes("Uncertain response"))
              throw Error("provider timeout");
            const result = {
              id: id(),
              status: "completed",
              usage: { input_tokens: 100, output_tokens: 20 },
              output: [
                {
                  type: "message",
                  content: [
                    {
                      type: "output_text",
                      text: request.input[0].content.includes(
                        "Invalid response",
                      )
                        ? "bad json"
                        : JSON.stringify({
                            terms: [
                              "knee pads",
                              "knee support",
                              "sports knee sleeve",
                              "compression pads",
                              "joint support",
                            ],
                          }),
                    },
                  ],
                },
              ],
            };
            return {
              response: new Response(JSON.stringify(result), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              }),
              close: async () => {},
            };
          },
        },
      });
      await app.ready();
      assert.ok(
        app.server.timeout > 690000,
        "server socket must outlive the model and caller deadlines",
      );
      const login = async (uid) => {
        const r = await app.inject({
          method: "POST",
          url: "/api/auth/login",
          headers: { origin },
          payload: { login: uid, password, audience: "web" },
        });
        assert.equal(r.statusCode, 200, r.body);
        return {
          cookie: r.cookies.map((x) => `${x.name}=${x.value}`).join("; "),
          "x-csrf-token": r.cookies.find((x) => x.name.endsWith("_csrf")).value,
        };
      };
      const auth = await login(actor),
        otherAuth = await login(otherActor);
      const endpoint = `/api/reports/${report}/candidates/${product}/keywords`;
      const call = (
        body = {},
        identity = auth,
        ws = workspace,
        url = endpoint,
      ) =>
        app.inject({
          method: "POST",
          url,
          headers: { origin, "x-workspace-id": ws, ...identity },
          payload: body,
        });
      assert.equal((await call({}, {})).statusCode, 401);
      assert.equal((await call({}, otherAuth, other)).statusCode, 404);
      assert.equal((await call({ prompt: "forged" })).statusCode, 400);
      assert.equal(
        (await call({}, auth, workspace, endpoint.replace(product, "missing")))
          .statusCode,
        404,
      );
      const existing = await call(
        {},
        auth,
        workspace,
        endpoint.replace(product, "existing"),
      );
      assert.deepEqual(existing.json().terms, ["knee support"]);
      assert.equal(calls, 0);
      const concurrent = await Promise.all([call(), call()]);
      for (const r of concurrent) assert.equal(r.statusCode, 200, r.body);
      const repeat = await call();
      assert.equal(repeat.json().status, "succeeded", repeat.body);
      assert.equal(repeat.json().terms.length, 5);
      assert.equal(calls, 1);
      assert.ok(Number(repeat.json().model_cost) > 0);
      await call({ retry_key: id() });
      assert.equal(calls, 1, "successful results cannot be repurchased");
      await db.tenant(workspace, (c) =>
        c.query(
          "UPDATE jobs SET status='running',result=NULL,lease_expires_at=now()-interval '1 minute' WHERE checkpoint->>'product_id'=$1",
          [product],
        ),
      );
      assert.equal(
        (await call()).json().terms.length,
        5,
        "recover archived output after interrupted finalization",
      );
      assert.equal(calls, 1, "recovery does not repurchase");
      const invalid = endpoint.replace(product, "invalid");
      assert.equal(
        (await call({}, auth, workspace, invalid)).json().status,
        "failed",
      );
      assert.equal(calls, 2);
      await call({}, auth, workspace, invalid);
      assert.equal(calls, 2);
      const retry = id();
      await call({ retry_key: retry }, auth, workspace, invalid);
      assert.equal(calls, 3);
      await call({ retry_key: retry }, auth, workspace, invalid);
      assert.equal(calls, 3);
      const uncertain = endpoint.replace(product, "uncertain");
      assert.equal(
        (await call({}, auth, workspace, uncertain)).json().status,
        "reconciling",
      );
      await call({ retry_key: id() }, auth, workspace, uncertain);
      assert.equal(calls, 4);
      assert.equal(
        (
          await call({}, auth, workspace, endpoint.replace(product, "timeout"))
        ).json().status,
        "reconciling",
      );
      assert.equal(calls, 5);
      const timeoutEvent = await db.tenant(
        workspace,
        async (c) =>
          (
            await c.query(
              "SELECT data,summary FROM job_events WHERE data->>'code'='model_response_timeout' ORDER BY id DESC LIMIT 1",
            )
          ).rows[0],
      );
      assert.equal(timeoutEvent.data.timeout_seconds, 0.2);
      assert.match(timeoutEvent.summary, /模型无反应/);
      await call(
        { retry_key: id() },
        auth,
        workspace,
        endpoint.replace(product, "timeout"),
      );
      assert.equal(calls, 5, "do not retry or recharge an uncertain timeout");

      await db.tenant(workspace, async (c) => {
        assert.equal(
          (await c.query("SELECT count(*) FROM invocations WHERE kind='data'"))
            .rows[0].count,
          "0",
        );
        assert.equal(
          (
            await c.query(
              "SELECT count(*) FROM invocations WHERE kind='model' AND state='succeeded'",
            )
          ).rows[0].count,
          "3",
        );
        assert.equal(
          (await c.query("SELECT status FROM jobs WHERE id=$1", [original]))
            .rows[0].status,
          "succeeded",
        );
      });
    } finally {
      await app?.close();
      await db.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
