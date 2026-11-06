import { z } from "zod";
import { id, uuid, digest, requireThat } from "../common/core.mjs";
import { assertWorkspaceAccess } from "../accounts/account-policy.mjs";
import { saveArtifact } from "../files/artifacts.mjs";
import {
  DraftInput,
  emptyDraft,
  candidateDraft,
  importedArm,
  effectiveArm,
  testSpec,
  creditsFor,
  confirmationDigest,
  captureIdentity,
  terminal,
  MARKETS,
} from "./contract.mjs";
import { candidateSource } from "./source.mjs";
import { eligibleAccounts, reserve } from "./pool.mjs";
import { reserveTestUse } from "./quota.mjs";
import { sdkCall } from "./sdk.mjs";
import { inspectImage, cropImage } from "./images.mjs";
import { fullReport, queueReport, publicPresentation } from "./report.mjs";
import { publicPdf, queuePdf } from "./pdf.mjs";

import {
  queueSuggestions,
  publicSuggestions,
  queueSuggestionTranslation,
} from "./suggestions.mjs";
import { applySuggestions } from "./suggestion-contract.mjs";
const versioned = z.object({ version: z.number().int().positive() });
export async function getDraft(c, draftId, lock = false) {
  const d = (
    await c.query(
      `SELECT * FROM ai_test_drafts WHERE id=$1 AND archived_at IS NULL ${lock ? "FOR UPDATE" : ""}`,
      [uuid.parse(draftId)],
    )
  ).rows[0];
  requireThat(d, "ai_draft_missing", 404);
  return d;
}
export async function selectedImages(c, draft) {
  const images = [];
  for (const arm of draft.data.arms) {
    const row = (
      await c.query(
        `SELECT i.*,a.sha256,a.object_key,a.mime FROM ai_test_images i JOIN artifacts a ON a.id=i.artifact_id WHERE i.id=$1 AND i.draft_id=$2 AND i.arm=$3 AND i.state='ready'`,
        [arm.image_id, draft.id, arm.id],
      )
    ).rows[0];
    requireThat(row, "ai_image_required", 409);
    requireThat(
      row.request.identity ===
        captureIdentity(draft.data, effectiveArm(draft.data, arm)),
      "ai_image_stale",
      409,
    );
    images.push(row);
  }
  const widths = images.map((i) => i.metadata.viewport?.width).filter(Boolean);
  requireThat(new Set(widths).size <= 1, "ai_viewport_mismatch", 409);
  return images;
}
export function publicRun(r) {
  return {
    id: r.id,
    draft_id: r.draft_id,
    status: r.status,
    quota_state: r.quota_state,
    progress: r.progress,
    result: r.result
      ? Object.fromEntries(
          [
            "is_simulation",
            "schema_version",
            "sample",
            "arms",
            "comparisons",
            "data_gaps",
            "scope_warnings",
          ]
            .filter((k) => Object.hasOwn(r.result, k))
            .map((k) => [k, r.result[k]]),
        )
      : null,
    error_code: r.error_code,
    cancel_requested: r.cancel_requested,
    created_at: r.created_at,
    updated_at: r.updated_at,
    configuration: r.snapshot?.data,
    confirmed_at: r.snapshot?.confirmed_at,
    images: r.snapshot?.images.map((i) => ({
      arm: i.arm,
      artifact_id: i.artifact_id,
    })),
  };
}
async function replace(c, d, data) {
  await c.query(
    "UPDATE ai_test_drafts SET data=$2,version=version+1,confirmed_digest=NULL,confirmed_by=NULL,confirmed_at=NULL,updated_at=now() WHERE id=$1",
    [d.id, data],
  );
  return getDraft(c, d.id);
}
async function keyFor(secrets, a) {
  return secrets.read(a.secret_ref, `ai-test:${a.id}:${a.secret_version}`);
}
export function installAiTesting(
  app,
  db,
  store,
  secrets,
  { sdk = sdkCall } = {},
) {
  const user = { preHandler: app.user };
  const report = (prepare) => (req) =>
    db.tenant(req.workspace, async (c) => {
      const r = (
        await c.query(
          `SELECT * FROM ai_test_runs WHERE id=$1 ${prepare ? "FOR UPDATE" : ""}`,
          [uuid.parse(req.params.id)],
        )
      ).rows[0];
      requireThat(r, "ai_report_missing", 404);
      if (prepare)
        await assertWorkspaceAccess(c, req.workspace, req.identity.id);
      const result = await (prepare ? queueReport : fullReport)(c, store, r);
      return {
        ...publicRun(r),
        result: {
          ...result,
          presentation_zh: publicPresentation(result.presentation_zh),
        },
      };
    });
  app.get("/api/ai-tests/runs/:id/report", user, report(false));
  app.post("/api/ai-tests/runs/:id/report", user, report(true));
  const pdf = (prepare) => (req) =>
    db.tenant(req.workspace, async (c) => {
      const run = (
        await c.query(
          `SELECT * FROM ai_test_runs WHERE id=$1 ${prepare ? "FOR UPDATE" : ""}`,
          [uuid.parse(req.params.id)],
        )
      ).rows[0];
      requireThat(run?.status === "completed", "ai_report_missing", 404);
      if (prepare) {
        await assertWorkspaceAccess(c, req.workspace, req.identity.id);
        return queuePdf(c, store, run);
      }
      return publicPdf(run);
    });
  app.get("/api/ai-tests/runs/:id/report/pdf", user, pdf(false));
  app.post("/api/ai-tests/runs/:id/report/pdf", user, pdf(true));
  app.get("/api/ai-tests", user, (req) =>
    db.tenant(req.workspace, async (c) => ({
      drafts: (
        await c.query(
          "SELECT id,version,data,created_at,updated_at,confirmed_at,archived_at FROM ai_test_drafts WHERE (archived_at IS NOT NULL)=$1 ORDER BY updated_at DESC LIMIT 200",
          [req.query.archived === "1"],
        )
      ).rows,
      runs: (
        await c.query(
          "SELECT * FROM ai_test_runs ORDER BY created_at DESC LIMIT 100",
        )
      ).rows.map(publicRun),
    })),
  );
  app.post("/api/ai-tests/:id/archive", user, (req) =>
    db.tenant(req.workspace, async (c) => {
      const v = versioned.strict().parse(req.body);
      const d = await getDraft(c, req.params.id, true);
      requireThat(d.version === v.version, "ai_version_changed", 409);
      requireThat(
        !(
          await c.query(
            "SELECT 1 FROM ai_test_runs WHERE draft_id=$1 AND status NOT IN('completed','failed','cancelled')",
            [d.id],
          )
        ).rowCount,
        "ai_draft_busy",
        409,
      );
      await c.query(
        "UPDATE ai_test_drafts SET archived_at=now(),import_key=NULL,version=version+1,updated_at=now() WHERE id=$1",
        [d.id],
      );
      return { ok: true };
    }),
  );
  app.post("/api/ai-tests/:id/restore", user, (req) =>
    db.tenant(req.workspace, async (c) => {
      requireThat(
        (
          await c.query(
            "UPDATE ai_test_drafts SET archived_at=NULL,version=version+1,updated_at=now() WHERE id=$1 AND archived_at IS NOT NULL RETURNING id",
            [uuid.parse(req.params.id)],
          )
        ).rowCount,
        "ai_draft_missing",
        404,
      );
      return { ok: true };
    }),
  );
  app.get("/api/ai-tests/candidates", user, (req) =>
    db.tenant(req.workspace, async (c) => {
      const reports = (
        await c.query(
          "SELECT id,data FROM records WHERE kind='report' AND data ? 'candidates_artifact_id' ORDER BY updated_at DESC LIMIT 30",
        )
      ).rows;
      const items = [];
      for (const r of reports) {
        const a = (
          await c.query("SELECT * FROM artifacts WHERE id=$1", [
            r.data.candidates_artifact_id,
          ])
        ).rows[0];
        if (!a) continue;
        for (const p of JSON.parse(
          (await store.read(a.object_key, a.sha256)).toString(),
        ))
          items.push({
            report_id: r.id,
            product_id: p.product_id,
            title: p.title,
            keywords: Array.isArray(p.keywords)
              ? p.keywords.filter((x) => typeof x === "string").slice(0, 30)
              : [],
            market: p.market || r.data.market,
            platform: p.platform || r.data.platform || "tiktok",
          });
      }
      return { items };
    }),
  );
  app.post("/api/ai-tests", user, (req) =>
    db.tenant(req.workspace, async (c) => {
      const data = emptyDraft(),
        draftId = id();
      await c.query(
        "INSERT INTO ai_test_drafts(id,workspace_id,created_by,data) VALUES($1,$2,$3,$4)",
        [draftId, req.workspace, req.identity.id, data],
      );
      return getDraft(c, draftId);
    }),
  );
  app.post("/api/ai-tests/import", user, async (req) => {
    const refs = z
      .object({
        items: z
          .array(
            z
              .object({
                report_id: uuid,
                product_id: z.string().min(1).max(100),
              })
              .strict(),
          )
          .min(1)
          .max(100),
      })
      .strict()
      .parse(req.body);
    return db.tenant(req.workspace, async (c) => {
      const items = [];
      for (const ref of refs.items) {
        const source = await candidateSource(
            c,
            store,
            ref.report_id,
            ref.product_id,
          ),
          importKey = digest(ref),
          draftId = id();
        await c.query(
          `INSERT INTO ai_test_drafts(id,workspace_id,created_by,data,sources,import_key) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(workspace_id,import_key) DO NOTHING`,
          [
            draftId,
            req.workspace,
            req.identity.id,
            candidateDraft(source.candidate, source.market, source.platform),
            { A: source },
            importKey,
          ],
        );
        const imported = (
          await c.query(
            "SELECT * FROM ai_test_drafts WHERE import_key=$1 FOR UPDATE",
            [importKey],
          )
        ).rows[0];
        if (!imported.archived_at)
          await queueSuggestions(c, imported, "A", req.identity.id);
        items.push({ id: imported.id });
      }
      return { items };
    });
  });
  app.get("/api/ai-tests/:id", user, (req) =>
    db.tenant(req.workspace, async (c) => {
      const draft = await getDraft(c, req.params.id);
      return {
        draft,
        suggestions: await publicSuggestions(c, draft),
        images: (
          await c.query(
            "SELECT id,arm,state,metadata,error_code,artifact_id,full_artifact_id,created_at FROM ai_test_images WHERE draft_id=$1 ORDER BY created_at DESC",
            [req.params.id],
          )
        ).rows,
        runs: (
          await c.query(
            "SELECT * FROM ai_test_runs WHERE draft_id=$1 ORDER BY created_at DESC",
            [req.params.id],
          )
        ).rows.map(publicRun),
      };
    }),
  );
  app.put("/api/ai-tests/:id", user, (req) =>
    db.tenant(req.workspace, async (c) => {
      const v = versioned.extend({ data: DraftInput }).strict().parse(req.body),
        d = await getDraft(c, req.params.id, true);
      requireThat(d.version === v.version, "ai_version_changed", 409);
      for (const a of v.data.arms)
        if (a.image_id)
          requireThat(
            (
              await c.query(
                "SELECT 1 FROM ai_test_images WHERE id=$1 AND draft_id=$2 AND arm=$3 AND state='ready'",
                [a.image_id, d.id, a.id],
              )
            ).rowCount,
            "ai_image_required",
            409,
          );
      return replace(c, d, v.data);
    }),
  );
  app.post("/api/ai-tests/:id/arm-import", user, (req) =>
    db.tenant(req.workspace, async (c) => {
      const v = versioned
          .extend({
            arm: z.string().regex(/^[A-F]$/),
            report_id: uuid,
            product_id: z.string().min(1).max(100),
          })
          .strict()
          .parse(req.body),
        d = await getDraft(c, req.params.id, true);
      requireThat(d.version === v.version, "ai_version_changed", 409);
      const source = await candidateSource(c, store, v.report_id, v.product_id),
        index = d.data.arms.findIndex((a) => a.id === v.arm);
      requireThat(index >= 0, "ai_arm_missing");
      const market = `${source.platform}_${{ US: "us", GB: "uk", UK: "uk", JP: "jp" }[source.market] || source.market.toLowerCase()}`;
      requireThat(market === d.data.market, "ai_market_mismatch", 409);
      d.data.arms[index] = importedArm(source.candidate, source.market, v.arm);
      if (d.sources[v.arm])
        d.sources.history = [
          ...(d.sources.history || []),
          {
            arm: v.arm,
            source: d.sources[v.arm],
            replaced_at: new Date().toISOString(),
          },
        ];
      requireThat(
        (d.sources.history?.length || 0) <= 100,
        "ai_source_history_limit",
        409,
      );
      d.sources[v.arm] = source;
      await c.query("UPDATE ai_test_drafts SET sources=$2 WHERE id=$1", [
        d.id,
        d.sources,
      ]);
      const updated = await replace(c, d, d.data);
      await queueSuggestions(c, updated, v.arm, req.identity.id);
      return updated;
    }),
  );
  app.post("/api/ai-tests/:id/suggestions", user, (req) =>
    db.tenant(req.workspace, async (c) => {
      const v = versioned
        .extend({ arm: z.string().regex(/^[A-F]$/) })
        .strict()
        .parse(req.body);
      const d = await getDraft(c, req.params.id, true);
      requireThat(d.version === v.version, "ai_version_changed", 409);
      await queueSuggestions(c, d, v.arm, req.identity.id, true);
      return { suggestions: await publicSuggestions(c, d) };
    }),
  );
  app.post("/api/ai-tests/:id/translate-suggestions", user, (req) =>
    db.tenant(req.workspace, async (c) => {
      const v = z
        .object({
          suggestion_id: uuid,
          retry: z.boolean().default(false),
          version: z.number().int().optional(),
        })
        .strict()
        .parse(req.body);
      const d = await getDraft(c, req.params.id, true);
      await queueSuggestionTranslation(
        c,
        d,
        v.suggestion_id,
        req.identity.id,
        v.retry,
      );
      return { suggestions: await publicSuggestions(c, d) };
    }),
  );
  app.post("/api/ai-tests/:id/apply-suggestions", user, (req) =>
    db.tenant(req.workspace, async (c) => {
      const v = versioned
        .extend({
          suggestion_id: uuid,
          values: z
            .record(z.string(), z.unknown())
            .refine(
              (x) => Object.keys(x).length > 0 && Object.keys(x).length <= 16,
            ),
        })
        .strict()
        .parse(req.body);
      const d = await getDraft(c, req.params.id, true);
      requireThat(d.version === v.version, "ai_version_changed", 409);
      const row = (
        await c.query(
          "SELECT * FROM ai_test_suggestions WHERE id=$1 AND draft_id=$2 FOR UPDATE",
          [v.suggestion_id, d.id],
        )
      ).rows[0];
      requireThat(row, "ai_suggestion_missing", 404);
      const outcome = applySuggestions(d, row, v.values);
      await c.query(
        "UPDATE ai_test_suggestions SET applied=applied || $2::jsonb,updated_at=now() WHERE id=$1",
        [row.id, JSON.stringify(outcome.applied)],
      );
      const updated = Object.keys(outcome.applied).length
        ? await replace(c, d, d.data)
        : d;
      return { draft: updated, ...outcome };
    }),
  );
  // Keep the authenticated route so already-open clients receive a clear refusal.
  app.post("/api/ai-tests/:id/capture", user, () => {
    requireThat(false, "ai_capture_disabled", 409);
  });
  app.post(
    "/api/ai-tests/:id/image",
    { ...user, bodyLimit: 8 * 1024 * 1024 },
    async (req) => {
      const v = versioned
        .extend({
          arm: z.string().regex(/^[A-F]$/),
          data: z.string().max(7 * 1024 * 1024),
        })
        .strict()
        .parse(req.body);
      const bytes = Buffer.from(v.data, "base64"),
        metadata = await inspectImage(bytes);
      return db.tenant(req.workspace, async (c) => {
        const d = await getDraft(c, req.params.id, true);
        requireThat(d.version === v.version, "ai_version_changed", 409);
        const arm = d.data.arms.find((a) => a.id === v.arm);
        requireThat(arm, "ai_arm_missing");
        const imageId = id(),
          effective = effectiveArm(d.data, arm),
          request = {
            url: effective.url,
            identity: captureIdentity(d.data, effective),
          };
        const a = await saveArtifact(c, store, req.workspace, bytes, {
          name: `AI测品-${arm.id}.${metadata.format}`,
          mime: metadata.mime,
          kind: "ai-test-image",
        });
        await c.query(
          "INSERT INTO ai_test_images(id,workspace_id,draft_id,arm,state,request,artifact_id,metadata) VALUES($1,$2,$3,$4,'ready',$5,$6,$7)",
          [
            imageId,
            req.workspace,
            d.id,
            arm.id,
            request,
            a.id,
            {
              ...metadata,
              manual: true,
              captured_at: new Date().toISOString(),
              source_url: effective.url,
            },
          ],
        );
        arm.image_id = imageId;
        return replace(c, d, d.data);
      });
    },
  );
  app.post("/api/ai-tests/:id/crop", user, async (req) => {
    const v = versioned
      .extend({
        arm: z.string().regex(/^[A-F]$/),
        image_id: uuid,
        left: z.number().int().min(0),
        top: z.number().int().min(0),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      })
      .strict()
      .parse(req.body);
    return db.tenant(req.workspace, async (c) => {
      const d = await getDraft(c, req.params.id, true);
      requireThat(d.version === v.version, "ai_version_changed", 409);
      const arm = d.data.arms.find((a) => a.id === v.arm);
      requireThat(arm, "ai_arm_missing");
      const old = (
        await c.query(
          `SELECT i.*,a.object_key,a.sha256 FROM ai_test_images i JOIN artifacts a ON a.id=COALESCE(i.full_artifact_id,i.artifact_id) WHERE i.id=$1 AND i.draft_id=$2 AND i.arm=$3 AND i.state='ready'`,
          [v.image_id, d.id, v.arm],
        )
      ).rows[0];
      requireThat(old, "ai_image_required");
      const bytes = await cropImage(
          await store.read(old.object_key, old.sha256),
          { left: v.left, top: v.top, width: v.width, height: v.height },
        ),
        meta = await inspectImage(bytes),
        imageId = id(),
        a = await saveArtifact(c, store, req.workspace, bytes, {
          name: `AI测品-${arm.id}.jpeg`,
          mime: meta.mime,
          kind: "ai-test-image",
        });
      await c.query(
        "INSERT INTO ai_test_images(id,workspace_id,draft_id,arm,state,request,artifact_id,full_artifact_id,metadata) VALUES($1,$2,$3,$4,'ready',$5,$6,$7,$8)",
        [
          imageId,
          req.workspace,
          d.id,
          arm.id,
          old.request,
          a.id,
          old.full_artifact_id || old.artifact_id,
          {
            ...old.metadata,
            ...meta,
            crop: {
              left: v.left,
              top: v.top,
              width: v.width,
              height: v.height,
            },
          },
        ],
      );
      arm.image_id = imageId;
      return replace(c, d, d.data);
    });
  });
  async function review(workspace, draftId) {
    return db.tenant(workspace, async (c) => {
      const draft = await getDraft(c, draftId),
        images = await selectedImages(c, draft),
        spec = testSpec(draft.data, { partner_product_id: draft.id });
      return {
        draft,
        images,
        spec,
        digest: confirmationDigest(draft, images),
        credits: creditsFor(draft.data),
      };
    });
  }
  app.get("/api/ai-tests/:id/review", user, async (req) => {
    const r = await review(req.workspace, req.params.id);
    return {
      version: r.draft.version,
      digest: r.digest,
      spec: r.spec,
      credits: r.credits,
      images: r.images.map((i) => ({
        arm: i.arm,
        id: i.id,
        artifact_id: i.artifact_id,
        metadata: i.metadata,
      })),
      effective_arms: r.draft.data.arms.map((a) =>
        effectiveArm(r.draft.data, a),
      ),
    };
  });
  app.post("/api/ai-tests/:id/estimate", user, async (req) => {
    const r = await review(req.workspace, req.params.id),
      accounts = await db.tx(null, (c) => eligibleAccounts(c, r.credits));
    for (const a of accounts) {
      try {
        const estimate = await sdk({
          action: "estimate",
          key: await keyFor(secrets, a),
          spec: r.spec,
        });
        if (
          Number.isFinite(estimate.quota?.remaining) &&
          estimate.quota.remaining < r.credits
        )
          continue;
        return { digest: r.digest, estimate };
      } catch (e) {
        if (!["ai_quota_exceeded", "ai_free_tier_limit"].includes(e.code))
          throw e;
      }
    }
    requireThat(false, "ai_pool_empty", 409);
  });
  app.post("/api/ai-tests/:id/audience", user, async (req) => {
    const { market } = z
      .object({ market: z.enum(MARKETS) })
      .strict()
      .parse(req.body);
    await db.tenant(req.workspace, (c) => getDraft(c, req.params.id));
    const a = await db.tx(null, async (c) => (await eligibleAccounts(c, 1))[0]);
    requireThat(a, "ai_pool_empty", 409);
    return sdk({ action: "audience", market, key: await keyFor(secrets, a) });
  });
  app.post("/api/ai-tests/:id/submit", user, (req) =>
    db.tenant(req.workspace, async (c) => {
      const v = z
          .object({
            version: z.number().int().positive(),
            digest: z.string().length(64),
            confirmed: z.literal(true),
          })
          .strict()
          .parse(req.body),
        d = await getDraft(c, req.params.id, true);
      requireThat(d.version === v.version, "ai_version_changed", 409);
      await assertWorkspaceAccess(c, req.workspace, req.identity.id);
      const images = await selectedImages(c, d),
        hash = confirmationDigest(d, images);
      requireThat(v.digest === hash, "ai_confirmation_stale", 409);
      const old = (
        await c.query(
          "SELECT * FROM ai_test_runs WHERE draft_id=$1 AND confirmation_digest=$2",
          [d.id, hash],
        )
      ).rows[0];
      if (old) return publicRun(old);
      const runId = id(),
        spec = testSpec(d.data, { partner_product_id: runId }),
        snapshot = {
          data: d.data,
          sources: d.sources,
          spec,
          images,
          version: d.version,
          confirmed_by: req.identity.id,
          confirmed_at: new Date().toISOString(),
        };
      let run = (
        await c.query(
          "INSERT INTO ai_test_runs(id,workspace_id,draft_id,created_by,confirmation_digest,snapshot,status) VALUES($1,$2,$3,$4,$5,$6,'queued') RETURNING *",
          [runId, req.workspace, d.id, req.identity.id, hash, snapshot],
        )
      ).rows[0];
      await reserve(c, run, creditsFor(d.data));
      await reserveTestUse(c, run);
      await c.query(
        "INSERT INTO ai_test_dispatch(id,workspace_id,kind) VALUES($1,$2,'run')",
        [runId, req.workspace],
      );
      await c.query(
        "UPDATE ai_test_drafts SET confirmed_digest=$2,confirmed_by=$3,confirmed_at=now() WHERE id=$1",
        [d.id, hash, req.identity.id],
      );
      return publicRun(
        (await c.query("SELECT * FROM ai_test_runs WHERE id=$1", [runId]))
          .rows[0],
      );
    }),
  );
  app.post("/api/ai-tests/runs/:id/cancel", user, (req) =>
    db.tenant(req.workspace, async (c) => {
      const r = (
        await c.query("SELECT * FROM ai_test_runs WHERE id=$1 FOR UPDATE", [
          uuid.parse(req.params.id),
        ])
      ).rows[0];
      requireThat(r, "ai_run_missing", 404);
      requireThat(!terminal(r.status), "ai_not_cancellable", 409);
      await c.query(
        "UPDATE ai_test_runs SET cancel_requested=true,updated_at=now() WHERE id=$1",
        [r.id],
      );
      await c.query(
        "UPDATE ai_test_dispatch SET available_at=now() WHERE id=$1",
        [r.id],
      );
      return { ok: true };
    }),
  );
  app.post("/api/ai-tests/runs/:id/retest", user, (req) =>
    db.tenant(req.workspace, async (c) => {
      const r = (
        await c.query("SELECT * FROM ai_test_runs WHERE id=$1", [
          uuid.parse(req.params.id),
        ])
      ).rows[0];
      requireThat(r, "ai_run_missing", 404);
      const draftId = id(),
        data = structuredClone(r.snapshot.data);
      data.name = ("复测 · " + data.name).slice(0, 200);
      for (const arm of data.arms) {
        const old = r.snapshot.images.find((i) => i.arm === arm.id),
          imageId = id();
        arm.image_id = imageId;
        /* insert images after parent below */ if (old) old.nextId = imageId;
      }
      await c.query(
        "INSERT INTO ai_test_drafts(id,workspace_id,created_by,data,sources) VALUES($1,$2,$3,$4,$5)",
        [
          draftId,
          req.workspace,
          req.identity.id,
          data,
          { ...r.snapshot.sources, parent_run_id: r.id },
        ],
      );
      for (const image of r.snapshot.images)
        await c.query(
          "INSERT INTO ai_test_images(id,workspace_id,draft_id,arm,state,request,artifact_id,full_artifact_id,metadata) VALUES($1,$2,$3,$4,'ready',$5,$6,$7,$8)",
          [
            image.nextId,
            req.workspace,
            draftId,
            image.arm,
            image.request,
            image.artifact_id,
            image.full_artifact_id,
            image.metadata,
          ],
        );
      return getDraft(c, draftId);
    }),
  );
}
