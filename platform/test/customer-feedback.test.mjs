import test from "node:test";
import assert from "node:assert/strict";
import { id, AppError } from "../src/common/core.mjs";
import { CustomerProfile, accountTx } from "../src/customers/profile.mjs";
import { analyticsPeriod, runProducts } from "../src/customers/analytics.mjs";
import { emptyDraft } from "../src/ai-testing/contract.mjs";
import { validateFeedbackFile } from "../src/feedback/files.mjs";
import { FeedbackDelivery } from "../src/feedback/delivery.mjs";
import { aiFixture } from "./fixtures/ai-testing.mjs";
const profile = {
  company_name: "本地测试公司",
  address: "本地测试地址",
  contact_name: "测试联系人",
  phone: "+86 138 0000 0000",
  company_size: "6–20人",
  annual_revenue: "0",
  revenue_currency: "CNY",
  revenue_year: 2025,
};
test("registration profile requires all business fields except tax ID; zero revenue allowed", () => {
  assert.equal(CustomerProfile.parse(profile).tax_id, "");
  for (const key of Object.keys(profile)) {
    const copy = { ...profile };
    delete copy[key];
    assert.equal(CustomerProfile.safeParse(copy).success, false, key);
  }
  assert.equal(
    CustomerProfile.safeParse({ ...profile, annual_revenue: "-1" }).success,
    false,
  );
  assert.equal(
    CustomerProfile.safeParse({ ...profile, phone: "13800000000" }).success,
    false,
  );
});
test("analytics periods use Shanghai inclusive dates and reject invalid or oversized windows", () => {
  const p = analyticsPeriod({ start: "2026-01-01", end: "2026-01-07" });
  assert.equal(p.from, "2026-01-01T00:00:00+08:00");
  assert.equal(p.until, "2026-01-07T16:00:00.000Z");
  for (const q of [
    { start: "2026-02-30" },
    { start: "2024-01-01", end: "2026-01-01" },
    { start: "2026-02-01", end: "2026-01-01" },
  ])
    assert.throws(() => analyticsPeriod(q));
});
test("same-product arms deduplicate; distinct product B stays independent and missing links stay absent", () => {
  const data = emptyDraft();
  data.arms[0].url = "https://www.amazon.com/dp/B012345678";
  data.arms[0].product_id = "B012345678";
  let rows = runProducts({ id: id(), snapshot: { data } });
  assert.equal(rows[0].key, rows[1].key);
  data.arms[1].other_product = true;
  data.arms[1].product_id = "B012345679";
  rows = runProducts({ id: id(), snapshot: { data } });
  assert.notEqual(rows[0].key, rows[1].key);
  assert.equal(rows[1].url, null);
});
test("feedback attachments enforce type, actual bytes, size and office archive safety", async () => {
  const good = await validateFeedbackFile(
    "../操作说明.txt",
    Buffer.from("复现步骤：打开页面").toString("base64"),
  );
  assert.equal(good.name, "操作说明.txt");
  assert.equal(good.mime, "text/plain");
  for (const [name, bytes] of [
    ["x.exe", Buffer.from("MZ")],
    ["x.png", Buffer.from("not png")],
    ["x.txt", Buffer.from([0, 1, 2])],
    ["x.pdf", Buffer.from("%PDF-1.7\n/JavaScript 1\n%%EOF")],
    ["x.docx", Buffer.from("PK fake")],
    ["x.txt", Buffer.alloc(5 * 1024 * 1024 + 1, 65)],
  ])
    await assert.rejects(() =>
      validateFeedbackFile(name, bytes.toString("base64")),
    );
  await assert.rejects(() => validateFeedbackFile("x.txt", "YW Jj"));
});
test(
  "customer feedback, outbox and email-attributed analytics stay isolated and durable",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const sent = [];
    let mode = "ok";
    const mailer = {
      ready: async () => true,
      send: async () => {},
      sendFeedback: async (msg) => {
        sent.push(msg);
        if (mode === "uncertain") throw new Error("lost receipt");
        if (mode === "rejected") throw new AppError("feedback_mail_rejected");
        return { messageId: "local-qa-" + msg.deliveryId };
      },
    };
    const f = await aiFixture({ mailerOverride: mailer });
    const engine = new FeedbackDelivery({ db: f.db, store: f.store, mailer });
    const admin = (url, body, method) => f.ok(url, body, method, f.adminAuth),
      adminRequest = (url, body, method) =>
        f.request(url, body, method, f.adminAuth);
    try {
      await f.db.query(
        "UPDATE users SET email=$2,email_verified_at=now() WHERE id=$1",
        [f.actor, `buyer-${f.actor}@example.test`],
      );
      await f.db.query(
        "UPDATE users SET email=$2,email_verified_at=now() WHERE id=$1",
        [f.otherActor, `other-${f.otherActor}@example.test`],
      );
      await t.test(
        "legacy users can fill profile; RLS hides other accounts even in same workspace",
        async () => {
          assert.equal((await f.ok("/api/account/profile")).profile, null);
          await f.ok("/api/account/profile", profile, "PUT");
          assert.equal(
            (await f.ok("/api/account/profile")).profile.data.company_name,
            profile.company_name,
          );
          assert.equal(
            (
              await f.ok(
                "/api/account/profile",
                undefined,
                undefined,
                f.otherAuth,
                f.other,
              )
            ).profile,
            null,
          );
          assert.equal(
            (await f.db.query("SELECT * FROM customer_profiles")).rowCount,
            0,
          );
          assert.equal(
            (await f.request("/api/admin/customers")).statusCode,
            401,
          );
        },
      );
      await t.test(
        "admin workspace companies follow current owners without exposing member profiles or duplicating workspaces",
        async () => {
          const workspace = async (id) => {
            const overview = await admin("/api/admin/overview");
            assert.equal(
              new Set(overview.workspaces.map((w) => w.id)).size,
              overview.workspaces.length,
            );
            return overview.workspaces.find((w) => w.id === id);
          };
          assert.deepEqual((await workspace(f.workspace)).company_names, [
            profile.company_name,
          ]);
          assert.deepEqual((await workspace(f.other)).company_names, []);
          assert.equal(
            (await f.request("/api/admin/overview")).statusCode,
            401,
          );
          await f.ok(
            "/api/account/profile",
            { ...profile, company_name: "成员自己的公司" },
            "PUT",
            f.otherAuth,
            f.other,
          );
          await f.db.query(
            "INSERT INTO memberships(user_id,workspace_id,role) VALUES($1,$2,'member')",
            [f.otherActor, f.workspace],
          );
          try {
            assert.deepEqual((await workspace(f.workspace)).company_names, [
              profile.company_name,
            ]);
            await f.db.query(
              "UPDATE memberships SET role='owner' WHERE user_id=$1 AND workspace_id=$2",
              [f.otherActor, f.workspace],
            );
            assert.deepEqual(
              new Set((await workspace(f.workspace)).company_names),
              new Set([profile.company_name, "成员自己的公司"]),
            );
            await f.db.query(
              "UPDATE memberships SET role='admin' WHERE user_id=$1 AND workspace_id=$2",
              [f.actor, f.workspace],
            );
            assert.deepEqual((await workspace(f.workspace)).company_names, [
              "成员自己的公司",
            ]);
            await f.ok(
              "/api/account/profile",
              { ...profile, company_name: "更新后的公司" },
              "PUT",
              f.otherAuth,
              f.other,
            );
            const updated = await workspace(f.workspace);
            assert.deepEqual(updated.company_names, ["更新后的公司"]);
            assert.equal(updated.profile, undefined);
            assert.equal(updated.phone, undefined);
            assert.equal(
              (await f.db.query("SELECT * FROM customer_profiles")).rowCount,
              0,
            );
          } finally {
            await f.db.query(
              "UPDATE memberships SET role='owner' WHERE user_id=$1 AND workspace_id=$2",
              [f.actor, f.workspace],
            );
            await f.db.query(
              "DELETE FROM memberships WHERE user_id=$1 AND workspace_id=$2",
              [f.otherActor, f.workspace],
            );
            await accountTx(f.db, f.otherActor, (c) =>
              c.query("DELETE FROM customer_profiles WHERE user_id=$1", [
                f.otherActor,
              ]),
            );
          }
        },
      );
      let attachment, feedback, second;
      await t.test(
        "feedback binds verified identity and owned attachments; replay is safe and cross-account reads blocked",
        async () => {
          attachment = await f.ok("/api/feedback/files", {
            name: "复现步骤.txt",
            data: Buffer.from("打开 AI 测品后截图失败").toString("base64"),
          });
          assert.equal(
            (
              await f.request(
                `/api/feedback/files/${attachment.id}`,
                undefined,
                "GET",
                f.otherAuth,
                f.other,
              )
            ).statusCode,
            404,
          );
          const body = {
            id: id(),
            category: "problem",
            title: "商品页面截图问题",
            description: "本地合成反馈，附件用于复现。",
            attachments: [attachment.id],
            context: {
              kind: "report",
              id: f.report,
              workspace_id: f.workspace,
            },
          };
          feedback = await f.ok("/api/feedback", body);
          assert.equal(feedback.mail_state, "pending_configuration");
          assert.equal(feedback.attachments.length, 1);
          assert.equal((await f.ok("/api/feedback", body)).id, feedback.id);
          assert.equal(
            (await f.request("/api/feedback", { ...body, title: "changed" }))
              .statusCode,
            409,
          );
          assert.equal(
            (await f.request("/api/feedback", { ...body, id: id() }))
              .statusCode,
            409,
          );
          assert.equal(
            (
              await f.request(
                `/api/feedback/${feedback.id}`,
                undefined,
                "GET",
                f.otherAuth,
                f.other,
              )
            ).statusCode,
            404,
          );
          assert.equal(
            (
              await f.request("/api/feedback", {
                ...body,
                id: id(),
                email: "spoof@example.test",
                attachments: [],
              })
            ).statusCode,
            400,
          );
          assert.equal(
            (
              await f.request("/api/feedback", {
                ...body,
                id: id(),
                attachments: [],
                context: { kind: "job", id: f.job, workspace_id: f.other },
              })
            ).statusCode,
            403,
          );
          const listed = await admin("/api/admin/feedback");
          assert.ok(listed.items.some((x) => x.id === feedback.id));
          await admin(
            `/api/admin/feedback/${feedback.id}`,
            { status: "processing", public_reply: "正在核查截图问题。" },
            "PUT",
          );
          assert.equal(
            (await f.ok(`/api/feedback/${feedback.id}`)).public_reply,
            "正在核查截图问题。",
          );
          second = await f.ok("/api/feedback", {
            ...body,
            id: id(),
            attachments: [],
            context: null,
            title: "另一条反馈",
          });
        },
      );
      await t.test(
        "per-recipient jobs preserve actual attachment bytes, deduplicate recipients, and do not resend accepted mail",
        async () => {
          await admin(
            "/api/admin/feedback-mail",
            {
              enabled: true,
              owner_email: "owner@example.test",
              sales_emails: ["sales@example.test", "OWNER@example.test"],
            },
            "PUT",
          );
          for (let i = 0; i < 5; i++) await engine.once();
          const deliveries = (await admin(`/api/admin/feedback/${feedback.id}`))
            .deliveries;
          assert.equal(deliveries.length, 2);
          assert.ok(deliveries.every((d) => d.state === "accepted"));
          const notices = sent.filter((x) =>
            x.subject.includes(feedback.id.slice(0, 8)),
          );
          assert.equal(notices.length, 2);
          assert.equal(notices[0].attachments[0].filename, "复现步骤.txt");
          assert.equal(
            notices[0].attachments[0].content.toString(),
            "打开 AI 测品后截图失败",
          );
          assert.equal(notices[0].replyTo, `buyer-${f.actor}@example.test`);
          const before = sent.length;
          await engine.once();
          assert.equal(sent.length, before);
        },
      );
      await t.test(
        "SMTP uncertainty and worker crashes require acknowledgement; definite failures retry at most three times",
        async () => {
          mode = "uncertain";
          await admin("/api/admin/feedback-mail/test", {});
          await engine.once();
          let d = (await admin("/api/admin/feedback-mail")).deliveries.find(
            (x) => x.kind === "test" && x.state === "uncertain",
          );
          assert.ok(d);
          assert.equal(
            (await adminRequest(`/api/admin/feedback-mail/${d.id}/retry`, {}))
              .statusCode,
            409,
          );
          mode = "ok";
          await admin(`/api/admin/feedback-mail/${d.id}/retry`, {
            confirmed_not_received: true,
          });
          await engine.once();
          await engine.once();
          assert.equal(
            (await admin("/api/admin/feedback-mail")).deliveries.find(
              (x) => x.id === d.id,
            ).state,
            "accepted",
          );
          const fail = id();
          await f.db.query(
            "INSERT INTO feedback_deliveries(id,recipient,kind) VALUES($1,'failed@example.test','test')",
            [fail],
          );
          mode = "rejected";
          for (let i = 0; i < 4; i++) {
            await f.db.query(
              "UPDATE feedback_deliveries SET available_at=now() WHERE id=$1",
              [fail],
            );
            await engine.once();
          }
          d = (
            await f.db.query("SELECT * FROM feedback_deliveries WHERE id=$1", [
              fail,
            ])
          ).rows[0];
          assert.equal(d.state, "failed");
          assert.equal(d.attempts, 3);
          const crash = id();
          await f.db.query(
            "INSERT INTO feedback_deliveries(id,recipient,kind,state,lease_until) VALUES($1,'crash@example.test','test','sending',now()-interval '1 minute')",
            [crash],
          );
          await engine.once();
          assert.equal(
            (
              await f.db.query(
                "SELECT state FROM feedback_deliveries WHERE id=$1",
                [crash],
              )
            ).rows[0].state,
            "uncertain",
          );
          mode = "ok";
        },
      );
      await t.test(
        "activity deduplicates tabs and separates new sessions from polling-free day counts",
        async () => {
          await f.ok("/api/account/activity", { page: "scouting" });
          await f.ok("/api/account/activity", { page: "settings" });
          let d = await admin(`/api/admin/customers/${f.actor}`);
          assert.equal(d.usage.active_days, 1);
          assert.equal(d.usage.sessions, 1);
          await accountTx(f.db, f.actor, (c) =>
            c.query(
              "UPDATE customer_activity_clock SET last_at=now()-interval '31 minutes' WHERE user_id=$1",
              [f.actor],
            ),
          );
          await f.ok("/api/account/activity", { page: "ai-testing" });
          d = await admin(`/api/admin/customers/${f.actor}`);
          assert.equal(d.usage.sessions, 2);
        },
      );
      await t.test(
        "token cache is a subset; real/cache data calls and historical candidates attribute to the job creator across workspaces",
        async () => {
          await f.db.tenant(f.workspace, async (c) => {
            for (const [kind, usage, state] of [
              [
                "model",
                {
                  normalized: {
                    input_uncached: 80,
                    cache_read: 20,
                    output_total: 30,
                  },
                },
                "succeeded",
              ],
              ["data", { cache_hit: true }, "succeeded"],
              ["data", {}, "succeeded"],
              ["model", {}, "reconciling"],
            ])
              await c.query(
                "INSERT INTO invocations(id,workspace_id,job_id,operation_key,kind,state,reserved,usage) VALUES($1,$2,$3,$4,$5,$6,0,$7)",
                [id(), f.workspace, f.job, id(), kind, state, usage],
              );
          });
          await f.db.tenant(f.other, async (c) => {
            const j = id();
            await c.query(
              "INSERT INTO jobs(id,workspace_id,created_by,kind,title,request,status,idempotency_key) VALUES($1,$2,$3,'scouting','cross-workspace','{}','succeeded',$4)",
              [j, f.other, f.actor, id()],
            );
            await c.query(
              "INSERT INTO invocations(id,workspace_id,job_id,operation_key,kind,state,reserved,usage) VALUES($1,$2,$3,$4,'model','succeeded',0,$5)",
              [
                id(),
                f.other,
                j,
                id(),
                {
                  normalized: {
                    input_uncached: 10,
                    cache_read: 0,
                    output_total: 5,
                  },
                },
              ],
            );
          });
          let d = await admin(`/api/admin/customers/${f.actor}`);
          assert.equal(d.usage.total_tokens, 145);
          assert.equal(d.usage.input_tokens, 110);
          assert.equal(d.usage.cached_tokens, 20);
          assert.equal(d.usage.data_calls, 2);
          assert.equal(d.usage.real_data_calls, 1);
          assert.equal(d.usage.cache_hits, 1);
          assert.equal(d.usage.unknown_token_calls, 1);
          assert.equal(d.usage.scouting_tasks, 2);
          assert.equal(d.usage.candidate_entries, 2);
          const other = await admin(`/api/admin/customers/${f.otherActor}`);
          assert.equal(other.usage.total_tokens, 0);
          const products = await admin(
            `/api/admin/customers/${f.actor}/products`,
          );
          assert.equal(products.groups[0].products.length, 2);
          assert.equal(
            products.groups[0].products[0].url,
            f.candidates[0].tk_url,
          );
          assert.equal(
            products.groups[0].products[0].custom_product_fact,
            undefined,
          );
          assert.equal(products.groups[0].products[0].selected, false);
          await f.db.query("UPDATE users SET email=$2 WHERE id=$1", [
            f.actor,
            `changed-${f.actor}@example.test`,
          ]);
          d = await admin(`/api/admin/customers/${f.actor}`);
          assert.equal(d.usage.total_tokens, 145);
          assert.ok(d.email.startsWith("changed-"));
          assert.equal(
            (await f.ok(`/api/feedback/${feedback.id}`)).email_snapshot,
            `buyer-${f.actor}@example.test`,
          );
        },
      );
      await t.test(
        "AI run counts only after starting, has one product for same-product A/B, and exposes confirmed screenshots to admin only",
        async () => {
          let draft = await f.ok("/api/ai-tests", {});
          const d = draft.data;
          d.name = "Customer analytics QA";
          d.arms[0].product.name = "Rack";
          d.arms[0].product.use = "Storage";
          d.arms[0].pricing.current_price = 29.99;
          d.arms[0].url = f.candidates[0].tk_url;
          d.arms[0].product_id = f.candidates[0].product_id;
          draft = await f.ok(
            `/api/ai-tests/${draft.id}`,
            { version: draft.version, data: d },
            "PUT",
          );
          for (const arm of ["A", "B"])
            draft = await f.ok(`/api/ai-tests/${draft.id}/image`, {
              version: draft.version,
              arm,
              data: f.png.toString("base64"),
            });
          const review = await f.ok(`/api/ai-tests/${draft.id}/review`);
          const run = await f.ok(`/api/ai-tests/${draft.id}/submit`, {
            version: review.version,
            digest: review.digest,
            confirmed: true,
          });
          assert.equal(
            (await admin(`/api/admin/customers/${f.actor}`)).usage.ai_started,
            0,
          );
          for (let i = 0; i < 3; i++) await f.tick();
          const u = (await admin(`/api/admin/customers/${f.actor}`)).usage;
          assert.equal(u.ai_started, 1);
          assert.equal(u.ai_completed, 1);
          assert.equal(u.ai_unique_products, 1);
          const list = await admin(
            `/api/admin/customers/${f.actor}/products?kind=ai`,
          );
          assert.equal(list.groups[0].products.length, 2);
          const url = list.groups[0].products[0].image;
          assert.ok(url.includes(run.id));
          assert.equal((await adminRequest(url)).statusCode, 200);
          assert.equal((await f.request(url)).statusCode, 401);
        },
      );
    } finally {
      await f.db.query("UPDATE feedback_mail_settings SET enabled=false");
      await f.close();
    }
  },
);

test("feedback MIME contains actual binary attachments and customer Reply-To; file and URL sources prohibited", async () => {
  const { composeFeedbackMail } = await import("../src/infra/mailer.mjs");
  const bytes = Buffer.from([0, 1, 2, 3, 254, 255]),
    message = {
      from: "platform@example.test",
      fromName: "TIDE LAB",
      email: "owner@example.test",
      replyTo: "buyer@example.test",
      subject: "测试反馈",
      text: "反馈正文",
      messageId: "<local-test@example.test>",
      attachments: [
        { filename: "steps.txt", content: bytes, contentType: "text/plain" },
      ],
    };
  const raw = (await composeFeedbackMail(message)).toString();
  assert.match(raw, /Reply-To: buyer@example.test/);
  assert.match(raw, /To: owner@example.test/);
  assert.match(raw, /Content-Disposition: attachment; filename=steps.txt/);
  assert.ok(raw.includes(bytes.toString("base64")));
  assert.match(raw, /multipart\/mixed/);
  await assert.rejects(() =>
    composeFeedbackMail({
      ...message,
      attachments: [{ filename: "secret.txt", path: "/etc/passwd" }],
    }),
  );
});

// Small standards-shaped stored ZIP fixtures, without depending on an office application.
function officeZip(entries) {
  let offset = 0;
  const local = [],
    central = [];
  for (const [name, content] of entries) {
    const n = Buffer.from(name),
      b = Buffer.from(content);
    let crc = 0xffffffff;
    for (const byte of b) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50);
    l.writeUInt16LE(20, 4);
    l.writeUInt32LE(crc, 14);
    l.writeUInt32LE(b.length, 18);
    l.writeUInt32LE(b.length, 22);
    l.writeUInt16LE(n.length, 26);
    local.push(l, n, b);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(b.length, 20);
    c.writeUInt32LE(b.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += l.length + n.length + b.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
test("supported image, PDF, CSV and Office attachments keep their bytes or validated image encoding", async () => {
  const sharp = (await import("sharp")).default;
  for (const ext of ["png", "jpeg", "webp"]) {
    const bytes = await sharp({
      create: { width: 24, height: 24, channels: 3, background: "#176b53" },
    })
      .toFormat(ext)
      .toBuffer();
    const f = await validateFeedbackFile(
      "sample." + ext,
      bytes.toString("base64"),
    );
    assert.equal((await sharp(f.bytes).metadata()).format, ext);
  }
  for (const [ext, content] of [
    ["pdf", "%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF"],
    ["csv", "商品,问题\n收纳架,截图失败"],
  ])
    assert.equal(
      (
        await validateFeedbackFile(
          "sample." + ext,
          Buffer.from(content).toString("base64"),
        )
      ).bytes.toString(),
      content,
    );
  for (const [ext, main] of [
    ["docx", "word/document.xml"],
    ["xlsx", "xl/workbook.xml"],
  ]) {
    const zip = officeZip([
      ["[Content_Types].xml", "<Types/>"],
      [main, "<document/>"],
    ]);
    assert.equal(
      (await validateFeedbackFile("sample." + ext, zip.toString("base64")))
        .bytes.length,
      zip.length,
    );
    const bad = officeZip([
      ["[Content_Types].xml", "<Types/>"],
      [main, "<document/>"],
      ["word/vbaProject.bin", "macro"],
    ]);
    await assert.rejects(() =>
      validateFeedbackFile("macro." + ext, bad.toString("base64")),
    );
  }
});
