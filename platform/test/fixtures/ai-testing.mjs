import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { createDatabase } from "../../src/infra/db.mjs";
import { LocalStore, SecretStore } from "../../src/infra/storage.mjs";
import { buildApp } from "../../src/server.mjs";
import { id, passwordHash, digest, AppError } from "../../src/common/core.mjs";
import { saveArtifact } from "../../src/files/artifacts.mjs";
import { AiTestEngine } from "../../src/ai-testing/engine.mjs";
import {
  suggestionJob,
  failSuggestions,
} from "../../src/ai-testing/suggestions.mjs";
import { utcMonth } from "../../src/ai-testing/pool.mjs";
import { creditWallet } from "../../src/admin/admin.mjs";

export async function aiFixture({
  databaseUrl = process.env.TEST_DATABASE_URL,
  origin = "http://127.0.0.1:4455",
  distRoot,
  mailerOverride,
  testUses = 100,
} = {}) {
  const db = createDatabase(databaseUrl),
    root = await mkdtemp(path.join(tmpdir(), "ai-testing-qa-")),
    store = new LocalStore(root),
    secrets = new SecretStore(root, randomBytes(32));
  const workspace = id(),
    other = id(),
    actor = id(),
    otherActor = id(),
    admin = id(),
    report = id(),
    job = id(),
    password = "local-test-" + id();
  const png = await sharp({
    create: { width: 1440, height: 1100, channels: 3, background: "#ecf5f2" },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="1440" height="1100"><rect x="80" y="180" width="580" height="680" rx="25" fill="#cdded8"/><text x="80" y="100" font-family="Arial" font-size="36" fill="#164d45">LOCAL QA — PRODUCT PAGE FIXTURE</text><text x="750" y="250" font-family="Arial" font-size="34">Bamboo Storage Rack</text><text x="750" y="340" font-family="Arial" font-size="42">$29.99</text><text x="750" y="410" font-family="Arial" font-size="24">Natural / 3 tiers</text><rect x="750" y="480" width="430" height="65" rx="12" fill="#d7ac50"/><text x="840" y="523" font-family="Arial" font-size="24">Add to cart</text><text x="750" y="620" font-family="Arial" font-size="24">Free delivery</text></svg>',
        ),
      },
    ])
    .png()
    .toBuffer();
  const jpeg = await sharp(png).jpeg().toBuffer();
  const candidates = [
    {
      product_id: "1729613111070136690",
      title: "Bamboo Storage Rack",
      price: 29.99,
      price_currency: "USD",
      market: "US",
      platform: "tiktok",
      tk_url: "https://www.tiktok.com/shop/pdp/1729613111070136690",
      image: "https://example.invalid/cover.jpg",
      reason: "测试候选完整理由",
      keywords: ["bamboo rack"],
      assessment: {
        facts: {
          is_free_shipping: { value: true },
          category: { value: "Home storage" },
        },
      },
      evidence: [],
      discrepancies: ["规格需要核对"],
      custom_product_fact: { important: "保留完整商品资料" },
    },
    {
      product_id: "1729613111070136691",
      title: "Metal Storage Rack",
      price: 24.99,
      price_currency: "USD",
      market: "US",
      platform: "tiktok",
      tk_url: "https://www.tiktok.com/shop/pdp/1729613111070136691",
      assessment: { facts: {} },
      evidence: [],
    },
  ];
  const encoded = await passwordHash(password);
  await db.tx(null, async (c) => {
    for (const [wid, uid, name] of [
      [workspace, actor, "AI 测品本地测试"],
      [other, otherActor, "隔离空间"],
    ]) {
      await c.query("INSERT INTO workspaces(id,name) VALUES($1,$2)", [
        wid,
        name,
      ]);
      await c.query(
        "INSERT INTO users(id,login,password_hash,display_name) VALUES($1,$4,$2,$3)",
        [uid, encoded, "本地测试用户", uid],
      );
      await c.query(
        "INSERT INTO memberships(user_id,workspace_id,role) VALUES($1,$2,'owner')",
        [uid, wid],
      );
    }
    await c.query(
      "INSERT INTO users(id,login,password_hash,display_name,is_admin) VALUES($1,$3,$2,'本地测试管理员',true)",
      [admin, encoded, admin],
    );
  });
  await db.tenant(workspace, async (c) => {
    await c.query(
      "INSERT INTO wallets(workspace_id,currency) VALUES($1,'ai_test_uses')",
      [workspace],
    );
    if (testUses > 0)
      await creditWallet(
        c,
        workspace,
        "ai_test_uses",
        BigInt(testUses),
        "local-fixture-" + id(),
        { reason: "本地测试额度" },
      );
    await c.query(
      "INSERT INTO jobs(id,workspace_id,created_by,kind,title,request,status,idempotency_key) VALUES($1,$2,$3,'scouting','本地测试候选商品',$4,'succeeded',$5)",
      [job, workspace, actor, { market: "US", platform: "tiktok" }, id()],
    );
    const a = await saveArtifact(
        c,
        store,
        workspace,
        Buffer.from(JSON.stringify(candidates)),
        { name: "候选商品.json", kind: "candidates" },
      ),
      html = await saveArtifact(
        c,
        store,
        workspace,
        Buffer.from("<h1>本地测试研究报告</h1><p>用于验证候选商品导入。</p>"),
        { name: "本地报告.html", kind: "report", mime: "text/html" },
      );
    await c.query(
      "INSERT INTO records(id,workspace_id,kind,data,created_by) VALUES($1,$2,'report',$3,$4)",
      [
        report,
        workspace,
        {
          title: "本地测试候选商品",
          job_id: job,
          platform: "tiktok",
          market: "US",
          candidates_artifact_id: a.id,
          artifact_id: html.id,
          candidate_count: 2,
          captured_at: new Date().toISOString(),
          source_kind: "research",
        },
        actor,
      ],
    );
  });
  const accounts = [];
  async function addAccount(suffix, priority = 100) {
    const account = id(),
      version = id(),
      key = "fl_local_fixture_" + suffix,
      ref = await secrets.write(key, "ai-test:" + account + ":" + version);
    await db.query(
      "INSERT INTO ai_test_accounts(id,name,owner_identity,secret_ref,secret_version,credential_hash,enabled,verified,trial_used,monthly_used,quota_month,priority,state) VALUES($1,$2,$3,$4,$5,$6,true,true,0,0,$7,$8,'ready')",
      [
        account,
        "本地账号 " + suffix,
        account,
        ref,
        version,
        digest(key),
        utcMonth(),
        priority,
      ],
    );
    accounts.push(account);
    return { id: account, key };
  }
  const first = await addAccount(id(), 1),
    second = await addAccount(id(), 2);
  const calls = [],
    remotes = new Map(),
    keys = new Map();
  const behavior = {
    exhaust: new Set(),
    throwCreate: 0,
    loseReceipt: false,
    complete: true,
    cancelBillable: false,
    estimateError: null,
    estimateErrorDetail: null,
    remainingByKey: new Map(),
    usedByKey: new Map(),
  };
  const resultFor = (spec) => ({
    schema_version: "1",
    is_simulation: true,
    disclaimer: {
      zh: "模拟结果，不预测实际销量",
      en: "Simulation, not sales forecast",
    },
    sample: {
      personas_planned: spec.persona_count,
      personas_completed: spec.persona_count,
      personas_failed: 0,
      sessions_unparsed: 0,
    },
    arms: Object.fromEntries(
      spec.arms.map((a, i) => [
        a.id,
        {
          buy_rate: {
            value: 0.4 + i * 0.1,
            ci95: [0.3 + i * 0.1, 0.5 + i * 0.1],
          },
          valid_sessions: 125,
          top_concerns: [{ category: "尺寸需要确认" }],
          top_buy_reasons: [{ category: "用途清晰" }],
          common_questions: ["是否适合小户型？"],
        },
      ]),
    ),
    comparisons: spec.arms.slice(1).map((a) => ({
      arm: a.id,
      vs: "A",
      difference: 0.1,
      ci: [-0.02, 0.22],
      stability: "directional",
    })),
    segments: [],
    data_gaps: [],
    scope_warnings: [],
  });
  async function sdk(p, { onReceipt = async () => {} } = {}) {
    calls.push({ ...p, key: undefined });
    if (p.action === "audience")
      return {
        market: p.market,
        fields: { urbanicity: [["Urban"], ["Rural"]] },
        numeric: {},
      };
    if (p.action === "estimate") {
      if (behavior.estimateError)
        throw new AppError(
          behavior.estimateError,
          502,
          behavior.estimateErrorDetail,
        );
      if (behavior.exhaust.has(p.key)) throw new AppError("ai_free_tier_limit");
      return {
        ready: true,
        credits: p.spec.persona_count * p.spec.arms.length,
        audience: { eligible: 800, enough: true },
        quota: {
          remaining:
            behavior.remainingByKey.get(p.key) ??
            150 - (behavior.usedByKey.get(p.key) || 0),
          used:
            150 -
            (behavior.remainingByKey.get(p.key) ??
              150 - (behavior.usedByKey.get(p.key) || 0)),
          limit: 150,
        },
        eta_minutes: { typical: 6, max: 15 },
        data_gaps: [],
        scope_warnings: [{ message_zh: "整体方案比较，不能归因于单个元素。" }],
      };
    }
    if (p.action === "create") {
      if (behavior.exhaust.has(p.key)) throw new AppError("ai_free_tier_limit");
      let remote = remotes.get(keys.get(p.idempotency_key));
      if (!remote) {
        const remoteId = "pt_" + id();
        remote = {
          id: remoteId,
          status: "processing",
          billable: true,
          credits: p.spec.persona_count * p.spec.arms.length,
          spec: p.spec,
          partner_product_id: p.spec.external_ref.partner_product_id,
          results: resultFor(p.spec),
          progress: { completed: 0, total: p.spec.persona_count },
        };
        remotes.set(remoteId, remote);
        behavior.usedByKey.set(
          p.key,
          (behavior.usedByKey.get(p.key) || 0) + remote.credits,
        );
        keys.set(p.idempotency_key, remoteId);
      }
      if (!behavior.loseReceipt)
        await onReceipt({ id: remote.id, status: remote.status });
      if (behavior.throwCreate-- > 0)
        throw new AppError("ai_transport_uncertain");
      return remote;
    }
    const remote = remotes.get(p.id);
    if (!remote) throw new AppError("ai_not_found");
    if (p.action === "cancel") {
      if (remote.billable && !behavior.cancelBillable)
        behavior.usedByKey.set(
          p.key,
          Math.max(0, (behavior.usedByKey.get(p.key) || 0) - remote.credits),
        );
      remote.status = "cancelled";
      remote.billable = behavior.cancelBillable;
      return { ...remote };
    }
    if (p.action === "get") {
      if (behavior.complete && remote.status === "processing")
        remote.status = "completed";
      return { ...remote };
    }
    throw Error("unexpected action");
  }
  const capture = async (request) => ({
    image: jpeg,
    full: jpeg,
    metadata: {
      width: 1440,
      height: 1100,
      format: "jpeg",
      mime: "image/jpeg",
      manual: false,
      source_url: request.url,
      captured_at: new Date().toISOString(),
      viewport: { width: 1440, height: 1100 },
    },
  });
  const engine = new AiTestEngine({ db, store, secrets, sdk, capture });
  const app = await buildApp({
    db,
    store,
    secrets,
    workerKey: randomBytes(32),
    publicOrigin: origin,
    projectRoot: path.resolve(".."),
    distRoot,
    aiTestOverrides: { sdk },
    mailerOverride,
  });
  await app.ready();
  async function login(uid = actor, audience = "web") {
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin },
      payload: { login: uid, password, audience },
    });
    if (r.statusCode !== 200) throw Error(r.body);
    return {
      cookie: r.cookies.map((c) => c.name + "=" + c.value).join("; "),
      "x-csrf-token": r.cookies.find((c) => c.name.endsWith("_csrf")).value,
    };
  }
  const auth = await login(),
    otherAuth = await login(otherActor),
    adminAuth = await login(admin, "admin");
  async function request(
    url,
    body,
    method = body === undefined ? "GET" : "POST",
    identity = auth,
    wid = workspace,
  ) {
    return app.inject({
      method,
      url,
      headers: { origin, "x-workspace-id": wid, ...identity },
      ...(body === undefined ? {} : { payload: body }),
    });
  }
  async function ok(url, body, method, identity, wid) {
    const r = await request(url, body, method, identity, wid);
    if (r.statusCode !== 200) throw Error(r.statusCode + " " + r.body);
    return r.json();
  }
  async function tick() {
    // Keep this helper's one SDK-step contract while also finishing import suggestions.
    const queued = (
      await db.query(
        "UPDATE ai_test_dispatch SET lease_token=$2,lease_until=now()+interval '10 minutes' WHERE workspace_id=$1 AND kind='suggestion' AND (lease_until IS NULL OR lease_until<now()) RETURNING *",
        [workspace, id()],
      )
    ).rows;
    for (const q of queued) {
      try {
        await suggestionJob(engine, q);
      } catch (e) {
        await failSuggestions(engine, q, e);
      }
    }
    await db.query(
      "UPDATE ai_test_dispatch SET available_at=now() WHERE workspace_id=$1",
      [workspace],
    );
    return engine.once();
  }
  async function close() {
    await app.close();
    await db.query(
      "UPDATE ai_test_accounts SET enabled=false WHERE id=ANY($1::uuid[])",
      [accounts],
    );
    await db.close();
    await rm(root, { recursive: true, force: true });
  }
  return {
    db,
    root,
    store,
    secrets,
    app,
    workspace,
    other,
    actor,
    otherActor,
    job,
    admin,
    password,
    report,
    candidates,
    png,
    jpeg,
    engine,
    sdk,
    capture,
    calls,
    remotes,
    behavior,
    first,
    second,
    accounts,
    addAccount,
    request,
    ok,
    tick,
    close,
    auth,
    otherAuth,
    adminAuth,
  };
}
