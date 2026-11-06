import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { createDatabase } from "../src/infra/db.mjs";
import { LocalStore, SecretStore } from "../src/infra/storage.mjs";
import { buildApp } from "../src/server.mjs";
import { id, digest } from "../src/common/core.mjs";
import { ensureDefaultSkill } from "../src/skills/skills.mjs";
import { saveArtifact } from "../src/files/artifacts.mjs";
import { supplementAmazonDaily } from "../scripts/supplement-amazon-daily.mjs";
test(
  "daily supplement purchases once through gateway, preserves original job and tenant boundaries, rerenders safely",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const db = createDatabase(process.env.TEST_DATABASE_URL),
      root = await mkdtemp(path.join(tmpdir(), "tidelab-daily-")),
      store = new LocalStore(root),
      secrets = new SecretStore(root, randomBytes(32)),
      workerKey = randomBytes(32);
    const workspace = id(),
      other = id(),
      actor = id(),
      original = id(),
      reportId = id(),
      asin = "B012345678";
    let app,
      calls = 0;
    const date = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    try {
      await db.tx(null, async (c) => {
        for (const w of [workspace, other])
          await c.query("INSERT INTO workspaces(id,name) VALUES($1,$2)", [
            w,
            "daily validation",
          ]);
        await c.query(
          "INSERT INTO users(id,login,password_hash,display_name) VALUES($1,$2,$3,$4)",
          [actor, "daily-" + actor, "unused-fixture", "Daily QA"],
        );
        for (const kind of ["model", "sellersprite"]) {
          const cid = id(),
            vid = id(),
            secret = await secrets.write("fixture", `${cid}:${vid}`);
          const tools = [
            { name: "product_research", inputSchema: { type: "object" } },
            {
              name: "asin_prediction",
              inputSchema: {
                type: "object",
                properties: {
                  asin: { type: "string" },
                  marketplace: { type: "string" },
                },
                required: ["asin", "marketplace"],
                additionalProperties: false,
              },
            },
          ];
          await c.query(
            "INSERT INTO connections(id,name,kind) VALUES($1,$2,$3)",
            [cid, "daily fixture", kind],
          );
          await c.query(
            "INSERT INTO connection_versions(id,connection_id,config,secret_ref,verified,validation) VALUES($1,$2,$3,$4,true,$5)",
            [
              vid,
              cid,
              {
                endpoint: "https://daily-fixture.invalid/mcp",
                protocol: "mcp",
              },
              secret,
              { tools },
            ],
          );
          await c.query(
            "UPDATE connections SET active_version_id=$2,enabled=true WHERE id=$1",
            [cid, vid],
          );
          await c.query(
            "INSERT INTO workspace_connections(workspace_id,connection_id) VALUES($1,$2)",
            [workspace, cid],
          );
          if (kind === "model")
            await c.query(
              "INSERT INTO price_cards(id,connection_id,name,data,active) VALUES($1,$2,'fixture','{}',true)",
              [id(), cid],
            );
        }
      });
      await db.tenant(workspace, async (c) => {
        await c.query(
          "INSERT INTO memberships(user_id,workspace_id,role) VALUES($1,$2,'owner')",
          [actor, workspace],
        );
        await c.query(
          "INSERT INTO wallets(workspace_id,currency,available) VALUES($1,'data_points',100)",
          [workspace],
        );
        await ensureDefaultSkill(
          c,
          store,
          path.resolve(".."),
          workspace,
          "amazon-product-scouting",
        );
        const result = {
          status: "partial",
          summary: "original",
          candidates: [
            {
              product_id: asin,
              title: "Fixture",
              decision: "watch",
              reason: "research",
              limitations: [],
              evidence: [],
            },
          ],
          sections: [],
          limitations: [],
          questions: [],
          next_actions: [],
        };
        await c.query(
          "INSERT INTO jobs(id,workspace_id,created_by,kind,title,request,snapshot,status,idempotency_key,result,billing_mode) VALUES($1,$2,$3,'scouting','original',$4,$5,'partial',$6,$7,'wallet_per_call')",
          [
            original,
            workspace,
            actor,
            {
              platform: "amazon",
              market: "US",
              candidate_count: 1,
              lookback_days: 30,
            },
            { created_at: new Date().toISOString(), skill: { version: 1 } },
            id(),
            result,
          ],
        );
        const artifact = await saveArtifact(
          c,
          store,
          workspace,
          Buffer.from("old"),
          { name: "old.html", kind: "report" },
        );
        await c.query(
          "INSERT INTO records(id,workspace_id,kind,data,created_by) VALUES($1,$2,'report',$3,$4)",
          [
            reportId,
            workspace,
            {
              platform: "amazon",
              market: "US",
              source_kind: "sellersprite_agent_research",
              job_id: original,
              artifact_id: artifact.id,
            },
            actor,
          ],
        );
      });
      app = await buildApp({
        db,
        store,
        secrets,
        workerKey,
        publicOrigin: "http://127.0.0.1:4310",
        projectRoot: path.resolve(".."),
        gatewayOverrides: {
          dataRpc: async (_e, _s, _m, v, { onResponse }) => {
            calls++;
            assert.equal(v.name, "asin_prediction");
            assert.deepEqual(v.arguments, { marketplace: "US", asin });
            const result = {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    code: "OK",
                    data: {
                      asinDetail: { asin, title: "Fixture" },
                      dailyItemList: [{ date, sales: 123 }],
                    },
                  }),
                },
              ],
            };
            await onResponse({
              status: 200,
              raw: JSON.stringify({ jsonrpc: "2.0", id: 3, result }),
            });
            return result;
          },
        },
      });
      await app.ready();
      const opts = {
        workspace,
        reportId,
        asin,
        operationKey: "daily-" + reportId,
        workerKey,
        callData: async (token, payload) => {
          const r = await app.inject({
            method: "POST",
            url: "/internal/job/data",
            headers: { authorization: `Bearer ${token}` },
            payload,
          });
          assert.equal(r.statusCode, 200, r.body);
          return r.json();
        },
      };
      const readOriginal = () =>
        db.tenant(workspace, async (c) =>
          digest(
            (await c.query("SELECT * FROM jobs WHERE id=$1", [original]))
              .rows[0],
          ),
        );
      const before = await readOriginal(),
        first = await supplementAmazonDaily(db, store, opts);
      assert.equal(first.supplement.data_spent, "10");
      assert.equal(first.supplement.model_spent, "0");
      assert.equal(first.supplement.result.coverage, 1);
      assert.equal(before, await readOriginal());
      const repeat = await supplementAmazonDaily(db, store, opts);
      assert.equal(calls, 1);
      assert.equal(first.supplement.id, repeat.supplement.id);
      await assert.rejects(
        supplementAmazonDaily(db, store, { ...opts, workspace: other }),
        { code: "amazon_report_required" },
      );
      await assert.rejects(
        supplementAmazonDaily(db, store, { ...opts, asin: "B999999999" }),
        { code: "daily_candidate_not_in_report" },
      );
      await db.tenant(workspace, async (c) => {
        const artifact = (
          await c.query("SELECT * FROM artifacts WHERE id=$1", [
            repeat.artifact_id,
          ])
        ).rows[0];
        const html = (
          await store.read(artifact.object_key, artifact.sha256)
        ).toString();
        assert.match(html, /每日销量对比 · 供应商估算/);
        assert.match(html, /123 件/);
        assert.match(html, /每日销量单独补查/);
        assert.equal(
          (
            await c.query(
              "SELECT available FROM wallets WHERE currency='data_points'",
            )
          ).rows[0].available,
          "90",
        );
      });
    } finally {
      await app?.close();
      await db.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
