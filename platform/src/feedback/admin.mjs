import { z } from "zod";
import { id, uuid, requireThat } from "../common/core.mjs";
import { accountTx } from "../customers/profile.mjs";
import { FeedbackMailConfig } from "./contract.mjs";
import { feedbackDetail } from "./service.mjs";
export function installFeedbackAdmin(app, db, mailer) {
  const admin = { preHandler: app.admin };
  app.get("/api/admin/feedback", admin, (req) =>
    accountTx(
      db,
      null,
      async (c) => {
        const q = z
          .object({
            page: z.coerce.number().int().min(1).max(10000).default(1),
            search: z.string().max(200).default(""),
            status: z
              .enum(["", "new", "processing", "resolved", "closed"])
              .default(""),
            user_id: uuid.optional(),
          })
          .parse(req.query);
        const rows = (
          await c.query(
            `SELECT f.id,f.title,f.category,f.status,f.created_at,f.email_snapshot,f.contact_snapshot,u.email AS current_email FROM customer_feedback f JOIN users u ON u.id=f.user_id WHERE ($1='' OR f.email_snapshot ILIKE '%'||$1||'%' OR u.email ILIKE '%'||$1||'%' OR f.title ILIKE '%'||$1||'%') AND ($2='' OR f.status=$2) AND ($3::uuid IS NULL OR f.user_id=$3) ORDER BY f.created_at DESC,f.id DESC LIMIT 21 OFFSET $4`,
            [q.search, q.status, q.user_id || null, (q.page - 1) * 20],
          )
        ).rows;
        return {
          items: rows.slice(0, 20),
          has_more: rows.length > 20,
          page: q.page,
        };
      },
      true,
    ),
  );
  app.get("/api/admin/feedback/:id", admin, (req) =>
    accountTx(
      db,
      null,
      (c) => feedbackDetail(c, uuid.parse(req.params.id), true),
      true,
    ),
  );
  app.put("/api/admin/feedback/:id", admin, (req) =>
    accountTx(
      db,
      null,
      async (c) => {
        const fid = uuid.parse(req.params.id),
          v = z
            .object({
              status: z.enum(["new", "processing", "resolved", "closed"]),
              public_reply: z.string().trim().max(3000),
            })
            .strict()
            .parse(req.body);
        requireThat(
          (
            await c.query(
              "UPDATE customer_feedback SET status=$2,public_reply=$3,updated_at=now() WHERE id=$1 RETURNING id",
              [fid, v.status, v.public_reply],
            )
          ).rowCount,
          "feedback_not_found",
          404,
        );
        await c.query(
          "INSERT INTO platform_audit(actor_id,action,target_id,summary) VALUES($1,'feedback.update',$2,$3)",
          [req.identity.id, fid, { status: v.status }],
        );
        return feedbackDetail(c, fid, true);
      },
      true,
    ),
  );
  app.get("/api/admin/feedback-mail", admin, async () => ({
    config:
      (
        await db.query(
          "SELECT enabled,owner_email,sales_emails,updated_at FROM feedback_mail_settings WHERE id=true",
        )
      ).rows[0] || null,
    smtp_ready: await mailer.ready(),
    deliveries: (
      await db.query(
        "SELECT id,feedback_id,recipient,kind,state,attempts,error_code,created_at,updated_at FROM feedback_deliveries ORDER BY created_at DESC,id DESC LIMIT 30",
      )
    ).rows,
  }));
  app.put("/api/admin/feedback-mail", admin, async (req) => {
    const v = FeedbackMailConfig.parse(req.body);
    if (v.enabled)
      requireThat(await mailer.ready(), "email_service_unavailable", 409);
    return db.tx(null, async (c) => {
      await c.query(
        "INSERT INTO feedback_mail_settings(id,enabled,owner_email,sales_emails) VALUES(true,$1,$2,$3) ON CONFLICT(id) DO UPDATE SET enabled=$1,owner_email=$2,sales_emails=$3,updated_at=now()",
        [
          v.enabled,
          v.owner_email,
          JSON.stringify([...new Set(v.sales_emails)]),
        ],
      );
      await c.query(
        "INSERT INTO platform_audit(actor_id,action,summary) VALUES($1,'feedback.mail.configure',$2)",
        [
          req.identity.id,
          {
            enabled: v.enabled,
            recipient_count: new Set([v.owner_email, ...v.sales_emails]).size,
          },
        ],
      );
      return { ok: true };
    });
  });
  app.post(
    "/api/admin/feedback-mail/test",
    {
      ...admin,
      config: {
        rateLimit: {
          hook: "preHandler",
          keyGenerator: (req) => req.identity.id,
          max: 3,
          timeWindow: "10 minutes",
        },
      },
    },
    async (req) => {
      requireThat(await mailer.ready(), "email_service_unavailable", 409);
      const row = (
        await db.query("SELECT * FROM feedback_mail_settings WHERE id=true")
      ).rows[0];
      requireThat(row, "feedback_mail_config_required", 409);
      return db.tx(null, async (c) => {
        const ids = [];
        for (const email of new Set([row.owner_email, ...row.sales_emails])) {
          const did = id();
          ids.push(did);
          await c.query(
            "INSERT INTO feedback_deliveries(id,recipient,kind) VALUES($1,$2,'test')",
            [did, email],
          );
        }
        await c.query(
          "INSERT INTO platform_audit(actor_id,action,summary) VALUES($1,'feedback.mail.test',$2)",
          [req.identity.id, { count: ids.length }],
        );
        return { queued: ids.length };
      });
    },
  );
  app.post("/api/admin/feedback-mail/:id/retry", admin, async (req) => {
    const v = z
      .object({ confirmed_not_received: z.boolean().default(false) })
      .strict()
      .parse(req.body || {});
    return db.tx(null, async (c) => {
      const row = (
        await c.query(
          "SELECT * FROM feedback_deliveries WHERE id=$1 FOR UPDATE",
          [uuid.parse(req.params.id)],
        )
      ).rows[0];
      requireThat(
        row && ["failed", "uncertain"].includes(row.state),
        "feedback_retry_invalid",
        409,
      );
      requireThat(
        row.state !== "uncertain" || v.confirmed_not_received,
        "feedback_delivery_uncertain",
        409,
      );
      await c.query(
        "UPDATE feedback_deliveries SET state='pending',available_at=now(),error_code=NULL,updated_at=now() WHERE id=$1",
        [row.id],
      );
      await c.query(
        "INSERT INTO platform_audit(actor_id,action,target_id,summary) VALUES($1,'feedback.mail.retry',$2,$3)",
        [
          req.identity.id,
          row.id,
          {
            previous_state: row.state,
            confirmed_not_received: v.confirmed_not_received,
          },
        ],
      );
      return { ok: true };
    });
  });
}
