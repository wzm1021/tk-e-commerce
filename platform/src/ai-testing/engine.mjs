import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { id, requireThat, AppError } from "../common/core.mjs";
import { saveArtifact } from "../files/artifacts.mjs";
import { sdkCall } from "./sdk.mjs";
import { capturePage } from "./screenshot.mjs";
import { inspectImage } from "./images.mjs";
import { settleTestUse } from "./quota.mjs";
import {
  captureIdentity,
  effectiveArm,
  creditsFor,
  terminal,
} from "./contract.mjs";
import { reserve, markStarted, settle, utcMonth } from "./pool.mjs";

const safeError = (e) =>
  /^ai_[a-z_]+$/.test(e.code || "") ? e.code : "ai_execution_failed";
export { publicResults } from "./report-results.mjs";
import { publicResults } from "./report-results.mjs";
import { enrichReport, failReport } from "./report.mjs";
import { exportPdf } from "./pdf.mjs";
import { suggestionJob, failSuggestions } from "./suggestions.mjs";
export class AiTestEngine {
  constructor({
    db,
    store,
    secrets,
    sdk = sdkCall,
    capture = capturePage,
    reportTranslator,
    pdfRenderer,
    suggestionGenerator,
  }) {
    Object.assign(this, {
      db,
      store,
      secrets,
      sdk,
      capture,
      reportTranslator,
      pdfRenderer,
      suggestionGenerator,
    });
  }
  async claim() {
    return this.db.tx(null, async (c) => {
      const q = (
        await c.query(
          `SELECT * FROM ai_test_dispatch WHERE available_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY CASE WHEN kind='suggestion' THEN 1 ELSE 0 END,available_at,id FOR UPDATE SKIP LOCKED LIMIT 1`,
        )
      ).rows[0];
      if (!q) return null;
      const token = id();
      await c.query(
        "UPDATE ai_test_dispatch SET lease_token=$2,lease_until=now()+interval '10 minutes' WHERE id=$1",
        [q.id, token],
      );
      return { ...q, lease_token: token };
    });
  }
  async tx(q, fn) {
    return this.db.tenant(q.workspace_id, async (c) => {
      requireThat(
        (
          await c.query(
            "SELECT 1 FROM ai_test_dispatch WHERE id=$1 AND lease_token=$2 AND lease_until>now() FOR UPDATE",
            [q.id, q.lease_token],
          )
        ).rowCount,
        "ai_lease_lost",
        409,
      );
      return fn(c);
    });
  }
  async later(q, seconds = 25) {
    await this.db.query(
      "UPDATE ai_test_dispatch SET available_at=now()+$3*interval '1 second',lease_until=NULL,lease_token=NULL WHERE id=$1 AND lease_token=$2",
      [q.id, q.lease_token, seconds],
    );
  }
  async once() {
    const q = await this.claim();
    if (!q) return false;
    const heartbeat = setInterval(
      () =>
        this.db
          .query(
            "UPDATE ai_test_dispatch SET lease_until=now()+interval '10 minutes' WHERE id=$1 AND lease_token=$2 AND lease_until>now()",
            [q.id, q.lease_token],
          )
          .catch(() => {}),
      30000,
    );
    try {
      if (q.kind === "suggestion") await suggestionJob(this, q);
      else if (q.kind === "capture") await this.captureJob(q);
      else await this.runJob(q);
    } catch (e) {
      if (e.code !== "ai_lease_lost") {
        if (q.kind === "suggestion") await failSuggestions(this, q, e);
        else if (q.kind === "capture")
          await this.tx(q, async (c) => {
            await c.query(
              "UPDATE ai_test_images SET state='failed',error_code=$2,updated_at=now() WHERE id=$1",
              [q.id, safeError(e)],
            );
            await c.query("DELETE FROM ai_test_dispatch WHERE id=$1", [q.id]);
          });
        else {
          await this.tx(q, async (c) => {
            await c.query(
              "UPDATE ai_test_runs SET status='reconciling',error_code=$2,updated_at=now() WHERE id=$1 AND status NOT IN('completed','failed','cancelled')",
              [q.id, safeError(e)],
            );
            await c.query(
              "UPDATE ai_test_reservations SET state='uncertain',updated_at=now() WHERE run_id=$1 AND state IN('reserved','started')",
              [q.id],
            );
          });
          await this.later(q, 60);
        }
      }
    } finally {
      clearInterval(heartbeat);
    }
    return true;
  }
  async captureJob(q) {
    const image = await this.tx(q, async (c) => {
      const i = (
        await c.query("SELECT * FROM ai_test_images WHERE id=$1", [q.id])
      ).rows[0];
      requireThat(i, "ai_image_required");
      await c.query(
        "UPDATE ai_test_images SET state='processing' WHERE id=$1",
        [q.id],
      );
      return i;
    });
    const output = await this.capture(image.request);
    await inspectImage(output.image);
    await inspectImage(output.full);
    await this.tx(q, async (c) => {
      const a = await saveArtifact(
          c,
          this.store,
          q.workspace_id,
          output.image,
          {
            name: `AI测品-${image.arm}.jpeg`,
            mime: "image/jpeg",
            kind: "ai-test-image",
          },
        ),
        full = await saveArtifact(c, this.store, q.workspace_id, output.full, {
          name: `AI测品-${image.arm}-完整页面.jpeg`,
          mime: "image/jpeg",
          kind: "ai-test-image",
        });
      await c.query(
        "UPDATE ai_test_images SET state='ready',artifact_id=$2,full_artifact_id=$3,metadata=$4,updated_at=now() WHERE id=$1",
        [image.id, a.id, full.id, output.metadata],
      );
      const d = (
          await c.query("SELECT * FROM ai_test_drafts WHERE id=$1 FOR UPDATE", [
            image.draft_id,
          ])
        ).rows[0],
        arm = d.data.arms.find((a) => a.id === image.arm);
      const latest = (
        await c.query(
          "SELECT id FROM ai_test_images WHERE draft_id=$1 AND arm=$2 ORDER BY created_at DESC,id DESC LIMIT 1",
          [d.id, image.arm],
        )
      ).rows[0];
      if (
        arm &&
        !arm.image_id &&
        latest?.id === image.id &&
        captureIdentity(d.data, effectiveArm(d.data, arm)) ===
          image.request.identity
      ) {
        arm.image_id = image.id;
        await c.query(
          "UPDATE ai_test_drafts SET data=$2,version=version+1,confirmed_digest=NULL,confirmed_at=NULL,confirmed_by=NULL,updated_at=now() WHERE id=$1",
          [d.id, d.data],
        );
      }
      await c.query("DELETE FROM ai_test_dispatch WHERE id=$1", [q.id]);
    });
  }
  async runJob(q) {
    let { run, reservation } = await this.tx(q, async (c) => ({
      run: (await c.query("SELECT * FROM ai_test_runs WHERE id=$1", [q.id]))
        .rows[0],
      reservation: (
        await c.query(
          "SELECT * FROM ai_test_reservations WHERE run_id=$1 ORDER BY attempt DESC LIMIT 1",
          [q.id],
        )
      ).rows[0],
    }));
    requireThat(run && reservation, "ai_run_missing");
    if (run.status === "completed") {
      if (["queued", "rendering"].includes(run.result?.pdf_zh?.status)) {
        await exportPdf(this, q, run);
        return;
      }
      try {
        await enrichReport(this, q, run);
      } catch (e) {
        await failReport(this, q, run, e);
      }
      return;
    }
    if (terminal(run.status)) {
      await this.tx(q, (c) =>
        c.query("DELETE FROM ai_test_dispatch WHERE id=$1", [q.id]),
      );
      return;
    }
    if (run.status === "waiting_capacity") {
      if (run.cancel_requested) {
        await this.finish(
          q,
          run,
          { status: "cancelled", billable: false },
          false,
        );
        return;
      }
      await this.tryReassign(q, run);
      return;
    }
    if (
      !reservation.creation_attempted &&
      reservation.quota_month !== utcMonth()
    ) {
      await this.tx(q, async (c) => {
        await settle(c, run, { billable: false, started: false });
        await c.query(
          "UPDATE ai_test_runs SET status='waiting_capacity' WHERE id=$1",
          [run.id],
        );
      });
      await this.tryReassign(q, run);
      return;
    }
    // After the upstream idempotency window, a missing id requires human reconciliation, never a new create.
    if (
      !run.remote_id &&
      reservation.creation_attempted &&
      Date.now() - new Date(reservation.created_at).getTime() > 6 * 86400000
    ) {
      await this.tx(q, (c) =>
        c.query(
          "UPDATE ai_test_runs SET status='reconciling',error_code='ai_reconciliation_required' WHERE id=$1",
          [run.id],
        ),
      );
      await this.later(q, 3600);
      return;
    }
    const key = await this.secrets.read(
      reservation.secret_ref,
      `ai-test:${reservation.account_id}:${reservation.secret_version}`,
    );
    const receipt = async (v) => {
      requireThat(
        /^pt_[A-Za-z0-9_-]{1,100}$/.test(v.id),
        "ai_remote_id_invalid",
      );
      await this.tx(q, async (c) => {
        const fresh = (
          await c.query("SELECT * FROM ai_test_runs WHERE id=$1 FOR UPDATE", [
            run.id,
          ])
        ).rows[0];
        requireThat(
          !fresh.remote_id || fresh.remote_id === v.id,
          "ai_remote_id_changed",
        );
        await c.query(
          "UPDATE ai_test_runs SET remote_id=$2,updated_at=now() WHERE id=$1",
          [run.id, v.id],
        );
        if (["queued", "processing", "completed"].includes(v.status))
          await markStarted(c, fresh);
      });
      run.remote_id = v.id;
    };
    const call = (payload) =>
      this.sdk({ ...payload, key }, { onReceipt: receipt });
    const rejectInput = async (e) => {
      if (
        ![
          "ai_invalid_spec",
          "ai_invalid_arms",
          "ai_invalid_image",
          "ai_needs_info",
          "ai_audience_too_small",
          "ai_market_not_supported",
          "ai_currency_mismatch",
          "ai_tier_limit",
        ].includes(e.code)
      )
        return false;
      if (run.remote_id) {
        const current = await call({ action: "get", id: run.remote_id });
        if (current.status !== "awaiting_upload") return false;
        await call({ action: "cancel", id: run.remote_id });
        const cancelled = await call({ action: "get", id: run.remote_id });
        requireThat(
          cancelled.status === "cancelled" && cancelled.billable === false,
          "ai_billing_unknown",
          409,
        );
      } else if (reservation.creation_attempted) return false;
      await this.finish(
        q,
        run,
        { status: "failed", billable: false, error_code: e.code },
        false,
      );
      return true;
    };
    let remote;
    if (run.remote_id)
      remote = await call({ action: "get", id: run.remote_id });
    // A lost start receipt can be recovered from GET. Never interpret a credit refund as a free-test refund.
    if (
      remote &&
      (["queued", "processing", "completed"].includes(remote.status) ||
        (reservation.creation_attempted &&
          ["failed", "cancelled"].includes(remote.status)))
    ) {
      await this.tx(q, (c) => markStarted(c, run));
      reservation.trial_counted = true;
    }
    if (run.cancel_requested) {
      if (!remote && !reservation.creation_attempted) {
        await this.finish(
          q,
          run,
          { status: "cancelled", billable: false },
          false,
        );
        return;
      }
      if (!remote) {
        await this.tx(q, (c) =>
          c.query(
            "UPDATE ai_test_runs SET status='reconciling',error_code='ai_reconciliation_required' WHERE id=$1",
            [run.id],
          ),
        );
        await this.later(q, 3600);
        return;
      }
      if (remote && !terminal(remote.status)) {
        await call({ action: "cancel", id: run.remote_id });
        remote = await call({ action: "get", id: run.remote_id });
      }
      if (remote && terminal(remote.status)) {
        await this.finish(
          q,
          run,
          remote,
          reservation.trial_counted ||
            remote.billable === true ||
            remote.status === "completed",
        );
        return;
      }
      // An uncertain create must be recovered with the same key before it can be cancelled.
    }
    if (remote && terminal(remote.status)) {
      await this.finish(
        q,
        run,
        remote,
        reservation.trial_counted ||
          remote.status === "completed" ||
          remote.billable === true,
      );
      return;
    }
    if (!remote || remote.status === "awaiting_upload") {
      if (
        remote?.status === "awaiting_upload" &&
        Date.now() - new Date(reservation.created_at).getTime() > 6 * 86400000
      ) {
        await call({ action: "cancel", id: run.remote_id });
        const cancelled = await call({ action: "get", id: run.remote_id });
        requireThat(
          cancelled.status === "cancelled",
          "ai_reconciliation_required",
          409,
        );
        await this.finish(q, run, cancelled, false);
        return;
      }
      if (!reservation.creation_attempted) {
        let estimate;
        try {
          estimate = await call({
            action: "estimate",
            spec: run.snapshot.spec,
          });
        } catch (e) {
          if (["ai_quota_exceeded", "ai_free_tier_limit"].includes(e.code)) {
            await this.exhausted(q, run, e.code);
            return;
          }
          if (await rejectInput(e)) return;
          throw e;
        }
        if (!estimate.ready || estimate.credits !== reservation.credits) {
          await this.finish(
            q,
            run,
            {
              status: "failed",
              billable: false,
              error_code: "ai_input_not_ready",
            },
            false,
          );
          return;
        }
        const quota = estimate.quota;
        requireThat(
          Number.isInteger(quota?.used) &&
            quota.used >= 0 &&
            Number.isInteger(quota.limit) &&
            quota.limit >= quota.used &&
            Number.isInteger(quota.remaining) &&
            quota.remaining >= 0 &&
            quota.used + quota.remaining === quota.limit,
          "ai_billing_unknown",
          409,
        );
        const localRemaining = await this.tx(
          q,
          async (c) =>
            (
              await c.query(
                "UPDATE ai_test_accounts SET monthly_used=$2,monthly_limit=LEAST(monthly_limit,$3),quota_month=$4 WHERE id=$1 RETURNING monthly_limit-monthly_used AS remaining",
                [reservation.account_id, quota.used, quota.limit, utcMonth()],
              )
            ).rows[0].remaining,
        );
        if (
          quota.remaining < reservation.credits ||
          localRemaining < reservation.credits
        ) {
          await this.exhausted(q, run, "ai_quota_exceeded", estimate.quota);
          return;
        }
      }
      await this.tx(q, async (c) => {
        await c.query(
          "UPDATE ai_test_runs SET status='submitting',updated_at=now() WHERE id=$1",
          [run.id],
        );
        await c.query(
          "UPDATE ai_test_reservations SET creation_attempted=true WHERE id=$1",
          [reservation.id],
        );
      });
      const dir = await mkdtemp(path.join(tmpdir(), "ai-measure-"));
      try {
        const images = {};
        for (const i of run.snapshot.images) {
          const bytes = await this.store.read(i.object_key, i.sha256),
            meta = await inspectImage(bytes);
          const name = path.join(dir, `${i.arm}.${meta.format}`);
          await writeFile(name, bytes, { mode: 0o600 });
          images[i.arm] = name;
        }
        const created = await call({
          action: "create",
          spec: run.snapshot.spec,
          images,
          idempotency_key: reservation.sdk_key,
        });
        await receipt(created);
        remote = await call({ action: "get", id: run.remote_id });
      } catch (e) {
        if (["ai_quota_exceeded", "ai_free_tier_limit"].includes(e.code)) {
          await this.exhausted(q, run, e.code);
          return;
        }
        if (await rejectInput(e)) return;
        throw e;
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
    if (terminal(remote.status)) {
      await this.finish(q, run, remote, true);
      return;
    }
    requireThat(
      ["queued", "processing", "awaiting_upload"].includes(remote.status),
      "ai_remote_status_invalid",
    );
    await this.tx(q, async (c) => {
      if (["queued", "processing"].includes(remote.status))
        await markStarted(c, run);
      await c.query(
        "UPDATE ai_test_runs SET status=$2,progress=$3,error_code=NULL,updated_at=now() WHERE id=$1",
        [run.id, remote.status, remote.progress || null],
      );
    });
    await this.later(q);
  }
  async exhausted(q, run, code, quota) {
    await this.tx(q, async (c) => {
      const current = (
        await c.query("SELECT * FROM ai_test_runs WHERE id=$1 FOR UPDATE", [
          run.id,
        ])
      ).rows[0];
      const r = (
        await c.query(
          "SELECT * FROM ai_test_reservations WHERE run_id=$1 AND attempt=$2 FOR UPDATE",
          [run.id, current.attempt],
        )
      ).rows[0];
      // A definitive failed start may be reassigned; a recorded successful start may not.
      requireThat(!r.trial_counted, "ai_billing_unknown", 409);
      await settle(c, current, { started: false, billable: false });
      if (
        code === "ai_quota_exceeded" &&
        Number.isInteger(quota?.used) &&
        quota.used >= 0 &&
        Number.isInteger(quota.limit) &&
        quota.limit >= quota.used &&
        Number.isFinite(quota.remaining) &&
        quota.remaining > 0
      ) {
        // Keep the remaining credits available for smaller tests. This reservation never started.
        await c.query(
          "UPDATE ai_test_accounts SET state='ready',monthly_used=$2,monthly_limit=LEAST(monthly_limit,$3),quota_month=$4 WHERE id=$1",
          [r.account_id, quota.used, quota.limit, utcMonth()],
        );
      } else
        await c.query("UPDATE ai_test_accounts SET state=$2 WHERE id=$1", [
          r.account_id,
          code === "ai_free_tier_limit"
            ? "trial_exhausted"
            : "monthly_exhausted",
        ]);
      await c.query(
        "UPDATE ai_test_runs SET status='waiting_capacity',error_code='ai_pool_empty',remote_id=NULL WHERE id=$1",
        [run.id],
      );
    });
    // Account locks and releasing a previous reservation commit before selecting the next account.
    await this.tryReassign(q, run);
  }
  async tryReassign(q, run) {
    try {
      await this.tx(q, async (c) => {
        const current = (
          await c.query("SELECT * FROM ai_test_runs WHERE id=$1 FOR UPDATE", [
            run.id,
          ])
        ).rows[0];
        await reserve(c, current, creditsFor(current.snapshot.data));
      });
      await this.later(q, 1);
    } catch (e) {
      if (!["ai_pool_empty", "ai_workspace_capacity"].includes(e.code)) throw e;
      await this.later(q, 60);
    }
  }
  async finish(q, run, remote, started) {
    requireThat(
      typeof remote.billable === "boolean",
      "ai_billing_unknown",
      409,
    );
    if (remote.billable)
      requireThat(
        remote.credits === creditsFor(run.snapshot.data),
        "ai_billing_unknown",
        409,
      );
    const result =
      remote.status === "completed"
        ? publicResults(
            remote.results,
            run.snapshot.data.arms.map((a) => a.id),
          )
        : null;
    await this.tx(q, async (c) => {
      const r = (
        await c.query("SELECT * FROM ai_test_runs WHERE id=$1 FOR UPDATE", [
          run.id,
        ])
      ).rows[0];
      if (terminal(r.status)) return;
      const artifact = await saveArtifact(
        c,
        this.store,
        q.workspace_id,
        Buffer.from(JSON.stringify(remote)),
        { name: "AI测品-原始结果.json", kind: "evidence" },
      );
      await settle(c, r, { billable: remote.billable, started });
      await settleTestUse(c, r, remote.status === "completed");
      await c.query(
        "UPDATE ai_test_runs SET status=$2,result=$3,result_artifact_id=$4,error_code=$5,progress=$6,updated_at=now() WHERE id=$1",
        [
          run.id,
          remote.status,
          result,
          artifact.id,
          remote.status === "failed"
            ? remote.error_code || "ai_upstream_failed"
            : null,
          remote.progress || null,
        ],
      );
      await c.query("DELETE FROM ai_test_dispatch WHERE id=$1", [run.id]);
    });
  }
}
