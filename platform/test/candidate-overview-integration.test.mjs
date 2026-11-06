import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createDatabase } from "../src/infra/db.mjs";
import { LocalStore, SecretStore } from "../src/infra/storage.mjs";
import { buildApp } from "../src/server.mjs";
import { id, passwordHash } from "../src/common/core.mjs";
import { saveArtifact } from "../src/files/artifacts.mjs";

test(
  "candidate overview authenticates, isolates tenants, purchases only once, archives and paginates without model calls",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const db = createDatabase(process.env.TEST_DATABASE_URL),
      root = await mkdtemp(path.join(tmpdir(), "overview-test-")),
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
    const requests = [];
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
          "INSERT INTO connections(id,name,kind,enabled) VALUES($1,'overview QA','fastmoss',true)",
          [cid],
        );
        await c.query(
          "INSERT INTO connection_versions(id,connection_id,config,secret_ref,verified) VALUES($1,$2,$3,$4,true)",
          [
            vid,
            cid,
            { endpoint: "https://overview.invalid/mcp", protocol: "mcp" },
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
      });
      await db.tenant(workspace, async (c) => {
        await c.query(
          "INSERT INTO wallets(workspace_id,currency,available) VALUES($1,'data_points',500)",
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
          modelFetch: () => {
            throw Error("must not call model");
          },
          dataRpc: async (_e, _s, _m, v, { onResponse }) => {
            calls++;
            requests.push(v);
            if (v.name === "shop_live_analysis")
              throw new Error("simulated uncertain provider response");
            await new Promise((resolve) => setTimeout(resolve, 50));
            const data = {
              shop: { seller_id: seller, region: "GB" },
              product_id: product,
              ...(v.name === "product_investment"
                ? {
                    currency_code: "GBP",
                    ad_performance_summary: {
                      estimated_ad_spend: 12,
                      ad_gmv: 30,
                      ad_video_count: 2,
                    },
                  }
                : {}),
              query_summary: { period_units_sold: 0 },
              products: {
                total: 11,
                list:
                  v.arguments.page === 2
                    ? [{ product: { product_id: "111", title: "page two" } }]
                    : [],
              },
            };
            const result = {
              content: [{ type: "text", text: JSON.stringify(data) }],
            };
            await onResponse({
              status: 200,
              raw: JSON.stringify({ jsonrpc: "2.0", id: 1, result }),
            });
            return result;
          },
        },
      });
      await app.ready();
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
      const endpoint = `/api/reports/${report}/candidates/${product}/overview`;
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
      assert.equal((await call({ seller_id: "999" })).statusCode, 400);
      assert.equal(
        (await call({}, auth, workspace, endpoint.replace(product, "999")))
          .statusCode,
        404,
      );
      const concurrent = await Promise.all([call(), call()]);
      for (const r of concurrent) assert.equal(r.statusCode, 200, r.body);
      assert.equal(calls, 4);
      const repeat = await call();
      assert.equal(repeat.statusCode, 200, repeat.body);
      assert.equal(repeat.json().status, "succeeded");
      assert.equal(repeat.json().data_points, "7");
      assert.equal(repeat.json().model_cost, "0");
      assert.equal(calls, 4);
      assert.equal(
        repeat.json().panels.shop_data_trends.data.query_summary
          .period_units_sold,
        0,
      );
      assert.equal(
        (await call({ section: "products", page: 2 })).json().panels
          .shop_product_analysis.data.products.list[0].product.title,
        "page two",
      );
      assert.equal(calls, 5);
      await db.tenant(workspace, async (c) => {
        assert.equal(
          (
            await c.query(
              "SELECT available FROM wallets WHERE currency='data_points'",
            )
          ).rows[0].available,
          "420",
        );
        assert.equal(
          (await c.query("SELECT count(*) FROM invocations WHERE kind='model'"))
            .rows[0].count,
          "0",
        );
        assert.equal(
          (await c.query("SELECT status FROM jobs WHERE id=$1", [original]))
            .rows[0].status,
          "succeeded",
        );
      });
      const refreshKey = id();
      const shopAds = await call({ section: "advertising" });
      assert.equal(shopAds.statusCode, 200, shopAds.body);
      assert.equal(shopAds.json().data_points, "2");
      const beforeProductAds = calls;
      const productAds = await Promise.all([
        call({ section: "product_advertising" }),
        call({ section: "product_advertising" }),
      ]);
      for (const response of productAds)
        assert.equal(response.statusCode, 200, response.body);
      const productAdResult = (
        await call({ section: "product_advertising" })
      ).json();
      assert.equal(calls, beforeProductAds + 1);
      assert.equal(productAdResult.status, "succeeded");
      assert.notEqual(productAdResult.job_id, shopAds.json().job_id);
      assert.equal(productAdResult.data_points, "2");
      assert.equal(productAdResult.panels.shop_investment_analysis, undefined);
      assert.equal(
        productAdResult.panels.product_investment.advertising_evidence.status,
        "observed",
      );
      assert.deepEqual(requests.at(-1), {
        name: "product_investment",
        arguments: { filter: { product_id: product, time_range_days: 28 } },
      });
      const sevenDayAds = (
        await call({ section: "product_advertising", days: 7 })
      ).json();
      assert.notEqual(sevenDayAds.job_id, productAdResult.job_id);
      assert.equal(sevenDayAds.data_points, "2");
      assert.equal(
        sevenDayAds.panels.product_investment.advertising_evidence.days,
        7,
      );
      assert.equal(calls, beforeProductAds + 2);
      const refreshed = await call({
        section: "products",
        page: 2,
        refresh_key: refreshKey,
      });
      assert.equal(refreshed.statusCode, 200, refreshed.body);
      assert.equal(refreshed.json().data_points, "0.3");
      const refreshedId = refreshed.json().job_id;
      assert.notEqual(refreshedId, repeat.json().job_id);
      const spentCalls = calls;
      assert.equal(
        (
          await call({ section: "products", page: 2, refresh_key: refreshKey })
        ).json().job_id,
        refreshedId,
      );
      assert.equal(
        (await call({ section: "products", page: 2 })).json().job_id,
        refreshedId,
      );
      assert.equal(calls, spentCalls);
      const uncertain = await call({ section: "lives" });
      assert.equal(uncertain.statusCode, 200, uncertain.body);
      assert.equal(uncertain.json().status, "reconciling");
      const uncertainCalls = calls;
      assert.equal(
        (await call({ section: "lives", refresh_key: id() })).json().job_id,
        uncertain.json().job_id,
      );
      assert.equal(calls, uncertainCalls);
    } finally {
      await app?.close();
      await db.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
