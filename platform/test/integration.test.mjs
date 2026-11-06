import { recoverFailedScouting } from "../scripts/recover-failed-scouting.mjs";
import { ensureScoutingCandidates } from "../src/reports/scouting-policy.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { createDatabase } from "../src/infra/db.mjs";
import { buildApp } from "../src/server.mjs";
import { id, passwordHash, digest, PriceSchema } from "../src/common/core.mjs";
import { LocalStore, SecretStore } from "../src/infra/storage.mjs";
import { creditWallet } from "../src/admin/admin.mjs";
import { projectBundle, publishSkill } from "../src/skills/skills.mjs";
import { verifyJob, signJob, finalizeJob } from "../src/research/jobs.mjs";
import {
  beginInvocation,
  settleInvocation,
  uncertainInvocation,
} from "../src/data/gateway.mjs";
test(
  "PostgreSQL isolation, workflow and billing integration",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const db = createDatabase(process.env.TEST_DATABASE_URL);
    if (
      Number(
        (await db.query("SELECT count(*) AS n FROM dispatch")).rows[0].n,
      ) !== 0
    ) {
      await db.close();
      assert.fail(
        "Integration tests require a quiescent validation database with no dispatched jobs",
      );
    }
    const root = await mkdtemp(path.join(os.tmpdir(), "tidelab-integration-"));
    const store = new LocalStore(root),
      secrets = new SecretStore(root, randomBytes(32)),
      workerKey = randomBytes(32),
      origin = "http://127.0.0.1:4310",
      publicBetaOrigin = "http://203.0.113.10:4310";
    const wsA = id(),
      wsB = id(),
      userA = id(),
      userB = id(),
      adminId = id(),
      password = "only-integration-fixture-" + id(),
      loginA = "test-a-" + id(),
      loginB = "test-b-" + id(),
      loginAdmin = "test-admin-" + id();
    let app, authA, authAdmin, jobId, scope, bundle;
    let policyWait;
    const readJob = () =>
      db.tenant(
        wsA,
        async (c) =>
          (await c.query("SELECT * FROM jobs WHERE id=$1", [jobId])).rows[0],
      );
    try {
      await db.tx(null, async (c) => {
        for (const [wid, name] of [
          [wsA, "A"],
          [wsB, "B"],
        ])
          await c.query("INSERT INTO workspaces(id,name) VALUES($1,$2)", [
            wid,
            "自动验收隔离空间 " + name + " " + wsA.slice(0, 8),
          ]);
        const encoded = await passwordHash(password);
        for (const [uid, login, admin, wid] of [
          [userA, loginA, false, wsA],
          [userB, loginB, false, wsB],
          [adminId, loginAdmin, true, wsA],
        ]) {
          await c.query(
            "INSERT INTO users(id,login,password_hash,display_name,is_admin) VALUES($1,$2,$3,$4,$5)",
            [uid, login, encoded, "验收账号", admin],
          );
          await c.query(
            "INSERT INTO memberships(user_id,workspace_id,role) VALUES($1,$2,'owner')",
            [uid, wid],
          );
        }
      });
      app = await buildApp({
        db,
        store,
        secrets,
        workerKey,
        publicOrigin: origin,
        publicOrigins: [origin, publicBetaOrigin],
        projectRoot: path.resolve(".."),
        gatewayOverrides: {
          policyFetch: async (url) => {
            if (policyWait) await policyWait();
            return {
              url,
              status: 200,
              html:
                "<title>Official disclosure fixture</title><main>" +
                "Paid connections require clear disclosures. ".repeat(15) +
                "</main>",
            };
          },
        },
      });
      app.get("/test/client-address", (req) => ({ ip: req.ip }));
      await app.ready();
      async function login(login, audience = "web") {
        const r = await app.inject({
          method: "POST",
          url: "/api/auth/login",
          headers: { origin },
          payload: { login, password, audience },
        });
        assert.equal(r.statusCode, 200, r.body);
        return {
          cookie: r.cookies.map((c) => c.name + "=" + c.value).join("; "),
          csrf: r.cookies.find((c) => c.name.endsWith("_csrf")).value,
        };
      }
      function web(method, url, body, auth = authA, wid = wsA) {
        return app.inject({
          method,
          url,
          headers: {
            origin,
            cookie: auth.cookie,
            "x-csrf-token": auth.csrf,
            "x-workspace-id": wid,
          },
          ...(body === undefined ? {} : { payload: body }),
        });
      }
      await t.test(
        "sessions enforce audience, CSRF and membership",
        async () => {
          authA = await login(loginA);
          authAdmin = await login(loginAdmin, "admin");
          assert.equal(
            (
              await app.inject({
                method: "POST",
                url: "/api/auth/login",
                headers: { origin },
                payload: { login: loginA, password, audience: "admin" },
              })
            ).statusCode,
            401,
          );
          assert.equal(
            (await web("GET", "/api/admin/overview")).statusCode,
            401,
          );
          assert.equal(
            (
              await web(
                "GET",
                "/api/records?kind=opportunity",
                undefined,
                authA,
                wsB,
              )
            ).statusCode,
            403,
          );
          assert.equal(
            (
              await app.inject({
                method: "POST",
                url: "/api/jobs",
                headers: {
                  origin,
                  cookie: authA.cookie,
                  "x-workspace-id": wsA,
                },
                payload: {},
              })
            ).statusCode,
            403,
          );
          assert.equal(
            (
              await app.inject({
                method: "POST",
                url: "/api/jobs",
                headers: {
                  origin: "https://untrusted.invalid",
                  cookie: authA.cookie,
                  "x-csrf-token": authA.csrf,
                  "x-workspace-id": wsA,
                },
                payload: {},
              })
            ).statusCode,
            403,
          );
        },
      );
      await t.test(
        "specialist lists filter before pagination and resolve historical report kinds",
        async () => {
          const jobIds = [],
            reportIds = [];
          const originalSummary = '/decoded/0/data/shop/shop_name = "Sigird"';
          try {
            await db.tenant(wsA, async (c) => {
              for (const kind of [
                "scouting",
                "competitor",
                "content",
                "reviews",
                "ads",
                "diagnostics",
              ]) {
                const jid = id(),
                  rid = id();
                jobIds.push(jid);
                reportIds.push(rid);
                await c.query(
                  "INSERT INTO jobs(id,workspace_id,created_by,kind,title,request,status,idempotency_key,result) VALUES($1,$2,$3,$4,$4,'{}','succeeded',$1::uuid::text,$5)",
                  [jid, wsA, userA, kind, { summary: originalSummary }],
                );
                await c.query(
                  "INSERT INTO records(id,workspace_id,kind,data,created_by) VALUES($1,$2,'report',$3,$4)",
                  [
                    rid,
                    wsA,
                    { job_id: jid, title: kind, summary: originalSummary },
                    userA,
                  ],
                );
              }
              const rid = id();
              reportIds.push(rid);
              await c.query(
                "INSERT INTO records(id,workspace_id,kind,data,created_by) VALUES($1,$2,'report',$3,$4)",
                [
                  rid,
                  wsA,
                  {
                    title: "Imported scouting",
                    source_kind: "historical_report",
                  },
                  userA,
                ],
              );
            });
            const jobs = await web(
              "GET",
              "/api/jobs?research_scope=specialist",
            );
            assert.equal(jobs.statusCode, 200, jobs.body);
            assert.deepEqual(
              jobs
                .json()
                .items.map((j) => j.kind)
                .sort(),
              ["ads", "competitor", "content", "diagnostics", "reviews"],
            );
            const reports = await web(
              "GET",
              "/api/records?kind=report&research_scope=specialist&limit=2",
            );
            assert.equal(reports.statusCode, 200, reports.body);
            assert.equal(reports.json().items.length, 2);
            assert.ok(
              reports
                .json()
                .items.every(
                  (r) =>
                    r.data.summary === "店铺名称：Sigird" &&
                    !Object.hasOwn(r, "job_kind"),
                ),
            );
            for (let i = 1; i < jobIds.length; i++) {
              assert.equal(
                (await web("GET", `/api/jobs/${jobIds[i]}`)).json().result
                  .summary,
                "店铺名称：Sigird",
              );
              assert.equal(
                (await web("GET", `/api/records/${reportIds[i]}`)).json().data
                  .summary,
                "店铺名称：Sigird",
              );
            }
            assert.equal(
              (await web("GET", `/api/jobs/${jobIds[0]}`)).json().result
                .summary,
              originalSummary,
            );
            await db.tenant(wsA, async (c) => {
              const stored = (
                await c.query(
                  "SELECT result->>'summary' AS summary FROM jobs WHERE id=ANY($1::uuid[])",
                  [jobIds],
                )
              ).rows;
              assert.ok(stored.every((r) => r.summary === originalSummary));
            });
            assert.ok(
              reports
                .json()
                .items.every(
                  (r) =>
                    !["scouting", "Imported scouting"].includes(r.data.title),
                ),
            );
            const scouting = await web(
              "GET",
              "/api/records?kind=report&research_scope=scouting",
            );
            assert.deepEqual(
              scouting
                .json()
                .items.map((r) => r.data.title)
                .sort(),
              ["Imported scouting", "scouting"],
            );
            assert.equal(
              (await web("GET", "/api/jobs?research_scope=invalid")).statusCode,
              400,
            );
            assert.equal(
              (
                await web(
                  "GET",
                  "/api/records?kind=report&research_scope=invalid",
                )
              ).statusCode,
              400,
            );
          } finally {
            await db.tenant(wsA, async (c) => {
              await c.query("DELETE FROM records WHERE id=ANY($1::uuid[])", [
                reportIds,
              ]);
              await c.query("DELETE FROM jobs WHERE id=ANY($1::uuid[])", [
                jobIds,
              ]);
            });
          }
        },
      );
      await t.test(
        "public HTTP login retains CSRF and tenant isolation, restricts admin access and trusts only the local proxy",
        async () => {
          const headers = {
            origin: publicBetaOrigin,
            "x-tidelab-public-ingress": "1",
            "x-forwarded-for": "198.51.100.20",
          };
          const r = await app.inject({
            method: "POST",
            url: "/api/auth/login",
            headers,
            payload: { login: loginA, password, audience: "web" },
          });
          assert.equal(r.statusCode, 200, r.body);
          assert.ok(
            r.headers["set-cookie"].every(
              (value) => !value.includes("; Secure"),
            ),
          );
          const auth = {
            cookie: r.cookies.map((c) => c.name + "=" + c.value).join("; "),
            csrf: r.cookies.find((c) => c.name.endsWith("_csrf")).value,
          };
          const sessionHeaders = {
            ...headers,
            cookie: auth.cookie,
            "x-csrf-token": auth.csrf,
            "x-workspace-id": wsA,
          };
          assert.equal(
            (
              await app.inject({
                method: "GET",
                url: "/api/auth/me",
                headers: sessionHeaders,
              })
            ).statusCode,
            200,
          );
          assert.equal(
            (
              await app.inject({
                method: "GET",
                url: "/api/records?kind=opportunity",
                headers: { ...sessionHeaders, "x-workspace-id": wsB },
              })
            ).statusCode,
            403,
          );
          assert.equal(
            (
              await app.inject({
                method: "POST",
                url: "/api/auth/login",
                headers,
                payload: { login: loginAdmin, password, audience: "admin" },
              })
            ).statusCode,
            404,
          );
          for (const url of [
            "/api/admin/overview",
            "/admin",
            "/admin.html",
            "/internal/worker/claim",
            "/api/auth/me?audience=admin",
          ]) {
            const denied = await app.inject({
              method: "GET",
              url,
              headers: { ...headers, cookie: authAdmin.cookie },
            });
            assert.equal(denied.statusCode, 404, url + " " + denied.body);
          }
          const adminLogout = await app.inject({
            method: "POST",
            url: "/api/auth/logout",
            headers: {
              ...headers,
              cookie: authAdmin.cookie,
              "x-csrf-token": authAdmin.csrf,
            },
            payload: { audience: "admin" },
          });
          assert.equal(adminLogout.statusCode, 404);
          assert.equal(
            (
              await app.inject({
                method: "POST",
                url: "/api/auth/logout",
                headers: { ...sessionHeaders, "x-csrf-token": "wrong" },
                payload: {},
              })
            ).statusCode,
            403,
          );
          assert.equal(
            (
              await app.inject({
                method: "POST",
                url: "/api/auth/logout",
                headers: {
                  ...sessionHeaders,
                  origin: "http://untrusted.invalid",
                },
                payload: {},
              })
            ).statusCode,
            403,
          );
          assert.equal(
            (
              await app.inject({
                method: "POST",
                url: "/api/auth/logout",
                headers: sessionHeaders,
                payload: {},
              })
            ).statusCode,
            200,
          );
          for (const address of ["198.51.100.20", "198.51.100.21"]) {
            const proxied = await app.inject({
              method: "GET",
              url: "/test/client-address",
              remoteAddress: "127.0.0.1",
              headers: { "x-forwarded-for": address },
            });
            assert.equal(proxied.json().ip, address);
          }
          const forged = await app.inject({
            method: "GET",
            url: "/test/client-address",
            remoteAddress: "198.51.100.22",
            headers: { "x-forwarded-for": "198.51.100.23" },
          });
          assert.equal(forged.json().ip, "198.51.100.22");
        },
      );
      await t.test(
        "opt-in public admin supports login and logout without weakening role, CSRF, origin or internal-route controls",
        async () => {
          const distRoot = path.join(root, "admin-static");
          await mkdir(distRoot);
          await writeFile(
            path.join(distRoot, "admin.html"),
            "<title>Admin fixture</title>",
          );
          const publicApp = await buildApp({
            db,
            store,
            secrets,
            workerKey,
            publicOrigin: origin,
            publicOrigins: [origin, publicBetaOrigin],
            publicAdminEnabled: true,
            projectRoot: path.resolve(".."),
            distRoot,
          });
          const headers = {
            origin: publicBetaOrigin,
            "x-tidelab-public-ingress": "1",
            "x-forwarded-for": "198.51.100.30",
          };
          const request = (method, url, payload, extra = {}) =>
            publicApp.inject({
              method,
              url,
              headers: { ...headers, ...extra },
              ...(payload === undefined ? {} : { payload }),
            });
          const loginBody = { login: loginAdmin, password, audience: "admin" };
          try {
            for (const url of ["/admin", "/admin.html"]) {
              const page = await request("GET", url);
              assert.equal(page.statusCode, 200, page.body);
              assert.match(page.body, /Admin fixture/);
            }
            assert.equal(
              (await request("GET", "/api/admin/overview")).statusCode,
              401,
            );
            assert.equal(
              (
                await request("POST", "/api/auth/login", {
                  ...loginBody,
                  login: loginA,
                })
              ).statusCode,
              401,
            );
            assert.equal(
              (
                await request("POST", "/api/auth/login", {
                  ...loginBody,
                  password: "wrong-password",
                })
              ).statusCode,
              401,
            );
            const signedIn = await request(
              "POST",
              "/api/auth/login",
              loginBody,
            );
            assert.equal(signedIn.statusCode, 200, signedIn.body);
            const cookie = signedIn.cookies
              .map((c) => c.name + "=" + c.value)
              .join("; ");
            const csrf = signedIn.cookies.find(
              (c) => c.name === "tidelab_admin_csrf",
            ).value;
            assert.ok(
              signedIn.headers["set-cookie"].some(
                (c) =>
                  c.startsWith("tidelab_admin=") &&
                  /HttpOnly/.test(c) &&
                  /SameSite=Strict/i.test(c),
              ),
            );
            const sessionHeaders = { cookie, "x-csrf-token": csrf };
            const me = await request(
              "GET",
              "/api/auth/me?audience=admin",
              undefined,
              sessionHeaders,
            );
            assert.equal(me.statusCode, 200, me.body);
            assert.equal(me.json().user.is_admin, true);
            assert.equal(
              (
                await request(
                  "GET",
                  "/api/admin/health",
                  undefined,
                  sessionHeaders,
                )
              ).statusCode,
              200,
            );
            assert.equal(
              (
                await request("GET", "/api/admin/overview", undefined, {
                  cookie: authA.cookie,
                })
              ).statusCode,
              401,
            );
            assert.equal(
              (
                await request(
                  "GET",
                  "/api/auth/me?audience=web",
                  undefined,
                  sessionHeaders,
                )
              ).statusCode,
              401,
            );
            for (const url of [
              "/internal/worker/claim",
              "/internal/job/finish",
            ]) {
              assert.equal(
                (await request("POST", url, {}, sessionHeaders)).statusCode,
                404,
              );
            }
            const missingCsrf = await request(
              "POST",
              "/api/auth/logout",
              { audience: "admin" },
              { cookie },
            );
            assert.equal(missingCsrf.statusCode, 403);
            assert.equal(missingCsrf.json().error, "csrf_invalid");
            const badOrigin = await request(
              "POST",
              "/api/auth/logout",
              { audience: "admin" },
              { ...sessionHeaders, origin: "http://untrusted.invalid" },
            );
            assert.equal(badOrigin.statusCode, 403);
            assert.equal(badOrigin.json().error, "origin_forbidden");
            assert.equal(
              (
                await request(
                  "POST",
                  "/api/auth/logout",
                  { audience: "admin" },
                  sessionHeaders,
                )
              ).statusCode,
              200,
            );
            assert.equal(
              (
                await request(
                  "GET",
                  "/api/admin/health",
                  undefined,
                  sessionHeaders,
                )
              ).statusCode,
              401,
            );
            for (let i = 0; i < 9; i++) {
              const attempt = await request(
                "POST",
                "/api/auth/login",
                { ...loginBody, password: "wrong-password" },
                { "x-forwarded-for": "198.51.100.31" },
              );
              assert.equal(attempt.statusCode, i < 8 ? 401 : 429);
            }
          } finally {
            await publicApp.close();
          }
        },
      );
      await t.test(
        "database row policies reject cross-tenant reads and writes",
        async () => {
          const record = id();
          await db.tenant(wsB, (c) =>
            c.query(
              "INSERT INTO records(id,workspace_id,kind,data) VALUES($1,$2,'action',$3)",
              [record, wsB, { title: "B private fixture" }],
            ),
          );
          assert.equal(
            (await db.query("SELECT id FROM records WHERE id=$1", [record]))
              .rowCount,
            0,
          );
          assert.equal(
            await db.tenant(
              wsA,
              async (c) =>
                (await c.query("SELECT id FROM records WHERE id=$1", [record]))
                  .rowCount,
            ),
            0,
          );
          await assert.rejects(
            () =>
              db.tenant(wsA, (c) =>
                c.query(
                  "INSERT INTO records(id,workspace_id,kind,data) VALUES($1,$2,'action','{}')",
                  [id(), wsB],
                ),
              ),
            (e) => e.code === "42501",
          );
        },
      );
      await t.test("credits are exactly once and immutable", async () => {
        const detail = {
          reason: "仅用于自动验收，非付款",
          type: "sponsored_test",
          actor_id: adminId,
        };
        const credit = () =>
          db.tenant(wsA, (c) =>
            creditWallet(
              c,
              wsA,
              "model_micro_cny",
              3000000n,
              "integration-credit-v1",
              detail,
            ),
          );
        const r = await Promise.all([credit(), credit()]);
        assert.equal(r.filter((x) => x.duplicate).length, 1);
        await db.tenant(wsA, (c) =>
          creditWallet(
            c,
            wsA,
            "data_points",
            100n,
            "integration-credit-v1",
            detail,
          ),
        );
        assert.equal(
          await db.tenant(
            wsA,
            async (c) =>
              (
                await c.query(
                  "SELECT available FROM wallets WHERE currency='model_micro_cny'",
                )
              ).rows[0].available,
          ),
          "3000000",
        );
        await assert.rejects(
          () =>
            db.tenant(wsA, (c) =>
              c.query(
                "UPDATE ledger SET amount=1 WHERE reference='integration-credit-v1'",
              ),
            ),
          (e) => e.code === "42501",
        );
      });
      await t.test(
        "tenant releases and test-only connections are initialized",
        async () => {
          bundle = await projectBundle(
            path.resolve(".."),
            "tiktok-product-scouting",
          );
          await publishSkill(
            db,
            store,
            wsA,
            adminId,
            bundle.skill_id,
            bundle,
            0,
          );
          await publishSkill(
            db,
            store,
            wsB,
            adminId,
            bundle.skill_id,
            bundle,
            0,
          );
          const price = PriceSchema.parse({
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
            max_context_tokens: 8192,
            max_output_tokens: 128,
            note: "TEST ONLY",
          });
          await db.tx(null, async (c) => {
            for (const kind of ["model", "fastmoss"]) {
              const cid = id(),
                vid = id();
              await c.query(
                "INSERT INTO connections(id,name,kind,enabled) VALUES($1,$2,$3,true)",
                [cid, "自动验收无外部调用 " + wsA, kind],
              );
              await c.query(
                "INSERT INTO connection_versions(id,connection_id,config,secret_ref,verified) VALUES($1,$2,$3,'test-only-never-used',true)",
                [
                  vid,
                  cid,
                  {
                    endpoint: "https://example.com/test-only",
                    model: "test-only",
                    protocol: kind === "model" ? "responses" : "mcp",
                  },
                ],
              );
              await c.query(
                "UPDATE connections SET active_version_id=$2 WHERE id=$1",
                [cid, vid],
              );
              await c.query(
                "INSERT INTO workspace_connections(workspace_id,connection_id) VALUES($1,$2)",
                [wsA, cid],
              );
              if (kind === "model")
                await c.query(
                  "INSERT INTO price_cards(id,connection_id,name,data,active) VALUES($1,$2,'TEST ONLY',$3,true)",
                  [id(), cid, price],
                );
            }
          });
        },
      );
      await t.test(
        "price publication accepts RMB only and keeps historical cards unchanged",
        async () => {
          const old = (
            await db.query(
              "SELECT p.* FROM price_cards p JOIN connections c ON c.id=p.connection_id WHERE c.name=$1 AND p.active",
              ["自动验收无外部调用 " + wsA],
            )
          ).rows[0];
          const payload = {
            connection_id: old.connection_id,
            name: "TEST CNY",
            data: old.data,
          };
          const rejected = await web(
            "POST",
            "/api/admin/prices",
            payload,
            authAdmin,
          );
          assert.equal(rejected.statusCode, 400);
          assert.equal(rejected.json().error, "validation_error");
          const cny = {
            ...old.data,
            currency: "CNY",
            fx: "1",
            market: {
              input: "7",
              output: "7",
              cache_read: "0",
              cache_write: "0",
            },
          };
          const badFx = await web(
            "POST",
            "/api/admin/prices",
            { ...payload, data: { ...cny, fx: "7" } },
            authAdmin,
          );
          assert.equal(badFx.statusCode, 400);
          const published = await web(
            "POST",
            "/api/admin/prices",
            { ...payload, data: cny },
            authAdmin,
          );
          assert.equal(published.statusCode, 200, published.body);
          const preserved = (
            await db.query("SELECT * FROM price_cards WHERE id=$1", [old.id])
          ).rows[0];
          assert.deepEqual(preserved.data, old.data);
          assert.equal(preserved.active, false);
          assert.equal(
            (
              await db.query(
                "SELECT data->>'currency' AS currency FROM price_cards WHERE id=$1 AND active",
                [published.json().id],
              )
            ).rows[0].currency,
            "CNY",
          );
        },
      );
      await t.test(
        "job creation is idempotent without reserving a per-job budget",
        async () => {
          const input = {
            kind: "scouting",
            title: "自动验收任务（无真实调用）",
            request: {
              market: "US",
              category: "test-only",
              candidate_count: 2,
            },
            model_budget: "1",
            data_budget: 3,
            idempotency_key: id(),
          };
          const [a, b] = await Promise.all([
            web("POST", "/api/jobs", input),
            web("POST", "/api/jobs", input),
          ]);
          assert.equal(a.statusCode, 200, a.body);
          assert.equal(b.statusCode, 200, b.body);
          assert.equal(a.json().id, b.json().id);
          jobId = a.json().id;
          const wallets = await db.tenant(
            wsA,
            async (c) => (await c.query("SELECT * FROM wallets")).rows,
          );
          assert.equal(
            wallets.find((x) => x.currency === "model_micro_cny").reserved,
            "0",
          );
          assert.equal(
            wallets.find((x) => x.currency === "data_points").reserved,
            "0",
          );
          const stored = await readJob();
          assert.equal(stored.billing_mode, "wallet_per_call");
          assert.equal(stored.model_budget, "0");
          assert.equal(stored.data_budget, "0");
          const conflict = await web("POST", "/api/jobs", {
            ...input,
            title: "changed",
          });
          assert.equal(conflict.statusCode, 409);
          const details = (await web("GET", "/api/jobs/" + jobId)).json();
          assert.equal(
            details.snapshot.model.price.procurement_discount,
            undefined,
          );
          assert.equal(details.snapshot.model.price.market, undefined);
        },
      );
      await t.test(
        "publishing a tenant skill does not change queued jobs or another tenant",
        async () => {
          const old = (await readJob()).snapshot.skill.digest;
          const newer = structuredClone(bundle);
          newer.files["skills/tiktok-product-scouting/SKILL.md"] +=
            "\n\nTenant A acceptance change.";
          const results = await Promise.allSettled([
            publishSkill(db, store, wsA, adminId, bundle.skill_id, newer, 1),
            publishSkill(db, store, wsA, adminId, bundle.skill_id, newer, 1),
          ]);
          assert.equal(
            results.filter((r) => r.status === "fulfilled").length,
            1,
          );
          assert.equal((await readJob()).snapshot.skill.digest, old);
          const other = await db.tenant(
            wsB,
            async (c) =>
              (
                await c.query(
                  "SELECT r.digest,r.version FROM skill_bindings b JOIN skill_releases r ON r.id=b.release_id",
                )
              ).rows[0],
          );
          assert.equal(other.digest, old);
          assert.equal(other.version, 1);
        },
      );
      await t.test(
        "worker claims once and stale fences cannot heartbeat",
        async () => {
          const request = {
            method: "POST",
            url: "/internal/worker/claim",
            headers: {
              authorization: "Bearer " + workerKey.toString("base64url"),
            },
            payload: { worker_id: "integration-worker" },
          };
          const [a, b] = await Promise.all([
            app.inject(request),
            app.inject(request),
          ]);
          assert.equal(a.statusCode, 200, a.body);
          assert.equal(b.statusCode, 200, b.body);
          const claimed = [a.json(), b.json()].find((x) => x.job);
          assert.equal([a.json(), b.json()].filter((x) => x.job).length, 1);
          assert.equal(claimed.job.id, jobId);
          scope = verifyJob(workerKey, claimed.job_token);
          assert.equal(scope.lease_bound, true);
          assert.equal(scope.exp, undefined);
          // A long-running task continues through fresh heartbeats, but the
          // same credential cannot renew an expired or superseded lease.
          await db.tenant(wsA, (c) =>
            c.query(
              "UPDATE jobs SET created_at=now()-interval '26 hours',lease_expires_at=now()+interval '90 seconds' WHERE id=$1",
              [jobId],
            ),
          );
          const beat = () =>
            app.inject({
              method: "POST",
              url: "/internal/job/heartbeat",
              headers: { authorization: "Bearer " + claimed.job_token },
              payload: {},
            });
          assert.equal((await beat()).statusCode, 200);
          await db.tenant(wsA, (c) =>
            c.query(
              "UPDATE jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1",
              [jobId],
            ),
          );
          assert.equal((await beat()).statusCode, 409);
          await db.tenant(wsA, (c) =>
            c.query(
              "UPDATE jobs SET lease_expires_at=now()+interval '90 seconds' WHERE id=$1",
              [jobId],
            ),
          );
          const stale = signJob(workerKey, { ...scope, fence: "0" });
          assert.equal(
            (
              await app.inject({
                method: "POST",
                url: "/internal/job/heartbeat",
                headers: { authorization: "Bearer " + stale },
                payload: {},
              })
            ).statusCode,
            409,
          );
        },
      );
      await t.test(
        "per-call reservation and settlement are idempotent",
        async () => {
          const inv = await beginInvocation(
            db,
            scope,
            "model",
            "test-call-1",
            () => 200000n,
          );
          assert.equal((await readJob()).model_inflight, "200000");
          let wallet = await db.tenant(
            wsA,
            async (c) =>
              (
                await c.query(
                  "SELECT available,reserved FROM wallets WHERE currency='model_micro_cny'",
                )
              ).rows[0],
          );
          assert.deepEqual(wallet, {
            available: "2800000",
            reserved: "200000",
          });
          await settleInvocation(
            db,
            store,
            scope,
            inv.invocation,
            Buffer.from('{"test":true}'),
            { sale: 100000n, procurement: 60000n, usage: { test_only: true } },
          );
          await settleInvocation(
            db,
            store,
            scope,
            inv.invocation,
            Buffer.from('{"test":true}'),
            { sale: 100000n, procurement: 60000n, usage: { test_only: true } },
          );
          const j = await readJob();
          assert.equal(j.model_inflight, "0");
          assert.equal(j.model_spent, "100000");
          wallet = await db.tenant(
            wsA,
            async (c) =>
              (
                await c.query(
                  "SELECT available,reserved FROM wallets WHERE currency='model_micro_cny'",
                )
              ).rows[0],
          );
          assert.deepEqual(wallet, { available: "2900000", reserved: "0" });
          const cached = await beginInvocation(
            db,
            scope,
            "model",
            "test-call-1",
            () => 200000n,
          );
          assert.equal(cached.cached.charged, "100000");
          await assert.rejects(
            beginInvocation(
              db,
              scope,
              "model",
              "too-expensive-for-shared-wallet",
              () => 3000000n,
            ),
            (e) => e.code === "insufficient_model_micro_cny",
          );
        },
      );
      await t.test(
        "failed job releases unused funds and finalization cannot charge twice",
        async () => {
          const payload = {
            method: "POST",
            url: "/internal/job/finish",
            headers: { authorization: "Bearer " + signJob(workerKey, scope) },
            payload: { error_code: "expected_test_failure" },
          };
          const result = await app.inject(payload);
          assert.equal(result.statusCode, 200, result.body);
          assert.equal((await app.inject(payload)).statusCode, 409);
          const wallets = await db.tenant(
            wsA,
            async (c) => (await c.query("SELECT * FROM wallets")).rows,
          );
          assert.equal(
            wallets.find((x) => x.currency === "model_micro_cny").available,
            "2900000",
          );
          assert.equal(
            wallets.find((x) => x.currency === "model_micro_cny").reserved,
            "0",
          );
          assert.equal(
            wallets.find((x) => x.currency === "data_points").available,
            "100",
          );
          assert.equal((await readJob()).status, "failed");
        },
      );
      await t.test(
        "new scouting jobs automatically publish rich reports and candidates from archived evidence",
        async () => {
          await db.tenant(wsA, (c) =>
            creditWallet(
              c,
              wsA,
              "data_points",
              100n,
              "report-recovery-fixture-credit",
              { reason: "isolated test" },
            ),
          );
          for (const recover of [false, true, "rich"]) {
            const created = await web("POST", "/api/jobs", {
              kind: "scouting",
              title: "用户选品规则验收",
              request: {
                market: "US",
                category: "home storage",
                candidate_count: 2,
                selection_rules:
                  "关注高评分，参考 4.9 分；综合判断，不逐项淘汰。",
              },
              model_budget: "1",
              data_budget: 3,
              idempotency_key: id(),
            });
            assert.equal(created.statusCode, 200, created.body);
            const claimed = await app.inject({
              method: "POST",
              url: "/internal/worker/claim",
              headers: {
                authorization: "Bearer " + workerKey.toString("base64url"),
              },
              payload: { worker_id: "candidate-pool-worker" },
            });
            assert.equal(claimed.statusCode, 200, claimed.body);
            assert.equal(claimed.json().job.id, created.json().id);
            const candidateScope = verifyJob(
              workerKey,
              claimed.json().job_token,
            );
            const prepared = await beginInvocation(
              db,
              candidateScope,
              "data",
              "candidate-pool-fixture",
              () => 10n,
            );
            const source = {
              source: "FastMoss",
              tool: "product_rank_new_listed",
              request: { filter: { region: "US" } },
              captured_at: "2026-09-12T00:00:00.000Z",
              decoded: [
                {
                  data: {
                    list: [
                      {
                        product_id: "candidate-001",
                        title: "Bathroom organizer",
                        region: "US",
                        floor_price: 29.99,
                        ceiling_price: 39.99,
                        currency_code: "USD",
                        product_rating: 4.5,
                        last_7d_units_sold: 140,
                        last_28d_units_sold: 560,
                        total_units_sold: 900,
                      },
                      {
                        product_id: "candidate-002",
                        title: "Storage rack",
                        region: "US",
                      },
                    ],
                  },
                },
              ],
            };
            await settleInvocation(
              db,
              store,
              candidateScope,
              prepared.invocation,
              Buffer.from(JSON.stringify(source)),
              {
                sale: 10n,
                procurement: 10n,
                usage: { points: 1, tool: source.tool, cache_hit: false },
              },
            );
            const trendInvocation = await beginInvocation(
              db,
              candidateScope,
              "data",
              "candidate-trend-fixture",
              () => 10n,
            );
            const trendSource = {
              source: "FastMoss",
              tool: "product_sales_trend",
              request: {
                filter: { product_id: "candidate-001", time_range_days: 14 },
              },
              captured_at: "2026-09-12T00:00:01.000Z",
              decoded: [
                {
                  data: {
                    daily_trend: [
                      { date: "2026-09-09", daily_units_sold: 10 },
                      { date: "2026-09-10", daily_units_sold: 20 },
                      { date: "2026-09-11", daily_units_sold: 30 },
                    ],
                  },
                },
              ],
            };
            trendSource.decoded[0].content_index = 0;
            trendSource.result = {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(trendSource.decoded[0].data),
                },
              ],
            };
            await settleInvocation(
              db,
              store,
              candidateScope,
              trendInvocation.invocation,
              Buffer.from(JSON.stringify(trendSource)),
              {
                sale: 10n,
                procurement: 10n,
                usage: { points: 1, tool: trendSource.tool, cache_hit: false },
              },
            );
            let richResult;
            if (recover === "rich") {
              const postPolicy = (payload) =>
                app.inject({
                  method: "POST",
                  url: "/internal/job/policy",
                  headers: {
                    authorization: "Bearer " + claimed.json().job_token,
                  },
                  payload,
                });
              assert.equal(
                (
                  await postPolicy({
                    action: "fetch",
                    url: "https://evil.test/a",
                  })
                ).statusCode,
                400,
              );
              let release, entered;
              const started = new Promise((r) => {
                entered = r;
              });
              const gate = new Promise((r) => {
                release = r;
              });
              policyWait = async () => {
                entered();
                await gate;
              };
              const pending = postPolicy({
                action: "fetch",
                url: "https://www.ftc.gov/a",
              }).then((r) => r);
              await started;
              try {
                const heartbeat = await app.inject({
                  method: "POST",
                  url: "/internal/job/heartbeat",
                  headers: {
                    authorization: "Bearer " + claimed.json().job_token,
                  },
                  payload: {},
                });
                assert.equal(heartbeat.statusCode, 200, heartbeat.body);
                const busy = await postPolicy({
                  action: "fetch",
                  url: "https://www.ftc.gov/b",
                });
                assert.equal(busy.statusCode, 429);
              } finally {
                release();
                policyWait = undefined;
              }
              const first = await pending;
              assert.equal(first.statusCode, 200, first.body);
              const again = await postPolicy({
                action: "fetch",
                url: "https://www.ftc.gov/a",
              });
              assert.equal(
                first.json().invocation_id,
                again.json().invocation_id,
              );
              const cancelStarted = new Promise((r) => {
                entered = r;
              });
              const cancelGate = new Promise((r) => {
                release = r;
              });
              policyWait = async () => {
                entered();
                await cancelGate;
              };
              const cancelledRead = postPolicy({
                action: "fetch",
                url: "https://www.ftc.gov/cancel",
              }).then((r) => r);
              await cancelStarted;
              try {
                await db.tenant(wsA, (c) =>
                  c.query("UPDATE jobs SET cancel_requested=true WHERE id=$1", [
                    candidateScope.job_id,
                  ]),
                );
              } finally {
                release();
                policyWait = undefined;
              }
              assert.equal((await cancelledRead).json().error, "job_cancelled");
              await db.tenant(wsA, (c) =>
                c.query("UPDATE jobs SET cancel_requested=false WHERE id=$1", [
                  candidateScope.job_id,
                ]),
              );
              const base = {
                status: "partial",
                summary: "Individual research",
                sections: [],
                candidates: [],
                questions: [],
                limitations: [],
                next_actions: [],
              };
              richResult = ensureScoutingCandidates(
                base,
                { market: "US", candidate_count: 2 },
                new Map([[prepared.invocation.id, source]]),
              );
              for (const [i, candidate] of richResult.candidates.entries())
                candidate.research = {
                  growth: {
                    summary: `Product ${i} has a distinct growth hypothesis`,
                    evidence_ids: [prepared.invocation.id],
                    limitations: [],
                  },
                  reputation: {
                    summary: "评分与空评论样本应分开解读",
                    evidence_ids: [prepared.invocation.id],
                    limitations: [],
                  },
                  competition: {
                    summary: `Product ${i} competition sample is limited`,
                    evidence_ids: [prepared.invocation.id],
                    limitations: [],
                  },
                  test_plan: {
                    summary: `Experiment ${i} from observed product data`,
                    rationale: "Source-specific channel and price hypothesis",
                    evidence_ids: [prepared.invocation.id],
                    assumptions: ["Suggested threshold, not a forecast"],
                  },
                  links: [],
                };
              richResult.policy_checks = [
                {
                  scope: "Paid creators",
                  summary: "Disclosure applicability",
                  action: "Include clear sponsorship labels",
                  status: "reviewed",
                  evidence_ids: [
                    first.json().invocation_id,
                    prepared.invocation.id,
                  ],
                },
              ];
            }
            if (recover === "rich") {
              richResult.status = "complete";
              richResult.summary = "模型认为评分低于预期，但仍值得小测";
              richResult.candidates[0].decision = "shortlist";
              for (const candidate of richResult.candidates) {
                delete candidate.strategy_a;
                delete candidate.strategy_b;
              }
              richResult.candidates[0].evidence.push({
                invocation_id: trendInvocation.invocation.id,
                pointer:
                  "/result/content/0/text/daily_trend/0/daily_units_sold",
                value: 10,
                metric: "daily_units_sold",
                unit: "units",
                period_start: "2026-09-09",
                period_end: "2026-09-09",
                timezone: null,
              });
            }
            const finished = await app.inject({
              method: "POST",
              url: "/internal/job/finish",
              headers: {
                authorization: "Bearer " + claimed.json().job_token,
              },
              payload:
                recover === true
                  ? { error_code: "agent_execution_failed" }
                  : recover === "rich"
                    ? { result: richResult }
                    : {
                        result: {
                          status: "partial",
                          summary: "模型未写入候选",
                          sections: [],
                          candidates: [],
                          questions: [],
                          limitations: [],
                          next_actions: [],
                        },
                      },
            });
            assert.equal(finished.statusCode, 200, finished.body);
            assert.equal(
              finished.json().status,
              recover === "rich" ? "succeeded" : "partial",
            );
            assert.equal(finished.json().result.analysis_mode, "user_rules");
            if (recover === "rich") {
              assert.equal(
                finished.json().result.policy_checks[0].status,
                "pending",
              );
              assert.match(
                finished.json().result.policy_checks[0].action,
                /先补充/,
              );
            }
            assert.equal(finished.json().result.candidates.length, 2);
            assert.deepEqual(
              finished.json().result.candidates.map((item) => item.decision),
              recover === "rich" ? ["shortlist", "watch"] : ["watch", "watch"],
            );
            const list = await web(
              "GET",
              `/api/reports/${finished.json().result.report_id}/candidates`,
            );
            assert.equal(list.statusCode, 200, list.body);
            assert.equal(list.json().items.length, 2);
            assert.equal(list.json().items[0].price, 29.99);
            assert.equal(list.json().items[0].price_max, 39.99);
            assert.equal(list.json().items[0].rating, 4.5);
            const record = (await web("GET", "/api/records?kind=report"))
              .json()
              .items.find((r) => r.id === finished.json().result.report_id);
            assert.equal(record.data.report_quality.candidate_count, 2);
            if (recover === true)
              assert.equal(record.data.recovery.from_archived_data, true);
            assert.equal(
              record.data.report_quality.field_coverage.product_rating,
              1,
            );
            assert.equal(
              record.data.report_quality.daily_sales_series_count,
              1,
            );
            const html = await web(
              "GET",
              `/api/artifacts/${record.data.artifact_id}`,
            );
            assert.equal(html.statusCode, 200, html.body);
            assert.ok(html.body.includes("用户输入"));
            assert.ok(!html.body.includes("STRATEGY A"));
            assert.ok(!html.body.includes("查看逐项条件"));
            if (recover === "rich")
              assert.ok(html.body.includes(richResult.summary));
            for (const expected of [
              "USD 29.99 – 39.99",
              "140 件",
              "每日销量",
              "每日累计销量",
              "60 件观测累计",
              "评分 1/2",
              "日销量序列 1/2",
            ])
              assert.ok(html.body.includes(expected), expected);
            assert.equal(
              finished.json().data_spent,
              "20",
              "report generation adds no paid calls",
            );
          }
        },
      );
      await t.test(
        "immutable historical import keeps 60 candidates and requires explicit promotion",
        async () => {
          const r = await web("POST", "/api/reports/import-reference", {});
          assert.equal(r.statusCode, 200, r.body);
          const report = r.json();
          assert.equal(report.data.candidate_count, 60);
          assert.equal(report.data.sections.length, 14);
          const repeat = await web("POST", "/api/reports/import-reference", {});
          assert.equal(repeat.json().id, report.id);
          assert.equal(
            (await web("GET", "/api/records?kind=opportunity")).json().items
              .length,
            0,
          );
          const list = await web("GET", `/api/reports/${report.id}/candidates`);
          assert.equal(list.json().items.length, 60);
          const promoted = await web(
            "POST",
            `/api/reports/${report.id}/promote`,
            { product_ids: [list.json().items[0].product_id] },
          );
          assert.equal(promoted.statusCode, 200, promoted.body);
          assert.equal(promoted.json().created, 1);
          const html = await web(
            "GET",
            `/api/artifacts/${report.data.artifact_id}`,
          );
          assert.equal(html.statusCode, 200);
          assert.ok(
            html.headers["content-security-policy"].includes("sandbox"),
          );
          const authB = await login(loginB);
          assert.equal(
            (
              await web(
                "GET",
                `/api/artifacts/${report.data.artifact_id}`,
                undefined,
                authB,
                wsB,
              )
            ).statusCode,
            404,
          );
        },
      );
      await t.test(
        "late verified usage releases a reconciling reservation once",
        async () => {
          const created = await web("POST", "/api/jobs", {
            kind: "scouting",
            title: "迟到用量验收",
            request: { category: "test-only", candidate_count: 1 },
            model_budget: "1",
            data_budget: 1,
            idempotency_key: id(),
          });
          assert.equal(created.statusCode, 200, created.body);
          const claim = await app.inject({
            method: "POST",
            url: "/internal/worker/claim",
            headers: {
              authorization: "Bearer " + workerKey.toString("base64url"),
            },
            payload: { worker_id: "integration-worker" },
          });
          assert.equal(claim.json().job.id, created.json().id);
          const lateScope = verifyJob(workerKey, claim.json().job_token);
          const call = await beginInvocation(
            db,
            lateScope,
            "model",
            "late-call",
            () => 200000n,
          );
          await uncertainInvocation(
            db,
            lateScope,
            call.invocation,
            "test_timeout",
          );
          const stopped = await app.inject({
            method: "POST",
            url: "/internal/job/finish",
            headers: { authorization: "Bearer " + claim.json().job_token },
            payload: {
              error_code: "test_timeout",
              result: {
                status: "partial",
                summary: "待核验阶段输出",
                sections: [],
                candidates: [],
                questions: [],
                limitations: [],
                next_actions: [],
              },
            },
          });
          assert.equal(stopped.statusCode, 200, stopped.body);
          assert.equal(stopped.json().status, "reconciling");
          assert.equal(
            (
              await db.query("SELECT 1 FROM dispatch WHERE job_id=$1", [
                created.json().id,
              ])
            ).rowCount,
            0,
          );
          assert.equal(
            (
              await db.query("SELECT 1 FROM worker_nodes WHERE active_job=$1", [
                created.json().id,
              ])
            ).rowCount,
            0,
          );
          const settle = () =>
            settleInvocation(
              db,
              store,
              lateScope,
              call.invocation,
              Buffer.from('{"test":true}'),
              {
                sale: 150000n,
                procurement: 100000n,
                usage: { test_only: true },
              },
            );
          await settle();
          await settle();
          await uncertainInvocation(
            db,
            lateScope,
            call.invocation,
            "stale_error_after_success",
          );
          const state = await db.tenant(wsA, async (c) => ({
            job: (
              await c.query("SELECT * FROM jobs WHERE id=$1", [
                created.json().id,
              ])
            ).rows[0],
            wallet: (
              await c.query(
                "SELECT * FROM wallets WHERE currency='model_micro_cny'",
              )
            ).rows[0],
          }));
          assert.equal(state.job.status, "failed");
          assert.equal(state.job.model_spent, "150000");
          assert.equal(state.job.model_inflight, "0");
          assert.equal(
            state.job.checkpoint.unverified_result.summary,
            "待核验阶段输出",
          );
          assert.equal(state.wallet.reserved, "0");
          assert.equal(state.wallet.available, "2750000");
        },
      );
      await t.test(
        "late settlement publishes the saved draft exactly once and keeps charges when delivery validation fails",
        async () => {
          for (const mode of ["valid", "invalid", "cancelled", "legacy"]) {
            const created = await web("POST", "/api/jobs", {
              kind: "scouting",
              title: "保存草稿结算验收 " + mode,
              request: {
                category: "test-only",
                candidate_count: 1,
                selection_rules: "参考售价",
              },
              idempotency_key: id(),
            });
            assert.equal(created.statusCode, 200, created.body);
            const claim = await app.inject({
              method: "POST",
              url: "/internal/worker/claim",
              headers: {
                authorization: "Bearer " + workerKey.toString("base64url"),
              },
              payload: { worker_id: "integration-worker" },
            });
            const claimed = claim.json();
            assert.equal(claimed.job.id, created.json().id);
            const scoped = verifyJob(workerKey, claimed.job_token);
            const dataCall = await beginInvocation(
              db,
              scoped,
              "data",
              "draft-source",
              () => 10n,
            );
            const source = {
              source: "FastMoss",
              tool: "product_search",
              captured_at: new Date().toISOString(),
              request: {},
              decoded: [
                {
                  content_index: 0,
                  data: {
                    list: [
                      {
                        product: {
                          product_id: "1732563767390343999",
                          title: "测试商品",
                          floor_price: 9.99,
                          currency_code: "USD",
                        },
                      },
                    ],
                  },
                },
              ],
            };
            await settleInvocation(
              db,
              store,
              scoped,
              dataCall.invocation,
              Buffer.from(JSON.stringify(source)),
              {
                sale: 10n,
                procurement: 10n,
                usage: { tool: "product_search" },
              },
            );
            const inflight = await Promise.all(
              ["one", "two"].map((key) =>
                beginInvocation(
                  db,
                  scoped,
                  "model",
                  "pending-" + key,
                  () => 1000n,
                ),
              ),
            );
            const draft = ensureScoutingCandidates(
              {
                status: "complete",
                summary: "模型已写入的独立判断",
                sections: [],
                candidates: [],
                questions: [],
                limitations: [],
                next_actions: [],
              },
              { candidate_count: 1, selection_rules: "参考售价" },
              new Map([[dataCall.invocation.id, source]]),
            );
            assert.equal(draft.candidates.length, 1);
            draft.candidates[0].reason = "保留模型原来的商品分析";
            if (mode === "invalid")
              draft.candidates[0].evidence.push({
                invocation_id: dataCall.invocation.id,
                pointer: "/decoded/0/data/list/0/product/floor_price",
                value: 999,
                metric: "售价",
                unit: "USD",
                period_start: null,
                period_end: null,
                timezone: null,
              });
            if (mode === "cancelled")
              await db.tenant(wsA, (c) =>
                c.query("UPDATE jobs SET cancel_requested=true WHERE id=$1", [
                  scoped.job_id,
                ]),
              );
            const stopped = await app.inject({
              method: "POST",
              url: "/internal/job/finish",
              headers: { authorization: "Bearer " + claimed.job_token },
              payload: { result: draft, error_code: "agent_deadline_exceeded" },
            });
            assert.equal(stopped.statusCode, 200, stopped.body);
            assert.equal(stopped.json().status, "reconciling");
            const settle = (call) =>
              settleInvocation(
                db,
                store,
                scoped,
                call.invocation,
                Buffer.from('{"output":[]}'),
                { sale: 500n, procurement: 100n, usage: { test_only: true } },
              );
            await settle(inflight[0]);
            assert.equal(
              (
                await db.tenant(
                  wsA,
                  async (c) =>
                    (
                      await c.query("SELECT status FROM jobs WHERE id=$1", [
                        scoped.job_id,
                      ])
                    ).rows[0],
                )
              ).status,
              "reconciling",
            );
            if (mode === "legacy")
              await db.tenant(wsA, (c) =>
                c.query(
                  "UPDATE jobs SET status='failed',error_code='late_usage_settled' WHERE id=$1",
                  [scoped.job_id],
                ),
              );
            await settle(inflight[1]);
            await settle(inflight[1]);
            if (mode === "legacy") {
              const wallets = () =>
                db.tenant(
                  wsA,
                  async (c) =>
                    (
                      await c.query(
                        "SELECT currency,available,reserved FROM wallets ORDER BY currency",
                      )
                    ).rows,
                );
              const before = await wallets();
              const recovered = await recoverFailedScouting(
                db,
                store,
                wsA,
                scoped.job_id,
                { reason: "agent_deadline_exceeded" },
              );
              assert.equal(recovered.from_saved_analysis, true);
              assert.equal(recovered.billing_changed, false);
              assert.equal(
                (await recoverFailedScouting(db, store, wsA, scoped.job_id))
                  .already_recovered,
                true,
              );
              assert.deepEqual(await wallets(), before);
            }
            const final = await db.tenant(wsA, async (c) => ({
              job: (
                await c.query("SELECT * FROM jobs WHERE id=$1", [scoped.job_id])
              ).rows[0],
              reports: (
                await c.query(
                  "SELECT * FROM records WHERE kind='report' AND data->>'job_id'=$1",
                  [scoped.job_id],
                )
              ).rows,
              ledger: (
                await c.query(
                  "SELECT count(*)::int AS n FROM ledger WHERE operation='charge' AND reference=ANY($1::text[])",
                  [inflight.map((x) => x.invocation.id)],
                )
              ).rows[0].n,
            }));
            assert.equal(
              final.job.status,
              ["valid", "legacy"].includes(mode)
                ? "partial"
                : mode === "invalid"
                  ? "failed"
                  : "cancelled",
            );
            assert.equal(final.job.model_spent, "1000");
            assert.equal(final.job.model_inflight, "0");
            assert.equal(final.ledger, 2);
            assert.equal(
              final.reports.length,
              ["valid", "legacy"].includes(mode) ? 1 : 0,
            );
            if (["valid", "legacy"].includes(mode)) {
              assert.equal(final.job.error_code, "agent_deadline_exceeded");
              assert.equal(
                final.job.result.candidates[0].reason,
                "保留模型原来的商品分析",
              );
              const html = await web(
                "GET",
                `/api/artifacts/${final.reports[0].data.artifact_id}`,
              );
              assert.equal(html.statusCode, 200, html.body);
              assert.match(html.body, /保留模型原来的商品分析/);
            }
            if (mode === "invalid") {
              assert.equal(
                final.job.checkpoint.pending_delivery_error,
                "evidence_value_mismatch",
              );
              assert.equal(
                final.job.checkpoint.unverified_result.candidates[0].reason,
                "保留模型原来的商品分析",
              );
            }
          }
        },
      );
      await t.test(
        "batch intake stores long identifiers and preserves unresolved short links",
        async () => {
          const result = await web("POST", "/api/supply/batches", {
            title: "批量货源验收",
            tk_urls: [
              "https://www.tiktok.com/shop/pdp/1732563767390343216",
              "https://vm.tiktok.com/shortlink/",
            ],
          });
          assert.equal(result.statusCode, 200, result.body);
          assert.equal(
            result.json().data.items[0].product_id,
            "1732563767390343216",
          );
          assert.equal(result.json().data.items[1].status, "needs_resolution");
          assert.equal(
            (await web("GET", "/api/records?kind=source_batch")).json().items
              .length,
            1,
          );
        },
      );
      await t.test(
        "measured packaging and immutable cost scenarios preserve unknown fees and tenant links",
        async () => {
          const example = JSON.parse(
            await readFile(
              new URL(
                "../../skills/tiktok-unit-economics/assets/example.json",
                import.meta.url,
              ),
              "utf8",
            ),
          );
          async function create(kind, data) {
            const response = await web("POST", "/api/records", { kind, data });
            assert.equal(response.statusCode, 200, response.body);
            return response.json();
          }
          const opportunity = await create("opportunity", {
            product_id: "1000000000000000000",
            title: "虚构验收商品，不用于经营",
            tk_url: "https://www.tiktok.com/shop/pdp/1000000000000000000",
            source: {
              kind: "manual",
              reference: "TEST ONLY",
              captured_at: "2026-09-08T00:00:00.000Z",
            },
          });
          const supplier = await create("supplier", {
            opportunity_id: opportunity.id,
            offer_url: "https://detail.1688.com/offer/1000000000000000.html",
            offer_id: "1000000000000000",
            sku_id: "TEST-ONLY",
            sku_description: "虚构规格",
            price_cny: 20,
            moq: 1,
            status: "confirmed",
            source: "虚构验收报价",
            quoted_at: "2026-09-05",
          });
          const measurement = await create("measurement", {
            ...example.shipping.parcel,
            supplier_id: supplier.id,
            packaging_version: "test-v1",
            basis: "measured",
          });
          const rate = await create("rate_card", example.shipping.rate_card);
          const body = {
            title: "虚构验收成本方案",
            opportunity_id: opportunity.id,
            supplier_id: supplier.id,
            measurement_id: measurement.id,
            rate_card_id: rate.id,
            input: example,
          };
          const complete = await create("economics", body);
          assert.equal(complete.data.result.shipping.billable_weight_kg, 0.5);
          assert.equal(complete.data.result.shipping.amount, 35);
          assert.equal(
            typeof complete.data.result.contribution_margin,
            "number",
          );
          const unknown = structuredClone(body);
          unknown.input.costs.find((c) => c.category === "advertising").status =
            "unknown";
          const blocked = await create("economics", unknown);
          assert.equal(blocked.data.result.contribution_margin, null);
          assert.ok(blocked.data.result.blockers.length);
          assert.equal(
            (
              await web("PUT", `/api/records/${measurement.id}`, {
                version: measurement.version,
                data: measurement.data,
              })
            ).statusCode,
            409,
          );
          assert.equal(
            (
              await web("PUT", `/api/records/${supplier.id}`, {
                version: supplier.version,
                data: { ...supplier.data, price_cny: 99 },
              })
            ).statusCode,
            200,
          );
          const saved = (
            await web("GET", `/api/records/${complete.id}`)
          ).json();
          assert.equal(saved.data.dependencies.supplier_id.version, 1);
          assert.equal(
            saved.data.input.costs.find((c) => c.category === "procurement")
              .amount,
            20,
          );
          const foreign = id();
          await db.tenant(wsB, (c) =>
            c.query(
              "INSERT INTO records(id,workspace_id,kind,data,created_by) VALUES($1,$2,'opportunity',$3,$4)",
              [foreign, wsB, opportunity.data, userB],
            ),
          );
          assert.equal(
            (
              await web("POST", "/api/records", {
                kind: "supplier",
                data: { ...supplier.data, opportunity_id: foreign },
              })
            ).statusCode,
            404,
          );
        },
      );
      await t.test(
        "assistant conversations isolate context, serialize turns and validate reused evidence",
        async () => {
          const sid = "tiktok-product-assistant";
          await publishSkill(
            db,
            store,
            wsA,
            adminId,
            sid,
            await projectBundle(path.resolve(".."), sid),
            0,
          );
          const reports = (await web("GET", "/api/records?kind=report")).json()
            .items;
          const report = reports[0];
          const candidate = (
            await web("GET", `/api/reports/${report.id}/candidates`)
          ).json().items[0];
          const cid = id(),
            manual = {
              kind: "manual",
              title: "测试样品",
              product_id: "1000000000000000000",
              notes: "TEST ONLY: 包装实测 0.32 kg",
            };
          const create = {
            id: cid,
            title: "对话验收，无真实调用",
            contexts: [
              {
                kind: "candidate",
                report_id: report.id,
                product_id: candidate.product_id,
              },
              manual,
            ],
          };
          const created = await web(
            "POST",
            "/api/assistant/conversations",
            create,
          );
          assert.equal(created.statusCode, 200, created.body);
          assert.equal(
            (await web("POST", "/api/assistant/conversations", create)).json()
              .id,
            cid,
          );
          const ctx = created.json().data.contexts;
          assert.equal(ctx.length, 2);
          const foreignAuth = await login(loginB);
          assert.equal(
            (
              await web(
                "GET",
                `/api/assistant/conversations/${cid}`,
                undefined,
                foreignAuth,
                wsB,
              )
            ).statusCode,
            404,
          );
          assert.equal(
            (
              await web(
                "POST",
                "/api/assistant/conversations",
                { ...create, id: id() },
                foreignAuth,
                wsB,
              )
            ).statusCode,
            404,
          );
          assert.equal(
            (
              await web("POST", "/api/jobs", {
                kind: "assistant",
                title: "bypass",
                request: {},
                model_budget: "1",
                data_budget: 0,
                idempotency_key: id(),
              })
            ).statusCode,
            400,
          );
          const input = {
            question: "只按资料解释包装重量",
            context_version: 1,
            data_mode: "context_only",
            model_budget: "1",
            data_budget: 3,
            idempotency_key: id(),
          };
          const send = () =>
            web("POST", `/api/assistant/conversations/${cid}/messages`, input);
          const [first, duplicate] = await Promise.all([send(), send()]);
          assert.equal(first.statusCode, 200, first.body);
          assert.equal(first.json().id, duplicate.json().id);
          assert.equal(
            (
              await web(
                "POST",
                `/api/assistant/conversations/${cid}/messages`,
                { ...input, idempotency_key: id() },
              )
            ).statusCode,
            409,
          );
          const jid = first.json().id;
          const claimed = await app.inject({
            method: "POST",
            url: "/internal/worker/claim",
            headers: {
              authorization: "Bearer " + workerKey.toString("base64url"),
            },
            payload: { worker_id: "integration-worker" },
          });
          assert.equal(claimed.statusCode, 200, claimed.body);
          assert.equal(claimed.json().job.id, jid);
          const s = verifyJob(workerKey, claimed.json().job_token);
          assert.equal(claimed.json().job.snapshot.data, null);
          assert.equal(claimed.json().job.limits.data_budget, null);
          assert.equal(
            claimed.json().job.limits.billing_mode,
            "wallet_per_call",
          );
          await assert.rejects(
            () => beginInvocation(db, s, "data", "forbidden-data", () => 1n),
            /connection_missing/,
          );
          const edited = await web(
            "PUT",
            `/api/assistant/conversations/${cid}/contexts`,
            { version: 1, remove_ids: [ctx[0].id] },
          );
          assert.equal(edited.statusCode, 200, edited.body);
          assert.equal(
            (
              await web("PUT", `/api/assistant/conversations/${cid}/contexts`, {
                version: 1,
                additions: [],
              })
            ).statusCode,
            409,
          );
          const j = await db.tenant(
            wsA,
            async (c) =>
              (await c.query("SELECT * FROM jobs WHERE id=$1", [jid])).rows[0],
          );
          assert.equal(j.request.contexts.length, 2);
          const answer = {
            status: "complete",
            answer: "用户提供重量为 0.32 kg。[1]",
            citations: [
              {
                source_type: "context",
                source_id: ctx[1].id,
                pointer: "/data/notes",
                value: manual.notes,
                label: "用户包装测量",
              },
            ],
            limitations: ["人工资料，未作实时核验"],
            followups: [],
          };
          const finish = (scope, result) =>
            app.inject({
              method: "POST",
              url: "/internal/job/finish",
              headers: { authorization: "Bearer " + signJob(workerKey, scope) },
              payload: { result },
            });
          assert.equal(
            (
              await finish(s, {
                ...answer,
                citations: [{ ...answer.citations[0], value: "false" }],
              })
            ).statusCode,
            409,
          );
          const finished = await finish(s, answer);
          assert.equal(finished.statusCode, 200, finished.body);
          assert.equal(finished.json().status, "succeeded");
          assert.equal(finished.json().data_spent, "0");
          const second = await web(
            "POST",
            `/api/assistant/conversations/${cid}/messages`,
            {
              ...input,
              question: "补查这件商品的当前评分",
              context_version: 2,
              data_mode: "auto",
              idempotency_key: id(),
            },
          );
          assert.equal(second.statusCode, 200, second.body);
          const claim2 = (
            await app.inject({
              method: "POST",
              url: "/internal/worker/claim",
              headers: {
                authorization: "Bearer " + workerKey.toString("base64url"),
              },
              payload: { worker_id: "integration-worker" },
            })
          ).json();
          const s2 = verifyJob(workerKey, claim2.job_token);
          assert.equal(claim2.job.request.history.length, 1);
          assert.equal(claim2.job.request.contexts.length, 1);
          const inv = await beginInvocation(
            db,
            s2,
            "data",
            "fixture-details",
            () => 10n,
            {
              tool: "product_detail_info",
              arguments: { filter: { product_id: manual.product_id } },
            },
          );
          const envelope = {
            source: "FastMoss",
            tool: "product_detail_info",
            captured_at: new Date().toISOString(),
            invocation_id: inv.invocation.id,
            decoded: [{ data: { rating: 4.4 } }],
          };
          await settleInvocation(
            db,
            store,
            s2,
            inv.invocation,
            Buffer.from(JSON.stringify(envelope)),
            {
              sale: 10n,
              procurement: 10n,
              usage: { points: 1, test_only: true },
            },
          );
          const sourced = {
            ...answer,
            answer: "测试接口评分为 4.4。[1]",
            citations: [
              {
                source_type: "data",
                source_id: inv.invocation.id,
                pointer: "/decoded/0/data/rating",
                value: 4.4,
                label: "测试评分",
              },
            ],
          };
          assert.equal((await finish(s2, sourced)).statusCode, 200);
          const third = await web(
            "POST",
            `/api/assistant/conversations/${cid}/messages`,
            {
              ...input,
              question: "解释刚才的评分",
              context_version: 2,
              idempotency_key: id(),
            },
          );
          assert.equal(third.statusCode, 200, third.body);
          const claim3 = (
            await app.inject({
              method: "POST",
              url: "/internal/worker/claim",
              headers: {
                authorization: "Bearer " + workerKey.toString("base64url"),
              },
              payload: { worker_id: "integration-worker" },
            })
          ).json();
          const s3 = verifyJob(workerKey, claim3.job_token);
          const { contextDigest } =
            await import("../src/assistant/assistant-context.mjs");
          const compaction = {
            version: 1,
            history_memory: {
              summary: "上一轮查询评分，原始证据仍保留。",
              through_job_id: claim3.job.request.history.at(-1).job_id,
              digest: contextDigest(claim3.job.request.history),
              covered_turns: claim3.job.request.history.length,
            },
            context_memory: null,
            events: [
              {
                kind: "history",
                source_bytes: 200,
                summary_bytes: 60,
                parts: 1,
              },
            ],
            input_bytes: 400,
            output_bytes: 200,
          };
          assert.equal(
            (
              await finish(s3, {
                ...sourced,
                compaction: {
                  ...compaction,
                  history_memory: {
                    ...compaction.history_memory,
                    digest: "a".repeat(64),
                  },
                },
              })
            ).statusCode,
            409,
          );
          assert.equal(
            (await finish(s3, { ...sourced, compaction })).statusCode,
            200,
          );
          const other = (
            await web("POST", "/api/assistant/conversations", {
              id: id(),
              title: "另一对话",
              contexts: [manual],
            })
          ).json();
          await web(
            "POST",
            `/api/assistant/conversations/${other.id}/messages`,
            { ...input, idempotency_key: id() },
          );
          const claim4 = (
            await app.inject({
              method: "POST",
              url: "/internal/worker/claim",
              headers: {
                authorization: "Bearer " + workerKey.toString("base64url"),
              },
              payload: { worker_id: "integration-worker" },
            })
          ).json();
          const s4 = verifyJob(workerKey, claim4.job_token);
          assert.equal((await finish(s4, sourced)).statusCode, 409);
          assert.equal(
            (
              await finish(s4, {
                ...answer,
                answer: "不引用其他对话的数据",
                citations: [],
              })
            ).statusCode,
            200,
          );
          const readback = (
            await web("GET", `/api/assistant/conversations/${cid}`)
          ).json();
          assert.equal(readback.turns.length, 3);
          assert.equal(readback.turns[1].calls[0].tool, "product_detail_info");
          assert.equal(
            readback.turns[2].result.citations[0].captured_at,
            envelope.captured_at,
          );
          assert.equal(
            (await web("GET", "/api/records?kind=report")).json().items.length,
            reports.length,
            "chat replies must not become selection reports",
          );
        },
      );
    } finally {
      await app?.close();
      for (const workspace of [wsA, wsB])
        await db.tenant(workspace, async (c) => {
          const jobs = (
            await c.query(
              "SELECT * FROM jobs WHERE status NOT IN ('succeeded','partial','failed','cancelled') FOR UPDATE",
            )
          ).rows;
          for (const job of jobs)
            if (
              BigInt(job.model_inflight) === 0n &&
              BigInt(job.data_inflight) === 0n
            )
              await finalizeJob(
                c,
                workspace,
                job,
                "failed",
                null,
                "integration_fixture_cleanup",
              );
        });
      await db.tx(null, async (c) => {
        await c.query(
          "UPDATE users SET enabled=false WHERE id=ANY($1::uuid[])",
          [[userA, userB, adminId]],
        );
        await c.query("DELETE FROM sessions WHERE user_id=ANY($1::uuid[])", [
          [userA, userB, adminId],
        ]);
        await c.query(
          "UPDATE workspaces SET enabled=false WHERE id=ANY($1::uuid[])",
          [[wsA, wsB]],
        );
        await c.query("UPDATE connections SET enabled=false WHERE name=$1", [
          "自动验收无外部调用 " + wsA,
        ]);
        await c.query("DELETE FROM worker_nodes WHERE id='integration-worker'");
      });
      await db.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
