import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createDatabase } from "../src/infra/db.mjs";
import { buildApp } from "../src/server.mjs";
import { LocalStore, SecretStore } from "../src/infra/storage.mjs";
import { id, passwordHash, PriceSchema, SKILL_IDS } from "../src/common/core.mjs";
import { finalizeJob, signJob } from "../src/research/jobs.mjs";
import { beginInvocation, settleInvocation } from "../src/data/gateway.mjs";
import { addMonths } from "../src/accounts/teams.mjs";

test("subscription month extension clamps month ends without losing UTC time", () => {
  assert.equal(
    addMonths("2026-01-31T10:30:00Z", 1).toISOString(),
    "2026-02-28T10:30:00.000Z",
  );
  assert.equal(
    addMonths("2028-01-31T10:30:00Z", 1).toISOString(),
    "2028-02-29T10:30:00.000Z",
  );
});
test(
  "email accounts, team subscriptions, model selection and shared usage",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const db = createDatabase(process.env.TEST_DATABASE_URL),
      root = await mkdtemp(path.join(tmpdir(), "tidelab-accounts-"));
    const store = new LocalStore(root),
      secrets = new SecretStore(root, randomBytes(32)),
      workerKey = randomBytes(32),
      origin = "http://127.0.0.1:4310";
    const password = "Account-test-only-strong-" + id(),
      adminId = id(),
      adminLogin = "account-admin-" + id(),
      legacy = id();
    const users = [],
      spaces = [legacy],
      jobs = [],
      connectionIds = [],
      modelRequests = [],
      outbox = [];
    let app, admin, owner, teamAdmin, member, teamId, jobA, jobB, scope;
    let address = 1;
    const call = (method, url, body, auth, wid) =>
      app.inject({
        method,
        url,
        remoteAddress: `198.51.${Math.floor(address / 250)}.${(address++ % 250) + 1}`,
        headers: {
          origin,
          ...(auth ? { cookie: auth.cookie, "x-csrf-token": auth.csrf } : {}),
          ...(wid ? { "x-workspace-id": wid } : {}),
        },
        ...(body === undefined ? {} : { payload: body }),
      });
    async function login(login, pass = password, audience = "web") {
      const r = await call("POST", "/api/auth/login", {
        login,
        password: pass,
        audience,
      });
      assert.equal(r.statusCode, 200, r.body);
      return {
        cookie: r.cookies.map((x) => x.name + "=" + x.value).join("; "),
        csrf: r.cookies.find((x) => x.name.endsWith("_csrf")).value,
      };
    }
    async function challenge(email, purpose = "register", auth) {
      const r = await call(
        "POST",
        purpose === "bind"
          ? "/api/account/email/code"
          : `/api/auth/${purpose}/code`,
        { email },
        auth,
      );
      assert.equal(r.statusCode, 200, r.body);
      const cid = r.json().challenge_id;
      assert.equal(r.json().code, undefined);
      return {
        email,
        challenge_id: cid,
        code: outbox.findLast((x) => x.email === email.toLowerCase())?.code,
      };
    }
    async function register(label) {
      const email = `${label}-${id()}@example.test`,
        v = await challenge(email.toUpperCase());
      const incomplete = await call("POST", "/api/auth/register", { ...v, password, display_name: label });
      assert.equal(incomplete.statusCode, 400);
      const r = await call("POST", "/api/auth/register", {
        ...v,
        password,
        display_name: label,
        profile: {
          company_name: "Local QA", contact_name: "Tester", address: "QA address",
          phone: "+86 138 0000 0000", company_size: "1–5人", annual_revenue: "0",
          revenue_currency: "CNY", revenue_year: 2025,
        },
      });
      assert.equal(r.statusCode, 200, r.body);
      const auth = await login(email.toUpperCase()),
        me = (await call("GET", "/api/auth/me", undefined, auth)).json();
      const details = (await call("GET", "/api/account/profile", undefined, auth)).json();
      assert.equal(details.profile.data.company_name, "Local QA");
      assert.equal(details.profile.data.annual_revenue, "0");
      users.push(me.user.id);
      spaces.push(...me.workspaces.map((x) => x.id));
      return { ...auth, id: me.user.id, email, personal: me.workspaces[0].id };
    }
    const adminCall = (method, url, body) => call(method, url, body, admin);
    const request = (model) => ({
      kind: "scouting",
      title: "Fixture research",
      request: { market: "US", category: "fixture", candidate_count: 2 },
      model_connection_id: model,
      idempotency_key: id(),
    });
    const readJob = (j) =>
      db.tenant(
        teamId,
        async (c) =>
          (await c.query("SELECT * FROM jobs WHERE id=$1", [j])).rows[0],
      );
    try {
      await db.query("INSERT INTO workspaces(id,name) VALUES($1,$2)", [
        legacy,
        "Account validation admin",
      ]);
      await db.query(
        "INSERT INTO users(id,login,password_hash,display_name,is_admin) VALUES($1,$2,$3,$4,true)",
        [adminId, adminLogin, await passwordHash(password), "Validation admin"],
      );
      await db.query(
        "INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,'owner')",
        [legacy, adminId],
      );
      for (const kind of ["model", "model", "fastmoss"]) {
        const cid = id(),
          vid = id();
        connectionIds.push(cid);
        await db.query(
          "INSERT INTO connections(id,name,kind,enabled,signup_default) VALUES($1,$2,$3,true,true)",
          [cid, "Fixture " + cid, kind],
        );
        await db.query(
          "INSERT INTO connection_versions(id,connection_id,config,secret_ref,verified) VALUES($1,$2,$3,$4,true)",
          [
            vid,
            cid,
            {
              endpoint: "https://example.com/test",
              protocol: kind === "model" ? "responses" : "mcp",
              model: cid,
            },
            await secrets.write("isolated-fixture-key", `${cid}:${vid}`),
          ],
        );
        await db.query(
          "UPDATE connections SET active_version_id=$2 WHERE id=$1",
          [cid, vid],
        );
        if (kind === "model")
          await db.query(
            "INSERT INTO price_cards(id,connection_id,name,data,active) VALUES($1,$2,$3,$4,true)",
            [
              id(),
              cid,
              "Fixture",
              PriceSchema.parse({
                currency: "USD",
                fx: "7",
                market: {
                  input: "1",
                  output: "2",
                  cache_read: "0.1",
                  cache_write: "0",
                },
                procurement_discount: "1",
                sale_discount: cid === connectionIds[1] ? "3" : "1.5",
                max_context_tokens: 64000,
                max_output_tokens: 4096,
              }),
            ],
          );
      }
      app = await buildApp({
        db,
        store,
        secrets,
        workerKey,
        projectRoot: path.resolve(".."),
        publicOrigin: origin,
        mailerOverride: {
          ready: async () => true,
          send: async (message) => {
            outbox.push(message);
          },
        },
        gatewayOverrides: {
          modelFetch: async (_url, options) => {
            modelRequests.push(JSON.parse(options.body));
            return {
              response: new Response(JSON.stringify({
                id: "fixture-response", status: "completed", output: [],
                usage: { input_tokens: 1000, output_tokens: 50, input_tokens_details: { cached_tokens: 100 } },
              }), { headers: { "Content-Type": "application/json" } }),
              close: async () => {},
            };
          },
        },
      });
      await app.ready();
      admin = await login(adminLogin, password, "admin");
      await t.test(
        "verification codes stay private, have bounded attempts, resist replay and purpose confusion",
        async () => {
          const email = `brute-${id()}@example.test`,
            v = await challenge(email);
          for (let i = 0; i < 5; i++)
            assert.equal(
              (
                await call("POST", "/api/auth/register", {
                  ...v,
                  code: "000000",
                  password,
                  display_name: "Nope",
        profile: {
          company_name: "Local QA", contact_name: "Tester", address: "QA address",
          phone: "+86 138 0000 0000", company_size: "1–5人", annual_revenue: "0",
          revenue_currency: "CNY", revenue_year: 2025,
        },
                })
              ).statusCode,
              400,
            );
          assert.equal(
            (
              await db.query(
                "SELECT attempts FROM email_challenges WHERE id=$1",
                [v.challenge_id],
              )
            ).rows[0].attempts,
            5,
          );
          assert.equal(
            (
              await call("POST", "/api/auth/register", {
                ...v,
                password,
                display_name: "Nope",
        profile: {
          company_name: "Local QA", contact_name: "Tester", address: "QA address",
          phone: "+86 138 0000 0000", company_size: "1–5人", annual_revenue: "0",
          revenue_currency: "CNY", revenue_year: 2025,
        },
              })
            ).statusCode,
            400,
          );
          assert.equal(
            (await call("POST", "/api/auth/register/code", { email }))
              .statusCode,
            429,
          );
          const unknown = await call("POST", "/api/auth/reset/code", {
            email: `absent-${id()}@example.test`,
          });
          assert.equal(unknown.statusCode, 200);
          assert.equal(unknown.json().code, undefined);
          owner = await register("owner");
          teamAdmin = await register("manager");
          const used = await db.query(
            "SELECT id FROM email_challenges WHERE email=$1 AND consumed_at IS NOT NULL",
            [owner.email],
          );
          assert.equal(used.rowCount, 1);
          assert.equal(
            (
              await call("POST", "/api/auth/reset", {
                email: owner.email,
                challenge_id: used.rows[0].id,
                code: "123456",
                password,
              })
            ).statusCode,
            400,
          );
          assert.equal(
            (await call("GET", "/api/admin/overview", undefined, owner))
              .statusCode,
            401,
          );
          const catalog = (
            await call("GET", "/api/catalog", undefined, owner, owner.personal)
          ).json();
          assert.equal(catalog.skills.length, SKILL_IDS.length);
          assert.equal(
            catalog.connections.filter((x) => x.kind === "model" && x.ready)
              .length,
            2,
          );
          const personal = (
            await call("GET", "/api/wallet", undefined, owner, owner.personal)
          ).json();
          assert.ok(personal.wallets.every((x) => x.available === "0"));
          assert.equal(personal.wallets.find((x) => x.currency === "ai_test_uses")?.available, "0");
        },
      );
      await t.test(
        "team activation is admin-only, atomic and idempotent with one shared wallet",
        async () => {
          const r = await call(
            "POST",
            "/api/teams",
            { name: "Fixture Team" },
            owner,
          );
          assert.equal(r.statusCode, 200, r.body);
          teamId = r.json().id;
          spaces.push(teamId);
          assert.equal(
            (
              await call(
                "POST",
                "/api/jobs",
                request(connectionIds[0]),
                owner,
                teamId,
              )
            ).json().error,
            "subscription_inactive",
          );
          const contract = {
            reference: "TEST-" + id(),
            kind: "trial",
            months: 1,
            seat_limit: 3,
            model_credit: "30",
            data_credit: 15,
            fee_cny: "0",
          };
          assert.equal(
            (
              await call(
                "POST",
                `/api/admin/workspaces/${teamId}/subscription`,
                contract,
                owner,
              )
            ).statusCode,
            401,
          );
          const results = await Promise.all([
            adminCall(
              "POST",
              `/api/admin/workspaces/${teamId}/subscription`,
              contract,
            ),
            adminCall(
              "POST",
              `/api/admin/workspaces/${teamId}/subscription`,
              contract,
            ),
          ]);
          assert.ok(
            results.every((x) => x.statusCode === 200),
            results.map((x) => x.body).join(),
          );
          assert.equal(results[0].json().id, results[1].json().id);
          const wallet = (
            await call("GET", "/api/wallet", undefined, owner, teamId)
          ).json();
          assert.equal(
            wallet.wallets.find((x) => x.currency === "model_micro_cny")
              .available,
            "30000000",
          );
          assert.equal(
            wallet.wallets.find((x) => x.currency === "data_points").available,
            "15",
          );
          assert.equal(
            (
              await adminCall(
                "POST",
                `/api/admin/workspaces/${teamId}/subscription`,
                { ...contract, seat_limit: 4 },
              )
            ).statusCode,
            409,
          );
          await assert.rejects(
            db.tenant(teamId, (c) =>
              c.query("UPDATE subscription_periods SET seat_limit=20"),
            ),
          );
        },
      );
      await t.test(
        "only registered accounts can join; roles and concurrent seat limits are enforced",
        async () => {
          const extra1 = await register("member-one"),
            extra2 = await register("member-two");
          assert.equal(
            (
              await call(
                "POST",
                "/api/team/members",
                { email: "unregistered@example.test" },
                owner,
                teamId,
              )
            ).json().error,
            "registered_member_required",
          );
          assert.equal(
            (
              await call(
                "POST",
                "/api/team/members",
                { email: teamAdmin.email, role: "admin" },
                owner,
                teamId,
              )
            ).statusCode,
            200,
          );
          assert.equal(
            (
              await call(
                "POST",
                "/api/team/members",
                { email: extra1.email, role: "admin" },
                teamAdmin,
                teamId,
              )
            ).statusCode,
            403,
          );
          const rs = await Promise.all([
            call(
              "POST",
              "/api/team/members",
              { email: extra1.email },
              teamAdmin,
              teamId,
            ),
            call(
              "POST",
              "/api/team/members",
              { email: extra2.email },
              teamAdmin,
              teamId,
            ),
          ]);
          assert.deepEqual(rs.map((x) => x.statusCode).sort(), [200, 409]);
          member = rs[0].statusCode === 200 ? extra1 : extra2;
          assert.equal(
            (
              await call(
                "POST",
                "/api/team/members",
                { email: owner.email },
                member,
                teamId,
              )
            ).statusCode,
            403,
          );
          assert.equal(
            (
              await call(
                "PATCH",
                `/api/team/members/${member.id}`,
                { role: "admin" },
                teamAdmin,
                teamId,
              )
            ).statusCode,
            403,
          );
          assert.equal(
            (
              await call(
                "DELETE",
                `/api/team/members/${owner.id}`,
                {},
                teamAdmin,
                teamId,
              )
            ).statusCode,
            409,
          );
          assert.equal(
            (
              await call(
                "GET",
                "/api/team",
                undefined,
                extra1 === member ? extra2 : extra1,
                teamId,
              )
            ).statusCode,
            403,
          );
        },
      );
      await t.test(
        "research and chat select models without per-job limits or whole-job reservations",
        async () => {
          assert.equal(
            (
              await call("POST", "/api/jobs", request(id()), member, teamId)
            ).json().error,
            "model_unavailable",
          );
          const a = request(connectionIds[0]),
            b = request(connectionIds[1]);
          const rs = await Promise.all([
            call("POST", "/api/jobs", a, owner, teamId),
            call("POST", "/api/jobs", b, member, teamId),
          ]);
          assert.ok(
            rs.every((x) => x.statusCode === 200),
            rs.map((x) => x.body).join(),
          );
          jobA = rs[0].json().id;
          jobB = rs[1].json().id;
          jobs.push(jobA, jobB);
          assert.equal(
            (await readJob(jobA)).snapshot.model.id,
            connectionIds[0],
          );
          assert.equal(
            (await readJob(jobB)).snapshot.model.id,
            connectionIds[1],
          );
          const wa = (
              await call("GET", "/api/wallet", undefined, owner, teamId)
            ).json(),
            wb = (
              await call("GET", "/api/wallet", undefined, member, teamId)
            ).json();
          assert.deepEqual(wa.wallets, wb.wallets);
          assert.equal(
            wa.wallets.find((x) => x.currency === "model_micro_cny").reserved,
            "0",
          );
          assert.equal(
            wa.wallets.find((x) => x.currency === "model_micro_cny").available,
            "30000000",
          );
          assert.equal(
            (await call("POST", "/api/jobs", a, owner, teamId)).json().id,
            jobA,
          );
          assert.equal(
            (
              await call(
                "POST",
                "/api/jobs",
                { ...a, model_connection_id: connectionIds[1] },
                owner,
                teamId,
              )
            ).statusCode,
            409,
          );
          assert.equal(
            (
              await call(
                "PUT",
                "/api/settings",
                { display_name: "Member", default_model_id: connectionIds[0] },
                member,
                teamId,
              )
            ).statusCode,
            200,
          );
          const conversation = await call(
            "POST",
            "/api/assistant/conversations",
            { id: id(), title: "Fixture chat", contexts: [] },
            member,
            teamId,
          );
          assert.equal(conversation.statusCode, 200, conversation.body);
          const chat = await call(
            "POST",
            `/api/assistant/conversations/${conversation.json().id}/messages`,
            {
              question: "只回答测试通过",
              context_version: 1,
              data_mode: "context_only",
              model_connection_id: connectionIds[1],
              idempotency_key: id(),
            },
            member,
            teamId,
          );
          assert.equal(chat.statusCode, 200, chat.body);
          jobs.push(chat.json().id);
          assert.equal(
            (await readJob(chat.json().id)).snapshot.model.id,
            connectionIds[1],
          );
          await call(
            "POST",
            `/api/jobs/${chat.json().id}/cancel`,
            {},
            member,
            teamId,
          );
          const preferredRequest = request(connectionIds[1]);
          delete preferredRequest.model_connection_id;
          const preferred = await call(
            "POST",
            "/api/jobs",
            preferredRequest,
            member,
            teamId,
          );
          assert.equal(preferred.statusCode, 200, preferred.body);
          jobs.push(preferred.json().id);
          assert.equal(
            (await readJob(preferred.json().id)).snapshot.model.id,
            connectionIds[0],
          );
          await call(
            "POST",
            `/api/jobs/${preferred.json().id}/cancel`,
            {},
            member,
            teamId,
          );
          await db.query("UPDATE connections SET enabled=false WHERE id=$1", [
            connectionIds[1],
          ]);
          try {
            assert.equal(
              (
                await call(
                  "POST",
                  "/api/jobs",
                  request(connectionIds[1]),
                  member,
                  teamId,
                )
              ).json().error,
              "model_unavailable",
            );
          } finally {
            await db.query("UPDATE connections SET enabled=true WHERE id=$1", [
              connectionIds[1],
            ]);
          }
        },
      );
      await t.test(
        "settings aggregate actual token usage and distinguish member usage from team totals",
        async () => {
          await db.tenant(teamId, (c) =>
            c.query(
              "UPDATE jobs SET status='running',fence=1,worker_id='account-test',lease_expires_at=now()+interval '5 minutes' WHERE id=$1",
              [jobA],
            ),
          );
          scope = {
            workspace_id: teamId,
            job_id: jobA,
            fence: "1",
            worker_id: "account-test",
          };
          const inv = await beginInvocation(
            db,
            scope,
            "model",
            "account-fixture",
            () => 2000n,
          );
          await settleInvocation(
            db,
            store,
            scope,
            inv.invocation,
            Buffer.from("{}"),
            {
              sale: 1000n,
              procurement: 700n,
              usage: {
                normalized: {
                  input_uncached: 900,
                  cache_read: 100,
                  output_total: 50,
                },
              },
            },
          );
          const data = (
            await call("GET", "/api/settings", undefined, member, teamId)
          ).json();
          assert.equal(data.usage.own.total_tokens, "0");
          assert.equal(data.usage.team.input_tokens, "1000");
          assert.equal(data.usage.team.total_tokens, "1050");
          assert.equal(data.usage.team.cached_tokens, "100");
          assert.equal(JSON.stringify(data).includes("procurement"), false);
          await db.tenant(teamId, async (c) =>
            finalizeJob(c, teamId, await readJob(jobA), "cancelled"),
          );
          await call("POST", `/api/jobs/${jobB}/cancel`, {}, member, teamId);
        },
      );
      await t.test(
        "selected model routes and frozen prices drive actual charges; balance summary is tenant scoped",
        async () => {
          const before = (await call("GET", "/api/wallet/summary", undefined, owner, teamId)).json();
          assert.equal(before.ledger, undefined);
          assert.equal(before.wallets.find((w) => w.currency === "data_points").available, "15");
          assert.deepEqual((await call("GET", "/api/wallet/summary", undefined, member, teamId)).json(), before);
          const personal = (await call("GET", "/api/wallet/summary", undefined, owner, owner.personal)).json();
          assert.ok(personal.wallets.every((w) => w.available === "0"));
          assert.equal((await call("GET", "/api/wallet/summary", undefined, member, owner.personal)).statusCode, 403);
          assert.equal((await call("GET", "/api/wallet/summary")).statusCode, 401);
          for (const [index, model] of connectionIds.slice(0, 2).entries()) {
            const made = await call("POST", "/api/jobs", request(model), owner, teamId);
            assert.equal(made.statusCode, 200, made.body);
            const jid = made.json().id;
            jobs.push(jid);
            await db.tenant(teamId, (c) => c.query("UPDATE jobs SET status='running',fence=1,worker_id='price-test',lease_expires_at=now()+interval '5 minutes' WHERE id=$1", [jid]));
            const frozen = await readJob(jid);
            const headers = { authorization: "Bearer " + signJob(workerKey, { workspace_id: teamId, job_id: jid, fence: 1, worker_id: "price-test", exp: Date.now() + 60000 }) };
            const response = await app.inject({ method: "POST", url: "/internal/job/v1/responses", headers,
              payload: { input: [{ role: "user", content: "fixture" }], tools: [], stream: false, max_output_tokens: 128 } });
            assert.equal(response.statusCode, 200, response.body);
            assert.equal(modelRequests.at(-1).model, frozen.snapshot.model.config.model);
            assert.equal((await readJob(jid)).model_spent, index === 0 ? "10605" : "21210");
            await db.tenant(teamId, async (c) => finalizeJob(c, teamId, await readJob(jid), "cancelled"));
          }
          const after = (await call("GET", "/api/wallet/summary", undefined, owner, teamId)).json();
          const modelWallet = (value) => value.wallets.find((w) => w.currency === "model_micro_cny");
          assert.equal(BigInt(modelWallet(before).available) - BigInt(modelWallet(after).available), 31815n);
          assert.equal(modelWallet(after).reserved, "0");
        },
      );
      await t.test(
        "membership revocation blocks sessions and already issued job scopes before new calls",
        async () => {
          const r = await call(
            "POST",
            "/api/jobs",
            request(connectionIds[0]),
            member,
            teamId,
          );
          assert.equal(r.statusCode, 200, r.body);
          const jid = r.json().id;
          jobs.push(jid);
          await db.tenant(teamId, (c) =>
            c.query(
              "UPDATE jobs SET status='running',fence=1,worker_id='account-test',lease_expires_at=now()+interval '5 minutes' WHERE id=$1",
              [jid],
            ),
          );
          assert.equal(
            (
              await call(
                "DELETE",
                `/api/team/members/${member.id}`,
                {},
                owner,
                teamId,
              )
            ).statusCode,
            200,
          );
          assert.equal(
            (await call("GET", "/api/team", undefined, member, teamId))
              .statusCode,
            403,
          );
          await assert.rejects(
            beginInvocation(
              db,
              { ...scope, job_id: jid },
              "model",
              "revoked",
              () => 1000n,
            ),
            (e) => e.code === "workspace_forbidden",
          );
          await db.tenant(teamId, async (c) => {
            const j = (await c.query("SELECT * FROM jobs WHERE id=$1", [jid]))
              .rows[0];
            await finalizeJob(c, teamId, j, "cancelled");
          });
        },
      );
      await t.test(
        "password reset invalidates old sessions and does not grant platform rights",
        async () => {
          const proof = await challenge(teamAdmin.email, "reset");
          const newPassword = password + "-new";
          assert.equal(
            (
              await call("POST", "/api/auth/reset", {
                ...proof,
                password: newPassword,
              })
            ).statusCode,
            200,
          );
          assert.equal(
            (await call("GET", "/api/auth/me", undefined, teamAdmin))
              .statusCode,
            401,
          );
          assert.equal(
            (
              await call("POST", "/api/auth/login", {
                login: teamAdmin.email,
                password,
                audience: "web",
              })
            ).statusCode,
            401,
          );
          teamAdmin = {
            ...teamAdmin,
            ...(await login(teamAdmin.email, newPassword)),
          };
          assert.equal(
            (await call("GET", "/api/admin/overview", undefined, teamAdmin))
              .statusCode,
            401,
          );
          assert.equal(
            (await call("POST", "/api/auth/reset", { ...proof, password }))
              .statusCode,
            400,
          );
        },
      );
      await t.test(
        "expired team keeps reports and balances but refuses new jobs and member additions",
        async () => {
          await db.tenant(teamId, async (c) => {
            const sid = id();
            await c.query(
              "INSERT INTO subscription_periods(id,workspace_id,actor_id,reference,kind,starts_at,ends_at,seat_limit,model_credit,data_credit,fee_micro_cny,terms) VALUES($1,$2,$3,$4,'trial',now()-interval '2 days',now()-interval '1 day',3,0,0,0,'{}')",
              [sid, teamId, adminId, "expired-" + id()],
            );
            await c.query(
              "UPDATE workspaces SET subscription_id=$2 WHERE id=$1",
              [teamId, sid],
            );
          });
          assert.equal(
            (
              await call(
                "POST",
                "/api/jobs",
                request(connectionIds[0]),
                owner,
                teamId,
              )
            ).json().error,
            "subscription_inactive",
          );
          assert.equal(
            (await call("GET", "/api/wallet", undefined, owner, teamId))
              .statusCode,
            200,
          );
          assert.equal(
            (
              await call(
                "POST",
                "/api/team/members",
                { email: member.email },
                owner,
                teamId,
              )
            ).json().error,
            "subscription_inactive",
          );
        },
      );
    } finally {
      for (const wid of spaces)
        await db
          .tenant(wid, async (c) => {
            for (const j of (
              await c.query(
                "SELECT * FROM jobs WHERE status IN ('queued','running','awaiting_connection')",
              )
            ).rows)
              await finalizeJob(c, wid, j, "cancelled");
          })
          .catch(() => {});
      if (app) await app.close();
      await db.query(
        "UPDATE workspaces SET enabled=false WHERE id=ANY($1::uuid[])",
        [spaces],
      );
      await db.query(
        "UPDATE users SET enabled=false WHERE id=ANY($1::uuid[])",
        [[adminId, ...users]],
      );
      await db.query(
        "UPDATE connections SET enabled=false,signup_default=false WHERE id=ANY($1::uuid[])",
        [connectionIds],
      );
      await db.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
