import { saveArtifact } from "../src/files/artifacts.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createDatabase } from "../src/infra/db.mjs";
import { buildApp } from "../src/server.mjs";
import { LocalStore, SecretStore } from "../src/infra/storage.mjs";
import { id, passwordHash, PriceSchema } from "../src/common/core.mjs";
import { tickMonitors } from "../src/monitoring/monitoring.mjs";
import { MonitorConfig } from "../src/monitoring/contract.mjs";
import { verifyJob, finalizeJob } from "../src/research/jobs.mjs";
import { beginInvocation, settleInvocation } from "../src/data/gateway.mjs";
import { monitorSources, monitorConfig } from "./fixtures/monitoring.mjs";

test(
  "monitoring lifecycle: tenant isolation, scheduling, budgets, archived evidence and deduplication",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const db = createDatabase(process.env.TEST_DATABASE_URL);
    const role = (
      await db.query(
        "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
      )
    ).rows[0];
    assert.deepEqual(
      role,
      { rolsuper: false, rolbypassrls: false },
      "Requires isolated non-bypass application role",
    );
    assert.equal(
      Number((await db.query("SELECT count(*) FROM dispatch")).rows[0].count),
      0,
      "Requires quiescent validation database",
    );
    const root = await mkdtemp(path.join(tmpdir(), "tidelab-monitor-test-"));
    const store = new LocalStore(root),
      secrets = new SecretStore(root, randomBytes(32)),
      workerKey = randomBytes(32);
    const ws = id(),
      other = id(),
      user = id(),
      otherUser = id(),
      password = "test-only-" + id();
    const origin = "http://127.0.0.1:4310",
      worker = "monitor-test-" + id().slice(0, 8);
    let app, auth, otherAuth, monitor, currentJob, jobToken, scope;
    const connections = [];
    const aliasKey = id();
    let baselineJob;
    const call = (method, url, payload, identity = auth, workspace = ws) =>
      app.inject({
        method,
        url,
        headers: {
          origin,
          "x-workspace-id": workspace,
          cookie: identity?.cookie || "",
          "x-csrf-token": identity?.csrf || "",
        },
        ...(payload === undefined ? {} : { payload }),
      });
    const internal = (url, payload) =>
      app.inject({
        method: "POST",
        url,
        headers: { authorization: `Bearer ${jobToken}` },
        payload,
      });
    async function jobRow(jobId = currentJob) {
      return db.tenant(
        ws,
        async (c) =>
          (await c.query("SELECT * FROM jobs WHERE id=$1", [jobId])).rows[0],
      );
    }
    async function claim() {
      const r = await app.inject({
        method: "POST",
        url: "/internal/worker/claim",
        headers: { authorization: `Bearer ${workerKey.toString("base64url")}` },
        payload: { worker_id: worker },
      });
      assert.equal(r.statusCode, 200, r.body);
      const body = r.json();
      assert.ok(body.job, r.body);
      jobToken = body.job_token;
      scope = verifyJob(workerKey, jobToken);
      currentJob = body.job.id;
      return body.job;
    }
    async function archiveSources(when = new Date().toISOString(), products) {
      const sources = monitorSources(when, products);
      for (const source of sources.values()) {
        const prepared = await beginInvocation(
          db,
          scope,
          "data",
          source.tool,
          () => 10n,
        );
        source.invocation_id = prepared.invocation.id;
        await settleInvocation(
          db,
          store,
          scope,
          prepared.invocation,
          Buffer.from(JSON.stringify(source)),
          { sale: 10n, procurement: 0n, usage: { test_only: true } },
        );
      }
    }
    try {
      const encoded = await passwordHash(password);
      await db.tx(null, async (c) => {
        for (const [wid, uid] of [
          [ws, user],
          [other, otherUser],
        ]) {
          await c.query(
            "INSERT INTO workspaces(id,name) VALUES($1,'monitor validation')",
            [wid],
          );
          await c.query(
            "INSERT INTO users(id,login,password_hash,display_name) VALUES($1,$2,$3,'monitor test')",
            [uid, uid, encoded],
          );
          await c.query(
            "INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,'owner')",
            [wid, uid],
          );
        }
        for (const kind of ["model", "fastmoss"]) {
          const cid = id(),
            vid = id();
          connections.push(cid);
          await c.query(
            "INSERT INTO connections(id,name,kind,enabled) VALUES($1,'monitor-test',$2,true)",
            [cid, kind],
          );
          await c.query(
            "INSERT INTO connection_versions(id,connection_id,config,secret_ref,verified) VALUES($1,$2,$3,'never-used',true)",
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
            [ws, cid],
          );
          if (kind === "model")
            await c.query(
              "INSERT INTO price_cards(id,connection_id,name,data,active) VALUES($1,$2,'test',$3,true)",
              [
                id(),
                cid,
                PriceSchema.parse({
                  currency: "CNY",
                  fx: "1",
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
                }),
              ],
            );
        }
      });
      await db.tenant(ws, async (c) => {
        await c.query(
          "INSERT INTO wallets(workspace_id,currency,available) VALUES($1,'model_micro_cny',100000000),($1,'data_points',10000)",
          [ws],
        );
      });
      app = await buildApp({
        db,
        store,
        secrets,
        workerKey,
        publicOrigin: origin,
        projectRoot: path.resolve(".."),
      });
      await app.ready();
      async function login(uid) {
        const r = await call(
          "POST",
          "/api/auth/login",
          { login: uid, password, audience: "web" },
          null,
        );
        assert.equal(r.statusCode, 200, r.body);
        return {
          cookie: r.cookies.map((x) => `${x.name}=${x.value}`).join("; "),
          csrf: r.cookies.find((x) => x.name.endsWith("_csrf")).value,
        };
      }
      auth = await login(user);
      otherAuth = await login(otherUser);
      await t.test(
        "creating a monitor provisions its versioned skill and isolates tenant reads/writes",
        async () => {
          const r = await call("POST", "/api/monitors", {
            ...monitorConfig,
            name: "竞店测试",
            config: { ai_enabled: false },
          });
          assert.equal(r.statusCode, 200, r.body);
          monitor = r.json().id;
          assert.equal(
            (
              await call("POST", "/api/monitors", {
                ...monitorConfig,
                name: "重复",
              })
            ).json().error,
            "monitor_duplicate",
          );
          assert.equal(
            (
              await call("GET", "/api/monitors", undefined, otherAuth, other)
            ).json().items.length,
            0,
          );
          assert.equal(
            (
              await call(
                "GET",
                `/api/monitors/${monitor}`,
                undefined,
                otherAuth,
                other,
              )
            ).statusCode,
            404,
          );
          assert.equal(
            (
              await call(
                "POST",
                `/api/monitors/${monitor}/run`,
                { idempotency_key: id() },
                otherAuth,
                other,
              )
            ).statusCode,
            404,
          );
          assert.equal(
            (
              await db.tenant(ws, (c) =>
                c.query(
                  "SELECT * FROM skill_bindings WHERE skill_id='tiktok-competitor-monitoring'",
                ),
              )
            ).rowCount,
            1,
          );
        },
      );
      await t.test(
        "concurrent schedulers queue exactly one reserved job; manual calls share it",
        async () => {
          await Promise.all(Array.from({ length: 6 }, () => tickMonitors(db)));
          const runs = (await call("GET", `/api/monitors/${monitor}`)).json()
            .runs;
          assert.equal(runs.length, 1);
          currentJob = runs[0].job_id;
          baselineJob = currentJob;
          const r = await call("POST", `/api/monitors/${monitor}/run`, {
            idempotency_key: aliasKey,
          });
          assert.equal(r.json().job.id, currentJob);
          assert.equal(r.json().reused, true);
          const j = await jobRow();
          assert.equal(j.kind, "monitoring");
          assert.equal(j.billing_mode, "job_reservation");
          assert.equal(j.data_budget, "30");
          const w = await db.tenant(
            ws,
            async (c) =>
              (
                await c.query(
                  "SELECT reserved FROM wallets WHERE currency='data_points'",
                )
              ).rows[0],
          );
          assert.equal(w.reserved, "30");
          assert.equal(
            (
              await call("POST", "/api/jobs", {
                kind: "monitoring",
                title: "invalid",
                request: {},
                idempotency_key: id(),
              })
            ).json().error,
            "monitor_context_required",
          );
        },
      );
      await t.test(
        "worker claims frozen skill, tool scope is bounded, and pause stops later scheduling",
        async () => {
          const j = await claim();
          assert.equal(
            j.snapshot.skill.skill_id,
            "tiktok-competitor-monitoring",
          );
          assert.equal(
            (
              await call("PUT", `/api/monitors/${monitor}`, {
                name: "locked",
                version: 1,
                config: MonitorConfig.parse({}),
              })
            ).json().error,
            "monitor_running",
          );
          const forbidden = await internal("/internal/job/data", {
            name: "shop_creator_analysis",
            arguments: { filter: { seller_id: monitorConfig.seller_id } },
          });
          assert.equal(forbidden.statusCode, 403, forbidden.body);
          assert.equal(
            (
              await call("POST", `/api/monitors/${monitor}/status`, {
                status: "paused",
              })
            ).statusCode,
            200,
          );
          await tickMonitors(db);
          assert.equal(
            (
              await db.query(
                "SELECT 1 FROM monitor_schedule WHERE monitor_id=$1",
                [monitor],
              )
            ).rowCount,
            0,
          );
        },
      );
      await t.test(
        "archived baseline creates a report, charges exactly three calls and releases unused model budget",
        async () => {
          await archiveSources();
          const r = await internal("/internal/job/finish", {});
          assert.equal(r.statusCode, 200, r.body);
          assert.equal(r.json().status, "succeeded");
          assert.ok(r.json().result.report_id);
          assert.equal(r.json().data_spent, "30");
          const detail = (await call("GET", `/api/monitors/${monitor}`)).json();
          assert.equal(detail.runs[0].snapshot.identity_valid, true);
          assert.equal(detail.runs[0].data_spent, "3");
          assert.equal(
            (await call("GET", "/api/monitors/events")).json().items.length,
            0,
          );
          const wallets = await db.tenant(
            ws,
            async (c) =>
              (await c.query("SELECT * FROM wallets ORDER BY currency")).rows,
          );
          assert.ok(wallets.every((x) => x.reserved === "0"));
          assert.equal(
            wallets.find((x) => x.currency === "data_points").available,
            "9970",
          );
          assert.equal(
            wallets.find((x) => x.currency === "model_micro_cny").available,
            "100000000",
          );
          const aliasReplay = (
            await call("POST", `/api/monitors/${monitor}/run`, {
              idempotency_key: aliasKey,
            })
          ).json();
          assert.equal(aliasReplay.job.id, baselineJob);
          assert.equal(aliasReplay.job.status, "succeeded");
        },
      );
      await t.test(
        "subsequent product events are server-derived, tenant private and idempotently marked read",
        async () => {
          const r = await call("POST", `/api/monitors/${monitor}/run`, {
            idempotency_key: id(),
          });
          assert.equal(r.statusCode, 200, r.body);
          await claim();
          await archiveSources(new Date().toISOString(), ["2"]);
          const forged = {
            status: "complete",
            summary: "invented growth",
            sections: [
              {
                title: "虚构",
                body: "销量一百万",
                kind: "observed",
                evidence_ids: [],
              },
            ],
            candidates: [],
            questions: [],
            limitations: [],
            next_actions: [],
          };
          const finish = await internal("/internal/job/finish", {
            result: forged,
          });
          assert.equal(finish.statusCode, 200, finish.body);
          assert.ok(!JSON.stringify(finish.json().result).includes("一百万"));
          const events = (await call("GET", "/api/monitors/events")).json()
            .items;
          assert.equal(events.length, 1);
          assert.equal(events[0].kind, "product");
          assert.equal(
            (
              await call(
                "GET",
                "/api/monitors/events",
                undefined,
                otherAuth,
                other,
              )
            ).json().items.length,
            0,
          );
          assert.equal(
            (
              await call(
                "POST",
                `/api/monitors/events/${events[0].id}/read`,
                {},
                otherAuth,
                other,
              )
            ).statusCode,
            404,
          );
          const first = (
            await call("POST", `/api/monitors/events/${events[0].id}/read`, {})
          ).json();
          const again = (
            await call("POST", `/api/monitors/events/${events[0].id}/read`, {})
          ).json();
          assert.equal(first.read_at, again.read_at);
          assert.equal(
            (
              await call(
                "GET",
                "/api/records?kind=report&research_scope=monitoring",
              )
            ).json().items.length,
            2,
          );
          assert.equal(
            (
              await call(
                "GET",
                "/api/records?kind=report&research_scope=specialist",
              )
            ).json().items.length,
            0,
          );
        },
      );
      await t.test(
        "monthly limits include prior manual runs; a blocked scheduler leaves no reservation",
        async () => {
          const config = MonitorConfig.parse({
            monthly_data_budget: 6,
            ai_enabled: false,
          });
          assert.equal(
            (
              await call("PUT", `/api/monitors/${monitor}`, {
                name: "限额",
                version: 1,
                config,
              })
            ).statusCode,
            200,
          );
          const r = await call("POST", `/api/monitors/${monitor}/run`, {
            idempotency_key: id(),
          });
          assert.equal(r.json().error, "monitor_monthly_data_budget");
          await call("POST", `/api/monitors/${monitor}/status`, {
            status: "active",
          });
          await tickMonitors(db);
          const list = (await call("GET", "/api/monitors")).json().items;
          assert.equal(list[0].last_error, "monitor_monthly_data_budget");
          assert.ok(Date.parse(list[0].next_run_at) > Date.now() + 3500000);
          assert.equal(
            (await call("GET", `/api/monitors/${monitor}`)).json().runs.length,
            2,
          );
        },
      );
      await t.test(
        "manual idempotency survives completion; cancel returns all unused reservation",
        async () => {
          await call("POST", `/api/monitors/${monitor}/status`, {
            status: "paused",
          });
          await call("PUT", `/api/monitors/${monitor}`, {
            name: "取消测试",
            version: 2,
            config: MonitorConfig.parse({ ai_enabled: false }),
          });
          const key = id();
          const initial = (
            await call("POST", `/api/monitors/${monitor}/run`, {
              idempotency_key: key,
            })
          ).json();
          currentJob = initial.job.id;
          const cancel = await call(
            "POST",
            `/api/jobs/${currentJob}/cancel`,
            {},
          );
          assert.equal(cancel.statusCode, 200, cancel.body);
          const replay = (
            await call("POST", `/api/monitors/${monitor}/run`, {
              idempotency_key: key,
            })
          ).json();
          assert.equal(replay.job.id, currentJob);
          assert.equal(replay.job.status, "cancelled");
          assert.equal(
            (
              await db.tenant(ws, (c) =>
                c.query("SELECT * FROM wallets WHERE reserved<>0"),
              )
            ).rowCount,
            0,
          );
        },
      );
      await t.test(
        "scouting candidates add a shop once, preserve paused rules, and reject missing or cross-tenant identities",
        async () => {
          const reportId = id(),
            sourceJob = id(),
            sourceId = id();
          const sellerId = "7494103726733493678";
          const facts = {
            shop_id: {
              value: sellerId,
              invocation_id: sourceId,
              pointer: "/decoded/0/data/shop/shop_id",
            },
            shop_name: { value: "选品店铺测试", invocation_id: sourceId },
            region: { value: "US", invocation_id: sourceId },
          };
          await db.tenant(ws, async (c) => {
            await c.query(
              "INSERT INTO jobs(id,workspace_id,created_by,kind,title,request,status,idempotency_key) VALUES($1,$2,$3,'scouting','shop fixture',$4,'succeeded',$5)",
              [sourceJob, ws, user, { market: "US" }, sourceJob],
            );
            const artifact = await saveArtifact(
              c,
              store,
              ws,
              Buffer.from(
                JSON.stringify([
                  {
                    product_id: "product-one",
                    title: "A",
                    assessment: { facts },
                  },
                  {
                    product_id: "product-two",
                    title: "B",
                    assessment: { facts },
                  },
                  {
                    product_id: "missing-shop",
                    title: "C",
                    shop_id: "should-not-be-used",
                  },
                ]),
              ),
              { name: "shop-candidates.json", kind: "candidates" },
            );
            await c.query(
              "INSERT INTO records(id,workspace_id,created_by,kind,data) VALUES($1,$2,$3,'report',$4)",
              [
                reportId,
                ws,
                user,
                {
                  job_id: sourceJob,
                  research_kind: "scouting",
                  candidates_artifact_id: artifact.id,
                },
              ],
            );
          });
          const route = (product) =>
            `/api/reports/${reportId}/candidates/${product}/monitor`;
          const listed = await call(
            "GET",
            `/api/reports/${reportId}/candidates`,
          );
          assert.equal(listed.statusCode, 200, listed.body);
          assert.deepEqual(listed.json().items[0].monitor_target, {
            seller_id: sellerId,
            market: "US",
            name: "选品店铺测试",
          });
          assert.equal(listed.json().items[2].monitor_target, null);
          assert.equal(
            (await call("POST", route("product-one"), {}, otherAuth, other))
              .statusCode,
            404,
          );
          assert.equal(
            (
              await call(
                "GET",
                `/api/reports/${reportId}/candidates`,
                undefined,
                otherAuth,
                other,
              )
            ).statusCode,
            404,
          );
          assert.equal(
            (await call("POST", route("missing-shop"), {})).json().error,
            "candidate_shop_missing",
          );
          assert.equal(
            (await call("POST", route("no-product"), {})).statusCode,
            404,
          );
          assert.equal(
            (await call("POST", route("product-one"), { seller_id: "123" }))
              .statusCode,
            400,
          );
          const created = await Promise.all(
            ["product-one", "product-two", "product-one"].map((p) =>
              call("POST", route(p), {}),
            ),
          );
          for (const response of created)
            assert.equal(response.statusCode, 200, response.body);
          const rows = created.map((r) => r.json()),
            monitorId = rows[0].id;
          assert.equal(new Set(rows.map((r) => r.id)).size, 1);
          assert.equal(rows.filter((r) => !r.reused).length, 1);
          const detail = (
            await call("GET", `/api/monitors/${monitorId}`)
          ).json();
          assert.equal(detail.item.seller_id, sellerId);
          assert.deepEqual(detail.item.config, MonitorConfig.parse({}));
          assert.equal(detail.item.status, "active");
          assert.equal(
            detail.runs.length,
            0,
            "adding uses saved candidate evidence without buying data",
          );
          assert.equal(
            (
              await db.tenant(ws, (c) =>
                c.query("SELECT * FROM monitor_schedule WHERE monitor_id=$1", [
                  monitorId,
                ]),
              )
            ).rowCount,
            1,
          );
          await call("POST", `/api/monitors/${monitorId}/status`, {
            status: "paused",
          });
          const config = MonitorConfig.parse({
            interval_hours: 12,
            rules: { percent: 45 },
            ai_enabled: false,
          });
          const edited = await call("PUT", `/api/monitors/${monitorId}`, {
            name: "保留我的规则",
            version: detail.item.version,
            config,
          });
          assert.equal(edited.statusCode, 200, edited.body);
          const reused = await call("POST", route("product-two"), {});
          assert.equal(reused.json().id, monitorId);
          assert.equal(reused.json().reused, true);
          assert.equal(reused.json().status, "paused");
          const after = (
            await call("GET", `/api/monitors/${monitorId}`)
          ).json();
          assert.equal(after.item.name, "保留我的规则");
          assert.deepEqual(after.item.config, config);
          assert.equal(
            (
              await db.tenant(ws, (c) =>
                c.query("SELECT * FROM monitor_schedule WHERE monitor_id=$1", [
                  monitorId,
                ]),
              )
            ).rowCount,
            0,
          );
          await call("POST", `/api/monitors/${monitorId}/status`, {
            status: "archived",
          });
          const next = await call("POST", route("product-one"), {});
          assert.equal(next.statusCode, 200, next.body);
          assert.notEqual(next.json().id, monitorId);
          assert.equal(next.json().reused, false);
          await call("POST", `/api/monitors/${next.json().id}/status`, {
            status: "paused",
          });
        },
      );
      await t.test(
        "deleting monitoring removes future scheduling but preserves reports, billing and submitted jobs",
        async () => {
          const forbidden = await call(
            "POST",
            `/api/monitors/${monitor}/status`,
            { status: "archived" },
            otherAuth,
            other,
          );
          assert.equal(forbidden.statusCode, 404, forbidden.body);
          await call("POST", `/api/monitors/${monitor}/status`, {
            status: "active",
          });
          const submitted = await call("POST", `/api/monitors/${monitor}/run`, {
            idempotency_key: id(),
          });
          assert.equal(submitted.statusCode, 200, submitted.body);
          const pendingId = submitted.json().job.id;
          const pendingBefore = await jobRow(pendingId);
          const before = (await call("GET", `/api/monitors/${monitor}`)).json();
          assert.ok(before.runs.some((run) => run.snapshot && run.report_id));
          const history = async () => ({
            reports: (
              await call(
                "GET",
                "/api/records?kind=report&research_scope=monitoring",
              )
            ).json(),
            events: (await call("GET", "/api/monitors/events")).json(),
            ledger: await db.tenant(
              ws,
              async (c) =>
                (await c.query("SELECT * FROM ledger ORDER BY id")).rows,
            ),
          });
          const historyBefore = await history();
          const deleted = await call(
            "POST",
            `/api/monitors/${monitor}/status`,
            {
              status: "archived",
            },
          );
          assert.equal(deleted.statusCode, 200, deleted.body);
          assert.ok(
            !(await call("GET", "/api/monitors"))
              .json()
              .items.some((m) => m.id === monitor),
          );
          assert.equal(
            (
              await db.tenant(ws, (c) =>
                c.query("SELECT 1 FROM monitor_schedule WHERE monitor_id=$1", [
                  monitor,
                ]),
              )
            ).rowCount,
            0,
          );
          await tickMonitors(db);
          const after = (await call("GET", `/api/monitors/${monitor}`)).json();
          assert.equal(after.item.status, "archived");
          assert.deepEqual(after.runs, before.runs);
          assert.deepEqual(after.usage, before.usage);
          assert.deepEqual(await history(), historyBefore);
          assert.deepEqual(await jobRow(pendingId), pendingBefore);
          for (const [method, suffix, payload] of [
            ["POST", "/run", { idempotency_key: id() }],
            ["POST", "/status", { status: "active" }],
            [
              "PUT",
              "",
              {
                version: before.item.version,
                name: before.item.name,
                config: before.item.config,
              },
            ],
          ]) {
            const response = await call(
              method,
              `/api/monitors/${monitor}${suffix}`,
              payload,
            );
            assert.equal(response.statusCode, 409, response.body);
            assert.equal(response.json().error, "monitor_archived");
          }
        },
      );
    } finally {
      await db.tenant(ws, async (c) => {
        await c.query("DELETE FROM monitor_schedule WHERE workspace_id=$1", [
          ws,
        ]);
        await c.query(
          "UPDATE shop_monitors SET status='archived' WHERE workspace_id=$1",
          [ws],
        );
        for (const j of (
          await c.query(
            "SELECT * FROM jobs WHERE kind='monitoring' AND status NOT IN ('succeeded','partial','failed','cancelled') FOR UPDATE",
          )
        ).rows)
          if (BigInt(j.model_inflight) === 0n && BigInt(j.data_inflight) === 0n)
            await finalizeJob(c, ws, j, "cancelled");
      });
      await db.query("DELETE FROM worker_nodes WHERE id=$1", [worker]);
      await db.query(
        "UPDATE workspaces SET enabled=false WHERE id=ANY($1::uuid[])",
        [[ws, other]],
      );
      if (connections.length)
        await db.query(
          "UPDATE connections SET enabled=false WHERE id=ANY($1::uuid[])",
          [connections],
        );
      await app?.close();
      await db.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
