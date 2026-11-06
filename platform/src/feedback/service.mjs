import { z } from "zod";
import { id, uuid, digest, requireThat, AppError } from "../common/core.mjs";
import { accountTx } from "../customers/profile.mjs";
import { ACTIVITY_PAGES } from "../customers/activity.mjs";
import {
  FeedbackInput,
  TOTAL_LIMIT,
  publicFile,
  notificationState,
} from "./contract.mjs";
import { validateFeedbackFile } from "./files.mjs";

export async function feedbackDetail(c, feedbackId, admin = false) {
  const row = (
    await c.query("SELECT * FROM customer_feedback WHERE id=$1", [feedbackId])
  ).rows[0];
  requireThat(row, "feedback_not_found", 404);
  const files = (
    await c.query(
      "SELECT id,name,mime,size_bytes FROM feedback_files WHERE feedback_id=$1 ORDER BY created_at,id",
      [feedbackId],
    )
  ).rows;
  const deliveries = (
    await c.query(
      "SELECT id,recipient,kind,state,attempts,error_code,created_at,updated_at FROM feedback_deliveries WHERE feedback_id=$1 ORDER BY created_at,id",
      [feedbackId],
    )
  ).rows;
  const { submission_digest, notification_planned_at, ...publicRow } = row;
  return {
    ...publicRow,
    attachments: files,
    mail_state: notificationState(
      deliveries,
      notification_planned_at ||
        (
          await c.query(
            "SELECT enabled FROM feedback_mail_settings WHERE id=true",
          )
        ).rows[0]?.enabled,
    ),
    ...(admin ? { deliveries } : {}),
  };
}
async function resolveContext(c, context, userId) {
  if (!context) return null;
  if (context.kind === "page") {
    requireThat(
      ACTIVITY_PAGES.includes(context.id),
      "feedback_context_invalid",
    );
    return { kind: "page", id: context.id };
  }
  requireThat(
    uuid.safeParse(context.id).success && context.workspace_id,
    "feedback_context_invalid",
  );
  requireThat(
    (
      await c.query(
        "SELECT 1 FROM memberships WHERE user_id=$1 AND workspace_id=$2",
        [userId, context.workspace_id],
      )
    ).rowCount,
    "workspace_forbidden",
    403,
  );
  await c.query("SELECT set_config('app.workspace_id',$1,true)", [
    context.workspace_id,
  ]);
  const sql = {
    job: "SELECT title FROM jobs WHERE id=$1",
    report:
      "SELECT data->>'title' AS title FROM records WHERE kind='report' AND id=$1",
    ai_test: "SELECT data->>'name' AS title FROM ai_test_drafts WHERE id=$1",
  }[context.kind];
  const row = (await c.query(sql, [context.id])).rows[0];
  requireThat(row, "feedback_context_invalid");
  return { ...context, title: row.title };
}
export function installFeedback(app, db, store) {
  app.post(
    "/api/feedback/files",
    {
      preHandler: app.account,
      bodyLimit: 8 * 1024 * 1024,
      config: {
        rateLimit: {
          hook: "preHandler",
          keyGenerator: (req) => req.identity.id,
          max: 20,
          timeWindow: "10 minutes",
        },
      },
    },
    async (req) => {
      const v = z
        .object({
          name: z.string().min(1).max(200),
          data: z.string().max(7 * 1024 * 1024),
        })
        .strict()
        .parse(req.body);
      let file;
      try {
        file = await validateFeedbackFile(v.name, v.data);
      } catch (e) {
        if (e instanceof AppError) throw e;
        throw new AppError("feedback_file_invalid", 400);
      }
      return accountTx(db, req.identity.id, async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          "feedback-upload:" + req.identity.id,
        ]);
        const size = (
          await c.query(
            "SELECT COALESCE(sum(size_bytes),0)::bigint AS n FROM feedback_files WHERE user_id=$1 AND created_at>now()-interval '1 day'",
            [req.identity.id],
          )
        ).rows[0].n;
        requireThat(
          Number(size) + file.bytes.length <= 50 * 1024 * 1024,
          "feedback_upload_capacity",
          429,
        );
        const saved = await store.put(req.identity.id, file.bytes);
        const row = (
          await c.query(
            "INSERT INTO feedback_files(id,user_id,object_key,sha256,size_bytes,name,mime) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",
            [
              id(),
              req.identity.id,
              saved.object_key,
              saved.sha256,
              saved.size_bytes,
              file.name,
              file.mime,
            ],
          )
        ).rows[0];
        return publicFile(row);
      });
    },
  );
  for (const admin of [false, true])
    app.get(
      admin ? "/api/admin/feedback/files/:id" : "/api/feedback/files/:id",
      { preHandler: admin ? app.admin : app.account },
      async (req, reply) => {
        const file = await accountTx(
          db,
          req.identity.id,
          async (c) =>
            (
              await c.query("SELECT * FROM feedback_files WHERE id=$1", [
                uuid.parse(req.params.id),
              ])
            ).rows[0],
          admin,
        );
        requireThat(file, "feedback_file_not_found", 404);
        const bytes = await store.read(file.object_key, file.sha256);
        reply
          .header(
            "Content-Disposition",
            `${req.query.preview === "1" && file.mime.startsWith("image/") ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
          )
          .header("X-Content-Type-Options", "nosniff")
          .header("Content-Security-Policy", "sandbox; default-src 'none'")
          .type(file.mime);
        return reply.send(bytes);
      },
    );
  app.post(
    "/api/feedback",
    {
      preHandler: app.account,
      config: {
        rateLimit: {
          hook: "preHandler",
          keyGenerator: (req) => req.identity.id,
          max: 10,
          timeWindow: "1 hour",
        },
      },
    },
    (req) => {
      const v = FeedbackInput.parse(req.body);
      requireThat(
        req.identity.email && req.identity.email_verified_at,
        "feedback_email_required",
        409,
      );
      return accountTx(db, req.identity.id, async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          "feedback:" + req.identity.id + ":" + v.id,
        ]);
        const old = (
          await c.query(
            "SELECT submission_digest FROM customer_feedback WHERE id=$1",
            [v.id],
          )
        ).rows[0];
        if (old) {
          requireThat(
            old.submission_digest === digest(v),
            "feedback_submission_changed",
            409,
          );
          return feedbackDetail(c, v.id);
        }
        const context = await resolveContext(c, v.context, req.identity.id);
        const files = (
          await c.query(
            "SELECT * FROM feedback_files WHERE id=ANY($1::uuid[]) AND user_id=$2 FOR UPDATE",
            [v.attachments, req.identity.id],
          )
        ).rows;
        requireThat(
          files.length === v.attachments.length &&
            files.every((f) => !f.feedback_id),
          "feedback_file_not_found",
          409,
        );
        requireThat(
          files.reduce((n, f) => n + f.size_bytes, 0) <= TOTAL_LIMIT,
          "feedback_total_too_large",
          413,
        );
        const profile = (
          await c.query("SELECT data FROM customer_profiles WHERE user_id=$1", [
            req.identity.id,
          ])
        ).rows[0]?.data;
        const contact = {
          contact_name: profile?.contact_name || req.identity.display_name,
          company_name: profile?.company_name || "",
          phone: profile?.phone || "",
        };
        await c.query(
          "INSERT INTO customer_feedback(id,user_id,workspace_id,email_snapshot,contact_snapshot,category,title,description,context,submission_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
          [
            v.id,
            req.identity.id,
            context?.workspace_id || null,
            req.identity.email,
            contact,
            v.category,
            v.title,
            v.description,
            context,
            digest(v),
          ],
        );
        await c.query(
          "UPDATE feedback_files SET feedback_id=$1 WHERE id=ANY($2::uuid[]) AND user_id=$3",
          [v.id, v.attachments, req.identity.id],
        );
        return feedbackDetail(c, v.id);
      });
    },
  );
  app.get("/api/feedback", { preHandler: app.account }, (req) =>
    accountTx(db, req.identity.id, async (c) => {
      const page = z.coerce
        .number()
        .int()
        .min(1)
        .max(10000)
        .default(1)
        .parse(req.query.page);
      const rows = (
        await c.query(
          "SELECT id,title,category,status,created_at,updated_at FROM customer_feedback WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 21 OFFSET $2",
          [req.identity.id, (page - 1) * 20],
        )
      ).rows;
      return { items: rows.slice(0, 20), has_more: rows.length > 20, page };
    }),
  );
  app.get("/api/feedback/:id", { preHandler: app.account }, (req) =>
    accountTx(db, req.identity.id, (c) =>
      feedbackDetail(c, uuid.parse(req.params.id)),
    ),
  );
}
