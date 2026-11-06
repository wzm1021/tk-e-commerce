import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { z } from "zod";
import { id, requireThat, AppError } from "../common/core.mjs";
import { checkedEndpoint } from "./network.mjs";
import {
  BRAND_NAME,
  BRAND_TAGLINE,
  mailSenderName,
} from "../../web/lib/brand.mjs";

export const MailConfig = z
  .object({
    host: z
      .string()
      .trim()
      .regex(/^[a-zA-Z0-9.-]+$/)
      .max(253),
    port: z.union([z.literal(465), z.literal(587)]),
    user: z.string().trim().min(1).max(254),
    from: z.string().trim().email().max(254),
    from_name: z.string().trim().min(1).max(60).default(BRAND_NAME),
  })
  .strict();
export async function composeFeedbackMail({
  from,
  fromName,
  email,
  replyTo,
  subject,
  text,
  attachments,
  messageId,
}) {
  requireThat(
    attachments.every((a) => Buffer.isBuffer(a.content) && !a.path && !a.href),
    "feedback_mail_rejected",
    400,
  );
  const raw = await new MailComposer({
    from: { name: fromName, address: from },
    to: email,
    replyTo,
    subject,
    text,
    attachments,
    messageId,
    disableFileAccess: true,
    disableUrlAccess: true,
  })
    .compile()
    .build();
  requireThat(raw.length <= 20 * 1024 * 1024, "feedback_mail_rejected", 413);
  return raw;
}
export function createMailer(db, secrets) {
  async function transport(row) {
    const v = MailConfig.parse(row.config);
    await checkedEndpoint("https://" + v.host);
    const password = await secrets.read(
      row.secret_ref,
      "mail:" + row.version_id,
    );
    return nodemailer.createTransport({
      host: v.host,
      port: v.port,
      secure: v.port === 465,
      requireTLS: true,
      auth: { user: v.user, pass: password },
      tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
      disableFileAccess: true,
      disableUrlAccess: true,
      maxRecipients: 1,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
      logger: false,
      debug: false,
    });
  }
  return {
    async sendFeedback({
      email,
      replyTo,
      subject,
      text,
      attachments,
      deliveryId,
    }) {
      const row = (
        await db.query("SELECT * FROM mail_settings WHERE id=true AND enabled")
      ).rows[0];
      if (!row) throw new AppError("feedback_mail_rejected", 503);
      let client;
      let sending = false;
      try {
        client = await transport(row);
        const messageId = `<feedback-${deliveryId}@${row.config.from.split("@")[1]}>`;
        const raw = await composeFeedbackMail({
          from: row.config.from,
          fromName: mailSenderName(row.config.from_name),
          email,
          replyTo,
          subject,
          text,
          attachments,
          messageId,
        });
        sending = true;
        const sent = await client.sendMail({
          envelope: { from: row.config.from, to: [email] },
          raw,
        });
        requireThat(sent.accepted?.length === 1, "feedback_mail_rejected", 503);
        return { messageId };
      } catch (e) {
        const definite =
          !sending ||
          e.code === "feedback_mail_rejected" ||
          Number(e.responseCode) >= 400 ||
          ["CONN", "EHLO", "HELO", "AUTH", "MAIL FROM", "RCPT TO"].includes(
            e.command,
          );
        throw new AppError(
          definite ? "feedback_mail_rejected" : "feedback_delivery_uncertain",
          503,
        );
      } finally {
        client?.close();
      }
    },
    async ready() {
      return Boolean(
        (await db.query("SELECT enabled FROM mail_settings WHERE id=true"))
          .rows[0]?.enabled,
      );
    },
    async send({ email, code, purpose }) {
      const row = (
        await db.query("SELECT * FROM mail_settings WHERE id=true AND enabled")
      ).rows[0];
      requireThat(row, "email_service_unavailable", 503);
      const client = await transport(row);
      try {
        const label = {
          register: "注册账号",
          reset: "重置密码",
          bind: "绑定邮箱",
        }[purpose];
        const result = await client.sendMail({
          from: {
            name: mailSenderName(row.config.from_name),
            address: row.config.from,
          },
          to: email,
          subject: `${BRAND_NAME} ${label}验证码`,
          text: `你正在${label}。验证码：${code}\n验证码 10 分钟内有效，请勿转发。若非本人操作，请忽略。\n\n${BRAND_NAME} · ${BRAND_TAGLINE}`,
        });
        requireThat(
          result.accepted?.length === 1,
          "email_delivery_failed",
          503,
        );
      } catch {
        throw new AppError("email_delivery_failed", 503);
      } finally {
        client.close();
      }
    },
    install(app) {
      app.get("/api/admin/mail", { preHandler: app.admin }, async () => {
        const row = (
          await db.query(
            "SELECT config,enabled,updated_at FROM mail_settings WHERE id=true",
          )
        ).rows[0];
        return row || { config: null, enabled: false };
      });
      app.put("/api/admin/mail", { preHandler: app.admin }, async (req) => {
        const v = z
          .object({
            config: MailConfig,
            password: z.string().min(1).max(16000).optional(),
            enabled: z.boolean(),
          })
          .strict()
          .parse(req.body);
        await checkedEndpoint("https://" + v.config.host);
        const old = (
          await db.query("SELECT * FROM mail_settings WHERE id=true")
        ).rows[0];
        requireThat(v.password || old, "mail_password_required");
        const version = id(),
          password =
            v.password ||
            (await secrets.read(old.secret_ref, "mail:" + old.version_id));
        const ref = await secrets.write(password, "mail:" + version);
        // Verify authentication before enabling; this does not send an email.
        if (v.enabled) {
          const client = await transport({
            config: v.config,
            secret_ref: ref,
            version_id: version,
          });
          try {
            await client.verify();
          } catch {
            throw new AppError("email_connection_failed", 409);
          } finally {
            client.close();
          }
        }
        await db.tx(null, async (c) => {
          await c.query(
            `INSERT INTO mail_settings(id,version_id,config,secret_ref,enabled) VALUES(true,$1,$2,$3,$4)
            ON CONFLICT(id) DO UPDATE SET version_id=$1,config=$2,secret_ref=$3,enabled=$4,updated_at=now()`,
            [version, v.config, ref, v.enabled],
          );
          await c.query(
            "INSERT INTO platform_audit(actor_id,action,summary) VALUES($1,'mail.configure',$2)",
            [req.identity.id, { version_id: version, enabled: v.enabled }],
          );
        });
        return { ok: true };
      });
    },
  };
}
