// Provisioned only through private stdin; never log the payload or generated credentials.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createDatabase } from "../src/infra/db.mjs";
import { SecretStore, LocalStore } from "../src/infra/storage.mjs";
import {
  id,
  passwordHash,
  SKILL_IDS,
  PublishedPriceSchema,
} from "../src/common/core.mjs";
import { creditWallet, createConnection } from "../src/admin/admin.mjs";
import { projectBundle, publishSkill } from "../src/skills/skills.mjs";
import { makeValidator } from "../src/data/gateway.mjs";
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const p = JSON.parse(Buffer.concat(chunks).toString());
const db = createDatabase(process.env.DATABASE_URL),
  root = process.env.DATA_ROOT,
  project = fileURLToPath(new URL("../../", import.meta.url));
const store = new LocalStore(root),
  secrets = new SecretStore(root, await readFile(process.env.MASTER_KEY_FILE));
try {
  const adminHash = await passwordHash(p.admin_password),
    userHash = await passwordHash(p.user_password);
  await db.tx(null, async (c) => {
    await c.query(
      "INSERT INTO workspaces(id,name) VALUES($1,'Orion 跨境研究') ON CONFLICT DO NOTHING",
      [p.workspace_id],
    );
    for (const [uid, login, encoded, name, isAdmin] of [
      [p.admin_id, "platform-admin", adminHash, "平台管理员", true],
      [p.user_id, "orion", userHash, "Orion", false],
    ]) {
      await c.query(
        "INSERT INTO users(id,login,password_hash,display_name,is_admin) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
        [uid, login, encoded, name, isAdmin],
      );
      await c.query(
        "INSERT INTO memberships(user_id,workspace_id,role) VALUES($1,$2,'owner') ON CONFLICT DO NOTHING",
        [uid, p.workspace_id],
      );
    }
  });
  await db.tenant(p.workspace_id, async (c) => {
    await c.query(
      "INSERT INTO wallets(workspace_id,currency) VALUES($1,'ai_test_uses') ON CONFLICT DO NOTHING",
      [p.workspace_id],
    );
    for (const [currency, amount] of [
      ["model_micro_cny", 20000000n],
      ["data_points", 2000n],
    ])
      await creditWallet(
        c,
        p.workspace_id,
        currency,
        amount,
        "initial-validation-sponsored-v1",
        {
          type: "sponsored_test",
          reason: "初始内测赠送，非真实付款",
          actor_id: p.admin_id,
        },
      );
  });
  for (const skill of SKILL_IDS) {
    const existing = await db.tenant(
      p.workspace_id,
      async (c) =>
        (
          await c.query("SELECT 1 FROM skill_bindings WHERE skill_id=$1", [
            skill,
          ])
        ).rowCount,
    );
    if (!existing)
      await publishSkill(
        db,
        store,
        p.workspace_id,
        p.admin_id,
        skill,
        await projectBundle(project, skill),
        0,
      );
  }
  const { tools } = JSON.parse(
    await readFile(project + "/schemas/fastmoss-tools.snapshot.json"),
  );
  const validate = makeValidator(db, secrets, tools);
  let modelId;
  for (const input of [
    {
      name: "GLM-5.2 · BasicRouter",
      kind: "model",
      config: {
        endpoint: p.model_endpoint,
        model: p.model_id,
        protocol: "responses",
        context_limit: 64000,
        output_limit: 4096,
      },
      secret: p.model_key,
    },
    {
      name: "FastMoss · 平台采购",
      kind: "fastmoss",
      config: { endpoint: "https://mcp.fastmoss.com/mcp", protocol: "mcp" },
      secret: p.fastmoss_key,
    },
  ]) {
    let cid = (
      await db.query(
        "SELECT id FROM connections WHERE name=$1 AND kind=$2 ORDER BY created_at LIMIT 1",
        [input.name, input.kind],
      )
    ).rows[0]?.id;
    if (!cid) cid = (await createConnection(db, secrets, p.admin_id, input)).id;
    const verified = (
      await db.query(
        "SELECT v.verified FROM connections c JOIN connection_versions v ON v.id=c.active_version_id WHERE c.id=$1",
        [cid],
      )
    ).rows[0]?.verified;
    if (!verified) await validate(cid, p.admin_id);
    await db.query("UPDATE connections SET enabled=true WHERE id=$1", [cid]);
    await db.query(
      "INSERT INTO workspace_connections(workspace_id,connection_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [p.workspace_id, cid],
    );
    if (input.kind === "model") modelId = cid;
  }
  if (
    !(
      await db.query(
        "SELECT 1 FROM price_cards WHERE connection_id=$1 AND active",
        [modelId],
      )
    ).rowCount
  ) {
    const price = PublishedPriceSchema.parse({
      currency: "CNY",
      fx: "1",
      market: {
        input: "8.82",
        output: "27.72",
        cache_read: "1.61",
        cache_write: "1.61",
      },
      procurement_discount: "1",
      sale_discount: "1.5",
      max_context_tokens: 64000,
      max_output_tokens: 4096,
      note: "人民币 / 百万 token；原采购报价按用户确认的 7 换算后录入人民币基准价，直接结算，不再乘汇率。采购系数 1、销售系数 1.5。缓存写入须以渠道实际用量口径核验。",
    });
    await db.query(
      "INSERT INTO price_cards(id,connection_id,name,data,active) VALUES($1,$2,$3,$4,true)",
      [id(), modelId, "GLM-5.2 · 实际采购价 × 1.5 · 2026-09", price],
    );
  }
  console.log(
    JSON.stringify({
      status: "initialized",
      workspace_id: p.workspace_id,
      skills: SKILL_IDS.length,
      model: "glm-5.2",
      currency: "CNY",
    }),
  );
} catch (e) {
  console.error(JSON.stringify({ status: "failed", reason: e.code || e.name }));
  process.exitCode = 1;
} finally {
  await db.close();
}
