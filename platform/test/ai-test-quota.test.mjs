import test from "node:test";
import assert from "node:assert/strict";
import { id } from "../src/common/core.mjs";
import { aiFixture } from "./fixtures/ai-testing.mjs";
import { utcMonth } from "../src/ai-testing/pool.mjs";

test(
  "AI test uses: admin allocation, atomic billing and recoverable drafts",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const f = await aiFixture({ testUses: 0 });
    try {
      const wallet = async () =>
        (await f.ok("/api/wallet/summary")).wallets.find(
          (w) => w.currency === "ai_test_uses",
        );
      const run = async (rid) =>
        (await f.ok("/api/ai-tests")).runs.find((r) => r.id === rid);
      const ledger = async (rid) =>
        (await f.ok("/api/wallet")).ledger.filter(
          (r) => r.currency === "ai_test_uses" && r.reference === rid,
        );
      const creditPath = `/api/admin/workspaces/${f.workspace}/credit`;
      const credit = (amount, reference = id()) => ({
        currency: "ai_test_uses",
        amount,
        reference,
        reason: "本地次数测试",
        type: "sponsored_test",
      });
      async function resetProvider() {
        await f.db.query(
          "UPDATE ai_test_accounts SET state='ready',enabled=true,trial_used=0,monthly_used=0,quota_month=$2 WHERE id=ANY($1::uuid[])",
          [f.accounts, utcMonth()],
        );
        f.behavior.exhaust.clear();
        f.behavior.usedByKey.clear();
        f.behavior.complete = true;
        f.behavior.cancelBillable = false;
        f.behavior.throwCreate = 0;
      }
      async function prepare(name = "次数校验") {
        let d = await f.ok("/api/ai-tests", {});
        d.data.name = name;
        Object.assign(d.data.arms[0].product, {
          name: "Bamboo rack",
          use: "Storage",
        });
        d.data.arms[0].pricing.current_price = 29.99;
        d.data.arms[0].url = f.candidates[0].tk_url;
        d.data.arms[0].product_id = f.candidates[0].product_id;
        d = await f.ok(
          `/api/ai-tests/${d.id}`,
          { version: d.version, data: d.data },
          "PUT",
        );
        for (const arm of ["A", "B"])
          d = await f.ok(`/api/ai-tests/${d.id}/image`, {
            version: d.version,
            arm,
            data: f.png.toString("base64"),
          });
        const r = await f.ok(`/api/ai-tests/${d.id}/review`);
        return {
          d,
          url: `/api/ai-tests/${d.id}/submit`,
          body: { version: r.version, digest: r.digest, confirmed: true },
        };
      }
      await t.test(
        "zero balance rejects atomically without provider calls; only admin can allocate integer uses once",
        async () => {
          const x = await prepare(),
            calls = f.calls.length;
          const response = await f.request(x.url, x.body);
          assert.equal(response.json().error, "insufficient_ai_test_uses");
          assert.equal(f.calls.length, calls);
          assert.equal((await f.ok("/api/ai-tests")).runs.length, 0);
          assert.equal(
            (
              await f.db.query(
                "SELECT 1 FROM ai_test_reservations WHERE workspace_id=$1",
                [f.workspace],
              )
            ).rowCount,
            0,
          );
          assert.equal((await wallet()).reserved, "0");
          assert.equal(
            (await f.request(creditPath, credit("1"))).statusCode,
            401,
          );
          for (const amount of ["0", "1.5", "1000001"])
            assert.equal(
              (await f.request(creditPath, credit(amount), "POST", f.adminAuth))
                .statusCode,
              400,
            );
          const grant = credit("1");
          const replies = await Promise.all([
            f.ok(creditPath, grant, "POST", f.adminAuth),
            f.ok(creditPath, grant, "POST", f.adminAuth),
          ]);
          assert.equal(replies.filter((r) => r.duplicate).length, 1);
          assert.equal((await wallet()).available, "1");
        },
      );
      await t.test(
        "two distinct concurrent submissions cannot spend the same use; queued cancellation refunds",
        async () => {
          const xs = await Promise.all([prepare("并发 A"), prepare("并发 B")]);
          const replies = await Promise.all(
            xs.map((x) => f.request(x.url, x.body)),
          );
          assert.equal(replies.filter((r) => r.statusCode === 200).length, 1);
          assert.equal(
            replies.filter(
              (r) => r.json().error === "insufficient_ai_test_uses",
            ).length,
            1,
          );
          const r = replies.find((r) => r.statusCode === 200).json();
          assert.equal(r.quota_state, "reserved");
          assert.equal((await wallet()).available, "0");
          assert.equal((await wallet()).reserved, "1");
          const active = xs.find((x) => x.d.id === r.draft_id);
          assert.equal(
            (
              await f.request(`/api/ai-tests/${active.d.id}/archive`, {
                version: active.d.version,
              })
            ).json().error,
            "ai_draft_busy",
          );
          await f.ok(`/api/ai-tests/runs/${r.id}/cancel`, {});
          await f.tick();
          assert.equal((await run(r.id)).quota_state, "released");
          assert.equal((await wallet()).available, "1");
          assert.deepEqual(
            (await ledger(r.id)).map((x) => x.operation).sort(),
            ["release", "reserve"],
          );
          assert.ok(!f.calls.some((x) => x.action === "create"));
        },
      );
      let completed;
      await t.test(
        "provider switch and duplicate submit charge exactly one use after successful result",
        async () => {
          await resetProvider();
          const x = await prepare();
          f.behavior.exhaust.add(f.first.key);
          const [a, b] = await Promise.all([
            f.ok(x.url, x.body),
            f.ok(x.url, x.body),
          ]);
          assert.equal(a.id, b.id);
          await f.tick();
          assert.equal((await wallet()).reserved, "1");
          await f.tick();
          assert.equal((await run(a.id)).status, "completed");
          assert.equal((await run(a.id)).quota_state, "charged");
          await f.ok(x.url, x.body);
          await f.tick();
          assert.equal((await wallet()).available, "0");
          assert.equal((await wallet()).reserved, "0");
          const entries = await ledger(a.id);
          assert.deepEqual(entries.map((x) => x.operation).sort(), [
            "charge",
            "reserve",
          ]);
          assert.ok(
            entries.every(
              (x) => x.amount === "1" && x.detail.actor_id === f.actor,
            ),
          );
          completed = { ...x, run: a.id };
        },
      );
      await t.test(
        "archive is tenant isolated and recoverable, preserves report and billing, blocks stale edits",
        async () => {
          const x = completed,
            archive = `/api/ai-tests/${x.d.id}/archive`;
          assert.equal(
            (
              await f.request(
                archive,
                { version: x.d.version },
                "POST",
                f.otherAuth,
                f.other,
              )
            ).statusCode,
            404,
          );
          assert.equal(
            (await f.request(archive, { version: x.d.version - 1 })).statusCode,
            409,
          );
          await f.ok(archive, { version: x.d.version });
          assert.ok(
            !(await f.ok("/api/ai-tests")).drafts.some((d) => d.id === x.d.id),
          );
          assert.ok(
            (await f.ok("/api/ai-tests?archived=1")).drafts.some(
              (d) => d.id === x.d.id,
            ),
          );
          assert.equal((await f.request(x.url, x.body)).statusCode, 404);
          assert.equal(
            (
              await f.request(
                `/api/ai-tests/${x.d.id}`,
                { version: x.d.version, data: x.d.data },
                "PUT",
              )
            ).statusCode,
            404,
          );
          assert.ok((await run(x.run)).result);
          assert.equal((await ledger(x.run)).length, 2);
          assert.ok((await f.ok(`/api/ai-tests/runs/${x.run}/retest`, {})).id);
          assert.equal(
            (
              await f.request(
                `/api/ai-tests/${x.d.id}/restore`,
                {},
                "POST",
                f.otherAuth,
                f.other,
              )
            ).statusCode,
            404,
          );
          await f.ok(`/api/ai-tests/${x.d.id}/restore`, {});
          const restored = (await f.ok(`/api/ai-tests/${x.d.id}`)).draft;
          assert.deepEqual(restored.data, x.d.data);
          assert.equal(restored.version, x.d.version + 2);
          assert.ok(await f.ok(`/api/ai-tests/${x.d.id}/review`));
          const refs = {
            items: [
              { report_id: f.report, product_id: f.candidates[0].product_id },
            ],
          };
          const imported = (await f.ok("/api/ai-tests/import", refs)).items[0];
          const importedDraft = (await f.ok(`/api/ai-tests/${imported.id}`))
            .draft;
          await f.ok(`/api/ai-tests/${imported.id}/archive`, {
            version: importedDraft.version,
          });
          assert.notEqual(
            (await f.ok("/api/ai-tests/import", refs)).items[0].id,
            imported.id,
          );
        },
      );
      await t.test(
        "unknown provider status holds a use; billable cancellation and failure refund it",
        async () => {
          await f.ok(creditPath, credit("2"), "POST", f.adminAuth);
          await resetProvider();
          f.behavior.complete = false;
          f.behavior.throwCreate = 1;
          let x = await prepare(),
            r = await f.ok(x.url, x.body);
          await f.tick();
          assert.equal((await run(r.id)).status, "reconciling");
          assert.equal((await wallet()).reserved, "1");
          f.behavior.cancelBillable = true;
          await f.ok(`/api/ai-tests/runs/${r.id}/cancel`, {});
          await f.tick();
          assert.equal((await run(r.id)).status, "cancelled");
          assert.equal((await run(r.id)).quota_state, "released");
          assert.equal((await wallet()).available, "2");
          await resetProvider();
          f.behavior.complete = false;
          x = await prepare();
          r = await f.ok(x.url, x.body);
          await f.tick();
          const remote = [...f.remotes.values()].find(
            (v) => v.partner_product_id === r.id,
          );
          remote.status = "failed";
          await f.tick();
          assert.equal((await run(r.id)).quota_state, "released");
          assert.equal((await wallet()).available, "2");
          assert.equal((await wallet()).reserved, "0");
        },
      );
      await t.test(
        "malformed completed result remains reserved until a valid result is recovered",
        async () => {
          await resetProvider();
          f.behavior.complete = false;
          const x = await prepare(),
            r = await f.ok(x.url, x.body);
          await f.tick();
          const remote = [...f.remotes.values()].find(
            (v) => v.partner_product_id === r.id,
          );
          const valid = remote.results;
          remote.results = {};
          remote.status = "completed";
          await f.tick();
          assert.equal((await run(r.id)).status, "reconciling");
          assert.equal((await run(r.id)).quota_state, "reserved");
          remote.results = valid;
          await f.tick();
          assert.equal((await run(r.id)).quota_state, "charged");
          assert.equal((await wallet()).available, "1");
          assert.equal((await wallet()).reserved, "0");
        },
      );
    } finally {
      await f.close();
    }
  },
);
