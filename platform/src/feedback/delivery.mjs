import { id } from "../common/core.mjs";
import { accountTx } from "../customers/profile.mjs";
import { categories } from "./contract.mjs";
import { BRAND_NAME, BRAND_TAGLINE } from "../../web/lib/brand.mjs";
export class FeedbackDelivery {
  constructor({ db, store, mailer }) {
    Object.assign(this, { db, store, mailer });
  }
  async plan() {
    return accountTx(
      this.db,
      null,
      async (c) => {
        const config = (
          await c.query(
            "SELECT * FROM feedback_mail_settings WHERE id=true AND enabled",
          )
        ).rows[0];
        if (!config) return false;
        const f = (
          await c.query(
            "SELECT id FROM customer_feedback WHERE notification_planned_at IS NULL ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
          )
        ).rows[0];
        if (!f) return false;
        for (const email of new Set([
          config.owner_email,
          ...config.sales_emails,
        ]))
          await c.query(
            "INSERT INTO feedback_deliveries(id,feedback_id,recipient) VALUES($1,$2,$3) ON CONFLICT(feedback_id,recipient) DO NOTHING",
            [id(), f.id, email],
          );
        await c.query(
          "UPDATE customer_feedback SET notification_planned_at=now() WHERE id=$1",
          [f.id],
        );
        return true;
      },
      true,
    );
  }
  async once() {
    const planned = await this.plan();
    const delivery = await this.db.tx(null, async (c) => {
      // Once SMTP may have accepted DATA, a crashed worker must never blindly send again.
      await c.query(
        "UPDATE feedback_deliveries SET state='uncertain',error_code='feedback_delivery_uncertain',lease_until=NULL,lease_token=NULL,updated_at=now() WHERE state='sending' AND lease_until<now()",
      );
      const row = (
        await c.query(
          "SELECT * FROM feedback_deliveries WHERE (kind='test' OR EXISTS(SELECT 1 FROM feedback_mail_settings WHERE id=true AND enabled)) AND (state='pending' OR (state='failed' AND attempts<3)) AND available_at<=now() ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT 1",
        )
      ).rows[0];
      if (!row) return null;
      const token = id();
      await c.query(
        "UPDATE feedback_deliveries SET state='sending',attempts=attempts+1,lease_token=$2,lease_until=now()+interval '2 minutes',updated_at=now() WHERE id=$1",
        [row.id, token],
      );
      return { ...row, lease_token: token, attempts: row.attempts + 1 };
    });
    if (!delivery) return planned;
    let result = "accepted",
      error = null,
      messageId = null,
      enteredSend = false;
    try {
      let subject = `${BRAND_NAME} 客户反馈测试邮件`,
        text = `这是一封反馈通知测试邮件，包含一个测试附件。\n\n${BRAND_NAME} · ${BRAND_TAGLINE}`,
        replyTo,
        attachments = [
          {
            filename: "反馈通知测试.txt",
            content: Buffer.from(`${BRAND_NAME} 本地/平台邮件配置测试附件。`),
            contentType: "text/plain",
          },
        ];
      if (delivery.kind === "feedback") {
        const data = await accountTx(
          this.db,
          null,
          async (c) => ({
            f: (
              await c.query("SELECT * FROM customer_feedback WHERE id=$1", [
                delivery.feedback_id,
              ])
            ).rows[0],
            files: (
              await c.query(
                "SELECT * FROM feedback_files WHERE feedback_id=$1 ORDER BY created_at,id",
                [delivery.feedback_id],
              )
            ).rows,
          }),
          true,
        );
        if (!data.f) throw new Error("missing_feedback");
        const f = data.f;
        replyTo = f.email_snapshot;
        subject = `${BRAND_NAME} [客户反馈 ${f.id.slice(0, 8)}] ${f.title}`;
        text = [
          `反馈编号：${f.id}`,
          `客户邮箱：${f.email_snapshot}`,
          `联系人：${f.contact_snapshot.contact_name}`,
          `公司：${f.contact_snapshot.company_name || "未填写"}`,
          `电话：${f.contact_snapshot.phone || "未填写"}`,
          `类型：${categories[f.category]}`,
          `提交时间：${new Date(f.created_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}（北京时间）`,
          `关联页面：${f.context?.title || f.context?.id || "未关联"}`,
          "",
          f.description,
          "",
          `附件：${data.files.length} 个`,
          "",
          `${BRAND_NAME} · ${BRAND_TAGLINE}`,
        ].join("\n");
        attachments = [];
        for (const file of data.files)
          attachments.push({
            filename: file.name,
            contentType: file.mime,
            content: await this.store.read(file.object_key, file.sha256),
          });
      }
      enteredSend = true;
      const receipt = await this.mailer.sendFeedback({
        email: delivery.recipient,
        replyTo,
        subject,
        text,
        attachments,
        deliveryId: delivery.id,
      });
      messageId = receipt?.messageId || null;
    } catch (e) {
      result =
        enteredSend && e.code !== "feedback_mail_rejected"
          ? "uncertain"
          : "failed";
      error =
        result === "uncertain"
          ? "feedback_delivery_uncertain"
          : "feedback_mail_failed";
    }
    await this.db.query(
      "UPDATE feedback_deliveries SET state=$3,error_code=$4,message_id=$5,available_at=now()+($6*interval '1 minute'),lease_until=NULL,lease_token=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2 AND state='sending'",
      [
        delivery.id,
        delivery.lease_token,
        result,
        error,
        messageId,
        delivery.attempts === 1 ? 1 : 5,
      ],
    );
    return true;
  }
}
