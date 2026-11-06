import test from "node:test";
import assert from "node:assert/strict";
import { id } from "../src/common/core.mjs";
import { aiFixture } from "./fixtures/ai-testing.mjs";
import { emptyArm, confirmationDigest } from "../src/ai-testing/contract.mjs";
import { getDraft, selectedImages } from "../src/ai-testing/service.mjs";
import { utcMonth } from "../src/ai-testing/pool.mjs";
import sharp from "sharp";
import { providerValidationFields } from "../src/ai-testing/validation.mjs";
test(
  "AI testing imports, confirms, isolates, retries, switches accounts and settles once",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const f = await aiFixture();
    try {
      assert.deepEqual(
        (
          await f.db.query(
            "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
          )
        ).rows[0],
        { rolsuper: false, rolbypassrls: false },
      );
      async function prepare(name = "Local test") {
        let d = await f.ok("/api/ai-tests", {});
        const data = d.data;
        data.name = name;
        data.shopper_problem = "Organize a small room";
        data.arms[0].product.name = "Bamboo rack";
        data.arms[0].product.use = "Storage";
        data.arms[0].pricing.current_price = 29.99;
        data.arms[0].url = f.candidates[0].tk_url;
        data.arms[0].product_id = f.candidates[0].product_id;
        d = await f.ok(
          "/api/ai-tests/" + d.id,
          { version: d.version, data },
          "PUT",
        );
        for (const arm of ["A", "B"])
          d = await f.ok("/api/ai-tests/" + d.id + "/image", {
            version: d.version,
            arm,
            data: f.png.toString("base64"),
          });
        const review = await f.ok("/api/ai-tests/" + d.id + "/review");
        return {
          d,
          review,
          body: {
            version: review.version,
            digest: review.digest,
            confirmed: true,
          },
        };
      }
      const submit = (x) => f.ok("/api/ai-tests/" + x.d.id + "/submit", x.body);
      const run = (id) =>
        f.db.tenant(
          f.workspace,
          async (c) =>
            (await c.query("SELECT * FROM ai_test_runs WHERE id=$1", [id]))
              .rows[0],
        );
      const account = (id) =>
        f.db
          .query("SELECT * FROM ai_test_accounts WHERE id=$1", [id])
          .then((r) => r.rows[0]);
      async function resetAccounts() {
        await f.db.query(
          "UPDATE ai_test_accounts SET state='ready',trial_used=0,monthly_used=0,enabled=true,quota_month=$2 WHERE id=ANY($1::uuid[])",
          [f.accounts, utcMonth()],
        );
        f.behavior.exhaust.clear();
        f.behavior.throwCreate = 0;
        f.behavior.loseReceipt = false;
        f.behavior.complete = true;
        f.behavior.estimateError = null;
        f.behavior.estimateErrorDetail = null;
        f.behavior.remainingByKey.clear();
        f.behavior.usedByKey.clear();
      }
      await t.test(
        "public error responses include Chinese fields and remedies without exposing provider details or reserving quota",
        async () => {
          const x = await prepare("Chinese error presentation");
          const before = await f.db.tenant(
            f.workspace,
            async (c) =>
              (
                await c.query(
                  "SELECT available,reserved FROM wallets WHERE currency='ai_test_uses'",
                )
              ).rows[0],
          );
          f.behavior.estimateError = "ai_invalid_spec";
          f.behavior.estimateErrorDetail = {
            fields: providerValidationFields(
              {
                issues: [
                  {
                    path: ["arms", 1, "pricing", "shipping"],
                    code: "too_big",
                    origin: "string",
                    maximum: 200,
                  },
                ],
                trace: "private",
              },
              x.review.spec,
            ),
          };
          const response = await f.request(
            "/api/ai-tests/" + x.d.id + "/estimate",
            {},
          );
          assert.equal(response.statusCode, 502);
          assert.equal(response.json().error, "ai_invalid_spec");
          assert.match(response.json().message, /测品配置/);
          assert.equal(
            response.json().fields[0].label,
            "方案 B · 价格与配送 · 运费说明",
          );
          assert.match(response.json().fields[0].message, /200 个字符/);
          assert.doesNotMatch(response.body, /private|Too big/);
          const after = await f.db.tenant(
            f.workspace,
            async (c) =>
              (
                await c.query(
                  "SELECT available,reserved FROM wallets WHERE currency='ai_test_uses'",
                )
              ).rows[0],
          );
          assert.deepEqual(after, before);
          const saved = await f.ok("/api/ai-tests/" + x.d.id);
          assert.equal(saved.runs.length, 0);
          f.behavior.estimateError = null;
          f.behavior.estimateErrorDetail = null;
          const blank = await f.ok("/api/ai-tests", {});
          const rejected = await f.request(
            "/api/ai-tests/" + blank.id + "/review",
          );
          // Image checks happen before request construction; the UI lists all missing fields first.
          assert.match(rejected.json().message, /[\u3400-\u9fff]/u);
        },
      );
      await t.test(
        "Amazon links over 500 characters save and upload A/B screenshots without changing product identity",
        async () => {
          let d = await f.ok("/api/ai-tests", {});
          const data = d.data;
          data.market = "amazon_us";
          data.arms[0].product.name = "Shower caddy";
          data.arms[0].product.use = "Bathroom storage";
          data.arms[0].pricing.current_price = 29.99;
          data.arms[0].product_id = "B012345678";
          const url =
            "https://www.amazon.com/Shower-Caddy/dp/B012345678?smid=SELLER123&th=1&psc=1&ref_=" +
            "x".repeat(1500);
          data.arms[0].url = url;
          d = await f.ok(
            "/api/ai-tests/" + d.id,
            { version: d.version, data },
            "PUT",
          );
          assert.equal(d.data.arms[0].url, url);
          for (const arm of ["A", "B"])
            d = await f.ok("/api/ai-tests/" + d.id + "/image", {
              version: d.version,
              arm,
              data: f.png.toString("base64"),
            });
          const saved = await f.ok("/api/ai-tests/" + d.id);
          assert.equal(saved.runs.length, 0);
          assert.equal(saved.images.length, 2);
          assert.ok(saved.images.every((i) => i.state === "ready"));
          assert.ok(saved.images.every((i) => i.metadata.source_url === url));
          await f.db.tenant(f.workspace, async (c) => {
            const images = await selectedImages(c, saved.draft);
            assert.ok(images.every((i) => i.request.url === url));
          });
          const review = await f.ok("/api/ai-tests/" + d.id + "/review");
          assert.equal(
            review.spec.product.url,
            "https://www.amazon.com/dp/B012345678?smid=SELLER123&th=1&psc=1",
          );
          assert.equal(review.effective_arms[0].url, url);
          assert.equal(review.effective_arms[1].url, url);
          await f.ok("/api/ai-tests/" + d.id + "/estimate", {});
          const estimate = f.calls.at(-1);
          assert.equal(estimate.action, "estimate");
          assert.equal(estimate.spec.product.url, review.spec.product.url);
          assert.ok(estimate.spec.product.url.length <= 500);
          for (const fields of [
            estimate.spec.scenario,
            estimate.spec.audience,
            ...estimate.spec.arms,
          ])
            assert.ok(!Object.values(fields).includes(""));
          const rejected = structuredClone(saved.draft.data);
          rejected.arms[1].other_product = true;
          rejected.arms[1].url =
            "https://www.amazon.com/dp/B012345679?q=" + "x".repeat(8192);
          const response = await f.request(
            "/api/ai-tests/" + d.id,
            { version: saved.draft.version, data: rejected },
            "PUT",
          );
          assert.equal(response.statusCode, 400);
          assert.match(response.json().fields[0].message, /商品页面链接过长/);
          const after = await f.ok("/api/ai-tests/" + d.id);
          assert.equal(after.draft.version, saved.draft.version);
          assert.deepEqual(after.draft.data, saved.draft.data);
        },
      );
      await t.test(
        "large manual screenshots persist for both arms while files above 5 MiB leave the draft unchanged",
        async () => {
          const png = await sharp(f.png)
            .removeAlpha()
            .png({ compressionLevel: 0 })
            .toBuffer();
          assert.ok(png.length > 2 * 1024 * 1024);
          assert.ok(png.length <= 5 * 1024 * 1024);
          let d = await f.ok("/api/ai-tests", {});
          for (const arm of ["A", "B"])
            d = await f.ok("/api/ai-tests/" + d.id + "/image", {
              version: d.version,
              arm,
              data: png.toString("base64"),
            });
          const saved = await f.ok("/api/ai-tests/" + d.id);
          assert.equal(saved.images.length, 2);
          for (const arm of saved.draft.data.arms) {
            const image = saved.images.find((i) => i.id === arm.image_id);
            assert.equal(image.arm, arm.id);
            assert.equal(image.state, "ready");
            assert.equal(image.metadata.manual, true);
            const artifact = await f.db.tenant(
              f.workspace,
              async (c) =>
                (
                  await c.query("SELECT * FROM artifacts WHERE id=$1", [
                    image.artifact_id,
                  ])
                ).rows[0],
            );
            assert.deepEqual(
              await f.store.read(artifact.object_key, artifact.sha256),
              png,
            );
          }
          const rejected = await f.request("/api/ai-tests/" + d.id + "/image", {
            version: d.version,
            arm: "A",
            data: Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64"),
          });
          assert.equal(rejected.statusCode, 400);
          assert.equal(rejected.json().error, "ai_image_size");
          const after = await f.ok("/api/ai-tests/" + d.id);
          assert.equal(after.draft.version, d.version);
          assert.deepEqual(after.draft.data.arms, saved.draft.data.arms);
          assert.equal(after.images.length, 2);
        },
      );
      await t.test(
        "oversized new requests and legacy drafts cannot reach SDK preflight or reserve quota",
        async () => {
          const x = await prepare("Consumer limit boundary");
          assert.equal(x.d.data.persona_count, 20);
          const callsBefore = f.calls.length;
          const oversized = { ...x.d.data, persona_count: 21 };
          assert.equal(
            (
              await f.request(
                "/api/ai-tests/" + x.d.id,
                { version: x.d.version, data: oversized },
                "PUT",
              )
            ).statusCode,
            400,
          );
          const legacyBody = await f.db.tenant(f.workspace, async (c) => {
            await c.query(
              "UPDATE ai_test_drafts SET data=jsonb_set(data,'{persona_count}','25'::jsonb) WHERE id=$1",
              [x.d.id],
            );
            const draft = await getDraft(c, x.d.id);
            return {
              version: draft.version,
              digest: confirmationDigest(draft, await selectedImages(c, draft)),
              confirmed: true,
            };
          });
          for (const [suffix, body] of [
            ["/review", undefined],
            ["/estimate", {}],
            ["/submit", legacyBody],
          ])
            assert.equal(
              (await f.request("/api/ai-tests/" + x.d.id + suffix, body))
                .statusCode,
              400,
              suffix,
            );
          assert.equal(f.calls.length, callsBefore);
          assert.equal(
            (
              await f.db.tenant(f.workspace, (c) =>
                c.query("SELECT 1 FROM ai_test_runs WHERE draft_id=$1", [
                  x.d.id,
                ]),
              )
            ).rowCount,
            0,
          );
        },
      );
      await t.test(
        "imports full product snapshot once without buying data or starting an SDK test",
        async () => {
          const before = f.calls.length,
            refs = {
              items: [
                { report_id: f.report, product_id: f.candidates[0].product_id },
              ],
            };
          const a = await f.ok("/api/ai-tests/import", refs),
            b = await f.ok("/api/ai-tests/import", refs);
          assert.equal(a.items[0].id, b.items[0].id);
          const x = await f.ok("/api/ai-tests/" + a.items[0].id);
          assert.deepEqual(x.draft.sources.A.candidate, f.candidates[0]);
          assert.equal(x.draft.data.arms[0].image_id, null);
          assert.equal(f.calls.length, before);
          assert.equal(
            (
              await f.request(
                "/api/ai-tests/" + a.items[0].id,
                undefined,
                "GET",
                f.otherAuth,
                f.other,
              )
            ).statusCode,
            404,
          );
          assert.equal(
            (await f.request("/api/admin/ai-test-accounts", undefined))
              .statusCode,
            401,
          );
          assert.equal(
            (await f.db.query("SELECT * FROM ai_test_drafts")).rowCount,
            0,
          );
          // Import now queues model suggestions; no model is configured in this fixture.
          await f.tick();
          assert.equal(
            (await f.ok("/api/ai-tests/" + a.items[0].id)).suggestions[0].state,
            "failed",
          );
        },
      );
      await t.test(
        "disabled automatic capture queues no work and manual screenshots still attach",
        async () => {
          let d = await f.ok("/api/ai-tests", {});
          d.data.arms[0].url = f.candidates[0].tk_url;
          d.data.arms[0].product_id = f.candidates[0].product_id;
          d = await f.ok(
            "/api/ai-tests/" + d.id,
            { version: d.version, data: d.data },
            "PUT",
          );
          const before = f.calls.length;
          const disabled = await f.request(
            "/api/ai-tests/" + d.id + "/capture",
            {
              version: d.version,
              arm: "A",
            },
          );
          assert.equal(disabled.statusCode, 409);
          assert.equal(disabled.json().error, "ai_capture_disabled");
          assert.equal(f.calls.length, before);
          assert.equal(
            (
              await f.db.query(
                "SELECT count(*)::int AS n FROM ai_test_dispatch WHERE workspace_id=$1",
                [f.workspace],
              )
            ).rows[0].n,
            0,
          );
          assert.equal(
            (await f.ok("/api/ai-tests/" + d.id)).draft.version,
            d.version,
          );
          for (const arm of ["A", "B"]) {
            d = await f.ok("/api/ai-tests/" + d.id + "/image", {
              version: d.version,
              arm,
              data: f.png.toString("base64"),
            });
          }
          const ready = await f.ok("/api/ai-tests/" + d.id);
          assert.equal(ready.images.length, 2);
          assert.ok(
            ready.images.every((i) => i.state === "ready" && i.metadata.manual),
          );
          assert.ok(ready.draft.data.arms.every((a) => a.image_id));
        },
      );
      await t.test(
        "confirmation rejects changed data; duplicate concurrent submit reserves and charges once",
        async () => {
          const x = await prepare();
          const edited = structuredClone(x.d.data);
          edited.arms[1].change_summary = "Updated layout";
          await f.ok(
            "/api/ai-tests/" + x.d.id,
            { version: x.d.version, data: edited },
            "PUT",
          );
          assert.equal(
            (await f.request("/api/ai-tests/" + x.d.id + "/submit", x.body))
              .statusCode,
            409,
          );
          const r = await f.ok("/api/ai-tests/" + x.d.id + "/review"),
            body = { version: r.version, digest: r.digest, confirmed: true };
          const runs = await Promise.all([
            f.ok("/api/ai-tests/" + x.d.id + "/submit", body),
            f.ok("/api/ai-tests/" + x.d.id + "/submit", body),
          ]);
          assert.equal(runs[0].id, runs[1].id);
          const reservation = await f.db.query(
            "SELECT * FROM ai_test_reservations WHERE run_id=$1",
            [runs[0].id],
          );
          assert.equal(reservation.rowCount, 1);
          assert.equal((await account(f.first.id)).trial_used, 0);
          await f.tick();
          assert.equal((await run(runs[0].id)).status, "completed");
          assert.equal((await account(f.first.id)).trial_used, 1);
          assert.equal((await account(f.first.id)).monthly_used, 40);
          await f.tick();
          assert.equal((await account(f.first.id)).trial_used, 1);
          const otherResult = await f.request(
            "/api/ai-tests/runs/" + runs[0].id + "/retest",
            {},
            "POST",
            f.otherAuth,
            f.other,
          );
          assert.equal(otherResult.statusCode, 404);
          const retest = await f.ok(
            "/api/ai-tests/runs/" + runs[0].id + "/retest",
            {},
          );
          assert.notEqual(retest.id, x.d.id);
          assert.notEqual(
            retest.data.arms[0].image_id,
            edited.arms[0].image_id,
          );
          assert.ok(await f.ok("/api/ai-tests/" + retest.id + "/review"));
          const publicList = await f.ok("/api/ai-tests");
          assert.ok(!JSON.stringify(publicList).includes("fl_local_fixture"));
          assert.ok(!JSON.stringify(publicList).includes("secret_ref"));
        },
      );
      await t.test(
        "different-product B is independent; unsupported extra fields are rejected",
        async () => {
          const x = await prepare();
          const d = x.d.data;
          d.arms[1] = emptyArm("B");
          d.arms[1].other_product = true;
          d.arms[1].url = f.candidates[1].tk_url;
          d.arms[1].inherit = [];
          d.arms[1].product.name = "Metal rack";
          d.arms[1].pricing.current_price = 24.99;
          d.arms[0].product.material = "Bamboo";
          let saved = await f.ok(
            "/api/ai-tests/" + x.d.id,
            { version: x.d.version, data: d },
            "PUT",
          );
          saved = await f.ok("/api/ai-tests/" + x.d.id + "/image", {
            version: saved.version,
            arm: "B",
            data: f.png.toString("base64"),
          });
          const r = await f.ok("/api/ai-tests/" + x.d.id + "/review");
          assert.equal(r.spec.arms[1].product.material, undefined);
          assert.equal(r.spec.product.material, undefined);
          assert.equal(r.spec.arms[1].product.name, "Metal rack");
          d.arms[1].pricing.tax = "0";
          assert.equal(
            (
              await f.request(
                "/api/ai-tests/" + x.d.id,
                { version: saved.version, data: d },
                "PUT",
              )
            ).statusCode,
            400,
          );
        },
      );
      await t.test(
        "definitive exhausted account switches to a second account without charging the first",
        async () => {
          await resetAccounts();
          f.behavior.exhaust.add(f.first.key);
          const probe = await prepare("Preflight fallback");
          assert.equal(
            (await f.ok("/api/ai-tests/" + probe.d.id + "/estimate", {}))
              .estimate.ready,
            true,
          );
          const x = await prepare(),
            r = await submit(x);
          await f.tick();
          assert.equal((await run(r.id)).attempt, 2);
          assert.equal((await account(f.first.id)).trial_used, 0);
          assert.equal((await account(f.first.id)).state, "trial_exhausted");
          await f.tick();
          assert.equal((await run(r.id)).status, "completed");
          assert.equal((await account(f.second.id)).trial_used, 1);
        },
      );
      await t.test(
        "when the whole pool is exhausted, waiting tasks never replay a released account",
        async () => {
          await resetAccounts();
          f.behavior.exhaust.add(f.first.key);
          f.behavior.exhaust.add(f.second.key);
          const x = await prepare(),
            r = await submit(x);
          await f.tick();
          await f.tick();
          assert.equal((await run(r.id)).status, "waiting_capacity");
          const before = f.calls.length;
          await f.tick();
          assert.equal(f.calls.length, before);
          await f.ok("/api/ai-tests/runs/" + r.id + "/cancel", {});
          await f.tick();
          assert.equal((await run(r.id)).status, "cancelled");
        },
      );
      await t.test(
        "uncertain create keeps account and idempotency key, recovers once",
        async () => {
          await resetAccounts();
          f.behavior.throwCreate = 1;
          f.behavior.loseReceipt = true;
          const x = await prepare(),
            r = await submit(x);
          await f.tick();
          let row = await run(r.id);
          assert.equal(row.status, "reconciling");
          assert.equal(row.remote_id, null);
          assert.equal(row.attempt, 1);
          const originalAccount = row.account_id;
          await f.tick();
          row = await run(r.id);
          assert.equal(row.status, "completed");
          assert.equal(row.account_id, originalAccount);
          assert.equal(row.attempt, 1);
          const calls = f.calls
            .filter(
              (c) => c.action === "create" && c.spec.name === x.d.data.name,
            )
            .slice(-2);
          assert.equal(calls[0].idempotency_key, calls[1].idempotency_key);
          assert.equal((await account(originalAccount)).trial_used, 1);
        },
      );
      await t.test(
        "cancel during unknown create never starts again; admin associates the existing task",
        async () => {
          await resetAccounts();
          f.behavior.throwCreate = 1;
          f.behavior.loseReceipt = true;
          f.behavior.complete = false;
          const x = await prepare(),
            r = await submit(x);
          await f.tick();
          await f.ok("/api/ai-tests/runs/" + r.id + "/cancel", {});
          const before = f.calls.filter((c) => c.action === "create").length;
          await f.tick();
          assert.equal(
            f.calls.filter((c) => c.action === "create").length,
            before,
          );
          assert.equal(
            (await run(r.id)).error_code,
            "ai_reconciliation_required",
          );
          const reservation = (
              await f.db.query(
                "SELECT * FROM ai_test_reservations WHERE run_id=$1",
                [r.id],
              )
            ).rows[0],
            remote = [...f.remotes.values()].at(-1);
          await f.ok(
            "/api/admin/ai-test-reservations/" + reservation.id + "/reconcile",
            { remote_id: remote.id, note: "Checked local fake provider task" },
            "POST",
            f.adminAuth,
          );
          await f.tick();
          assert.equal((await run(r.id)).status, "cancelled");
          assert.equal((await account(f.first.id)).monthly_used, 0);
          assert.equal((await account(f.first.id)).trial_used, 1);
        },
      );
      await t.test(
        "cancelling a known started test refunds credits without restoring trial count",
        async () => {
          await resetAccounts();
          f.behavior.complete = false;
          const x = await prepare(),
            r = await submit(x);
          await f.tick();
          assert.equal((await run(r.id)).status, "processing");
          assert.equal((await account(f.first.id)).trial_used, 1);
          await f.ok("/api/ai-tests/runs/" + r.id + "/cancel", {});
          await f.tick();
          assert.equal((await run(r.id)).status, "cancelled");
          assert.equal((await account(f.first.id)).trial_used, 1);
          assert.equal((await account(f.first.id)).monthly_used, 0);
        },
      );
      await t.test(
        "temporary estimate failure does not skip preflight or create a billable task",
        async () => {
          await resetAccounts();
          f.behavior.estimateError = "ai_transport_uncertain";
          const x = await prepare(),
            r = await submit(x);
          const before = f.calls.filter((c) => c.action === "create").length;
          await f.tick();
          await f.tick();
          assert.equal(
            f.calls.filter((c) => c.action === "create").length,
            before,
          );
          await f.ok("/api/ai-tests/runs/" + r.id + "/cancel", {});
          await f.tick();
          assert.equal((await run(r.id)).status, "cancelled");
          assert.equal((await account(f.first.id)).trial_used, 0);
        },
      );
      await t.test(
        "account key verification and rotation never reset consumed trial counts",
        async () => {
          await resetAccounts();
          const body = {
            name: "Admin QA",
            owner_identity: "test-" + id(),
            key: "fl_admin_" + id(),
            trial_used: null,
            trial_limit: 6,
            monthly_used: 0,
            monthly_limit: 150,
            priority: 10,
            note: "",
          };
          const added = await f.ok(
            "/api/admin/ai-test-accounts",
            body,
            "POST",
            f.adminAuth,
          );
          f.accounts.push(added.id);
          await f.ok(
            "/api/admin/ai-test-accounts/" + added.id + "/validate",
            {},
            "POST",
            f.adminAuth,
          );
          const patch = {
            name: body.name,
            enabled: true,
            trial_used: null,
            trial_limit: 6,
            monthly_used: 0,
            monthly_limit: 150,
            priority: 10,
            note: "",
          };
          assert.equal(
            (
              await f.request(
                "/api/admin/ai-test-accounts/" + added.id,
                patch,
                "PATCH",
                f.adminAuth,
              )
            ).statusCode,
            409,
          );
          patch.trial_used = 4;
          await f.ok(
            "/api/admin/ai-test-accounts/" + added.id,
            patch,
            "PATCH",
            f.adminAuth,
          );
          await f.ok(
            "/api/admin/ai-test-accounts/" + added.id + "/rotate",
            { key: "fl_rotated_" + id() },
            "POST",
            f.adminAuth,
          );
          const a = await account(added.id);
          assert.equal(a.trial_used, 4);
          assert.equal(a.enabled, false);
          const list = await f.ok(
            "/api/admin/ai-test-accounts",
            undefined,
            "GET",
            f.adminAuth,
          );
          assert.ok(!JSON.stringify(list).includes("fl_admin"));
          assert.ok(!JSON.stringify(list).includes("secret_ref"));
        },
      );
      await t.test(
        "price edits reject stale screenshots and uploaded artifacts stay tenant-scoped",
        async () => {
          const x = await prepare("Stale image");
          x.d.data.arms[0].pricing.current_price = 31;
          const saved = await f.ok(
            "/api/ai-tests/" + x.d.id,
            { version: x.d.version, data: x.d.data },
            "PUT",
          );
          assert.equal(
            (await f.request("/api/ai-tests/" + saved.id + "/review")).json()
              .error,
            "ai_image_stale",
          );
          const preview = (await f.ok("/api/ai-tests/" + saved.id)).images[0]
            .artifact_id;
          assert.equal(
            (
              await f.request(
                "/api/artifacts/" + preview,
                undefined,
                "GET",
                f.otherAuth,
                f.other,
              )
            ).statusCode,
            404,
          );
        },
      );
      await t.test(
        "concurrent distinct submissions cannot oversubscribe an account",
        async () => {
          await resetAccounts();
          // The admin-rotation fixture is deliberately left disabled.
          await f.db.query(
            "UPDATE ai_test_accounts SET enabled=false WHERE id=ANY($1::uuid[]) AND id<>ALL($2::uuid[])",
            [f.accounts, [f.first.id, f.second.id]],
          );
          const inputs = await Promise.all([
            prepare("Concurrent one"),
            prepare("Concurrent two"),
            prepare("Concurrent three"),
          ]);
          const replies = await Promise.all(
            inputs.map((x) =>
              f.request("/api/ai-tests/" + x.d.id + "/submit", x.body),
            ),
          );
          assert.equal(replies.filter((r) => r.statusCode === 200).length, 2);
          assert.equal(
            replies.filter((r) => r.json().error === "ai_pool_empty").length,
            1,
          );
          const reservations = (
            await f.db.query(
              "SELECT account_id,count(*)::int AS n FROM ai_test_reservations WHERE workspace_id=$1 AND state='reserved' GROUP BY account_id",
              [f.workspace],
            )
          ).rows;
          assert.equal(reservations.length, 2);
          assert.ok(reservations.every((r) => r.n === 1));
          for (const r of replies.filter((r) => r.statusCode === 200))
            await f.ok("/api/ai-tests/runs/" + r.json().id + "/cancel", {});
          await f.tick();
          await f.tick();
          assert.equal((await account(f.first.id)).trial_used, 0);
        },
      );
      await t.test(
        "month rollover resets monthly allowance but never lifetime trial counts; rejected input releases capacity",
        async () => {
          await resetAccounts();
          await f.db.query(
            "UPDATE ai_test_accounts SET trial_used=5,monthly_used=150,quota_month='2020-01',state='monthly_exhausted' WHERE id=$1",
            [f.first.id],
          );
          const x = await prepare("Month rollover"),
            r = await submit(x);
          assert.equal((await run(r.id)).account_id, f.first.id);
          assert.equal((await account(f.first.id)).monthly_used, 0);
          assert.equal((await account(f.first.id)).trial_used, 5);
          await f.tick();
          assert.equal((await account(f.first.id)).trial_used, 6);
          assert.equal((await account(f.first.id)).monthly_used, 40);
          await assert.rejects(
            f.db.tenant(f.workspace, (c) =>
              c.query("UPDATE ai_test_runs SET snapshot='{}' WHERE id=$1", [
                r.id,
              ]),
            ),
            (e) => e.code === "42501",
          );
          await assert.rejects(
            f.db.tenant(f.workspace, (c) =>
              c.query("UPDATE ai_test_events SET detail='{}' WHERE run_id=$1", [
                r.id,
              ]),
            ),
            (e) => e.code === "42501",
          );
          f.behavior.estimateError = "ai_audience_too_small";
          const y = await prepare("Invalid audience"),
            next = await submit(y);
          assert.equal((await run(next.id)).account_id, f.second.id);
          await f.tick();
          assert.equal((await run(next.id)).status, "failed");
          assert.equal((await account(f.second.id)).trial_used, 0);
        },
      );
      await t.test(
        "expired idempotency never creates a replacement for a known unstarted remote task",
        async () => {
          await resetAccounts();
          const x = await prepare("Expired draft"),
            r = await submit(x),
            remoteId = "pt_" + id();
          f.remotes.set(remoteId, {
            id: remoteId,
            status: "awaiting_upload",
            billable: false,
            credits: 40,
          });
          await f.db.tenant(f.workspace, async (c) => {
            await c.query(
              "UPDATE ai_test_runs SET remote_id=$2,status='reconciling' WHERE id=$1",
              [r.id, remoteId],
            );
            await c.query(
              "UPDATE ai_test_reservations SET creation_attempted=true,created_at=now()-interval '8 days' WHERE run_id=$1",
              [r.id],
            );
          });
          const before = f.calls.filter((c) => c.action === "create").length;
          await f.tick();
          assert.equal(
            f.calls.filter((c) => c.action === "create").length,
            before,
          );
          assert.equal((await run(r.id)).status, "cancelled");
          assert.equal((await account(f.first.id)).trial_used, 0);
        },
      );
      await t.test(
        "insufficient large-test balance remains usable for a smaller test",
        async () => {
          await resetAccounts();
          f.behavior.remainingByKey.set(f.first.key, 30);
          const x = await prepare("Partial remaining balance");
          assert.equal(
            (await f.ok("/api/ai-tests/" + x.d.id + "/estimate", {})).estimate
              .ready,
            true,
          );
          const r = await submit(x);
          await f.tick();
          assert.equal((await run(r.id)).account_id, f.second.id);
          assert.equal((await account(f.first.id)).state, "ready");
          assert.equal((await account(f.first.id)).monthly_used, 120);
          await f.tick();
          const y = await prepare("Small test");
          y.d.data.persona_count = 10;
          y.d = await f.ok(
            "/api/ai-tests/" + y.d.id,
            { version: y.d.version, data: y.d.data },
            "PUT",
          );
          const v = await f.ok("/api/ai-tests/" + y.d.id + "/review");
          y.body = { version: v.version, digest: v.digest, confirmed: true };
          const small = await submit(y);
          assert.equal((await run(small.id)).account_id, f.first.id);
          await f.tick();
          assert.equal((await run(small.id)).status, "completed");
          assert.equal((await account(f.first.id)).monthly_used, 140);
        },
      );
    } finally {
      await f.close();
    }
  },
);
