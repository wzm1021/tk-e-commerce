import { installCandidateKeywords } from "./reports/candidate-keywords.mjs";
import { installAiTesting } from "./ai-testing/service.mjs";
import { installAiTestAdmin } from "./ai-testing/admin.mjs";
import { installCustomerProfile } from "./customers/profile.mjs";
import { installCustomerActivity } from "./customers/activity.mjs";
import { installCustomerAnalytics } from "./customers/analytics.mjs";
import { installFeedback } from "./feedback/service.mjs";
import { installFeedbackAdmin } from "./feedback/admin.mjs";
import { installCandidateOverview } from "./reports/candidate-overview.mjs";
import { installPolicyWeb } from "./data/policy-web.mjs";
import { publicBilling } from "./common/data-points.mjs";
import { publicDataPricing } from "./data/pricing.mjs";
import { allowedOrigins, fromPublicProxy } from "./infra/http-access.mjs";
import { installResourceAdmin } from "./admin/resource-admin.mjs";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer as httpsServer } from "node:https";
import { createDatabase } from "./infra/db.mjs";
import { LocalStore, SecretStore } from "./infra/storage.mjs";
import { installAuth } from "./accounts/auth.mjs";
import { installRecords } from "./records/records.mjs";
import { installArtifacts } from "./files/artifacts.mjs";
import { installJobs } from "./research/jobs.mjs";
import { installMonitoring } from "./monitoring/monitoring.mjs";
import { installGateway } from "./data/gateway.mjs";
import { installAdmin } from "./admin/admin.mjs";
import { installReports } from "./reports/reports.mjs";
import { installAssistant } from "./assistant/assistant.mjs";
import { defaultProvisioner } from "./accounts/account-policy.mjs";
import { createMailer } from "./infra/mailer.mjs";
import { installEmailAuth } from "./accounts/email-auth.mjs";
import { installTeams } from "./accounts/teams.mjs";
import { AppError, requireThat, KINDS, publicPrice } from "./common/core.mjs";
import { MODEL_SERVER_TIMEOUT_MS } from "./common/model-timeout.mjs";
import { errorLabel } from "../web/lib/format.mjs";
import { validationFields } from "../web/lib/validation-errors.mjs";
export async function buildApp({
  db,
  store,
  secrets,
  workerKey,
  publicOrigin,
  publicOrigins,
  projectRoot,
  distRoot,
  logger = false,
  cookieSecure = false,
  publicAdminEnabled = false,
  gatewayOverrides,
  mailerOverride,
  aiTestOverrides,
}) {
  const origins = allowedOrigins(publicOrigins ?? [publicOrigin]);
  const app = Fastify({
    logger,
    bodyLimit: 2 * 1024 * 1024,
    requestTimeout: 390000,
    connectionTimeout: MODEL_SERVER_TIMEOUT_MS,
    disableRequestLogging: true,
    trustProxy: ["127.0.0.1", "::1"],
  });
  app.decorateRequest("publicIngress", false);
  app.addHook("onRequest", async (req) => {
    req.publicIngress = fromPublicProxy(req);
    if (req.publicIngress)
      requireThat(
        !/^\/internal(?:\/|\.|$)/.test(req.url.split("?")[0]) &&
          (publicAdminEnabled ||
            !/^\/(?:api\/admin|admin)(?:\/|\.|$)/.test(req.url.split("?")[0])),
        "not_found",
        404,
      );
  });
  // Bound in-process waiters as well as provider slots; excess requests have not purchased anything.
  const pendingGateway = new Set();
  const pendingLimit = Number(process.env.MAX_PENDING_GATEWAY_REQUESTS || 32);
  requireThat(
    Number.isInteger(pendingLimit) && pendingLimit >= 1 && pendingLimit <= 1000,
    "invalid_gateway_capacity",
  );
  app.addHook("onRequest", async (req) => {
    if (
      ["/internal/job/data", "/internal/job/v1/responses"].includes(req.url)
    ) {
      requireThat(pendingGateway.size < pendingLimit, "gateway_capacity", 429);
      pendingGateway.add(req.id);
    }
  });
  for (const hook of ["onResponse", "onRequestAbort", "onTimeout"])
    app.addHook(hook, async (req) => {
      pendingGateway.delete(req.id);
    });
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        frameSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: cookieSecure,
  });
  await app.register(rateLimit, {
    max: 200,
    timeWindow: "1 minute",
    allowList: (req) => req.url.startsWith("/internal/"),
  });
  app.addHook("onRequest", async (req) => {
    if (
      req.url.startsWith("/api/") &&
      !["GET", "HEAD", "OPTIONS"].includes(req.method)
    ) {
      requireThat(origins.has(req.headers.origin), "origin_forbidden", 403);
      requireThat(
        req.headers["content-type"]?.startsWith("application/json"),
        "json_required",
        415,
      );
    }
  });
  app.addHook("preSerialization", async (req, reply, payload) => {
    const route = req.routeOptions.url || "";
    if (
      route === "/api/wallet" ||
      route === "/api/wallet/summary" ||
      route.startsWith("/api/jobs") ||
      route.startsWith("/api/assistant/conversations/") ||
      route.startsWith("/api/admin/workspaces/")
    )
      return publicBilling(payload);
    return payload;
  });
  app.addHook("onSend", async (req, reply, payload) => {
    if (req.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
    return payload;
  });
  app.setErrorHandler((e, req, reply) => {
    const transactionRetry = ["55P03", "40001", "40P01"].includes(e.code);
    const status = transactionRetry
      ? 503
      : e instanceof AppError
        ? e.status
        : e.name === "ZodError"
          ? 400
          : e.code === "23505"
            ? 409
            : e.statusCode === 429
              ? 429
              : e.statusCode === 413
                ? 413
                : 500;
    const code = transactionRetry
      ? "transaction_retry"
      : e instanceof AppError
        ? e.code
        : e.name === "ZodError"
          ? "validation_error"
          : e.code === "23505"
            ? "duplicate_record"
            : status === 429
              ? "rate_limited"
              : status === 413
                ? "body_too_large"
                : "internal_error";
    if (req.url.startsWith("/internal/") && status !== 500)
      app.log.warn(
        {
          code,
          route: req.routeOptions.url,
          ...(req.jobScope
            ? {
                job_id: req.jobScope.job_id,
                workspace_id: req.jobScope.workspace_id,
              }
            : {}),
        },
        "gateway_request_rejected",
      );
    if (status === 500)
      app.log.error(
        { code: e.code || e.name, route: req.routeOptions.url },
        "request_failed",
      );
    reply.status(status).send({
      error: code,
      message: errorLabel(code),
      ...(e.name === "ZodError"
        ? {
            fields: validationFields(
              e.issues,
              req.url.startsWith("/api/ai-tests") ? "ai-testing" : "",
            ),
          }
        : e instanceof AppError &&
            code.startsWith("ai_") &&
            Array.isArray(e.detail?.fields)
          ? { fields: validationFields(e.detail.fields, "ai-testing") }
          : {}),
    });
  });
  installAuth(app, db, { cookieSecure, publicAdminEnabled });
  const mailer = mailerOverride || createMailer(db, secrets);
  const provisioner = defaultProvisioner(projectRoot, store);
  installEmailAuth(app, db, mailer, provisioner, workerKey);
  installCustomerProfile(app, db);
  installCustomerActivity(app, db);
  installCustomerAnalytics(app, db, store);
  installFeedback(app, db, store);
  installFeedbackAdmin(app, db, mailer);
  installTeams(app, db, provisioner);
  mailer.install?.(app);
  installRecords(app, db);
  installArtifacts(app, db, store);
  installJobs(app, db, workerKey, { store, projectRoot });
  installMonitoring(app, db, store, projectRoot);
  const gateway = await installGateway(
    app,
    db,
    store,
    secrets,
    projectRoot,
    gatewayOverrides,
  );
  installAdmin(
    app,
    db,
    store,
    secrets,
    projectRoot,
    gateway.validateConnection,
  );
  installResourceAdmin(app, db, gateway.tools);
  installPolicyWeb(app, db, store, gatewayOverrides?.policyFetch);
  installReports(app, db, store, projectRoot);
  installCandidateOverview(app, db, store, gateway.callData);
  installCandidateKeywords(app, db, store, gateway.callModel);
  installAssistant(app, db, store);
  installAiTesting(app, db, store, secrets, aiTestOverrides);
  installAiTestAdmin(app, db, secrets, aiTestOverrides);
  app.get("/healthz", async () => {
    await db.query("SELECT 1");
    return { ok: true, service: "tidelab" };
  });
  app.get("/api/catalog", { preHandler: app.user }, async (req) =>
    db.tenant(req.workspace, async (c) => {
      const skills = (
        await c.query(
          "SELECT b.skill_id,r.version,r.digest FROM skill_bindings b JOIN skill_releases r ON r.id=b.release_id",
        )
      ).rows;
      const connections = (
        await c.query(
          "SELECT c.id,c.name,c.kind,c.enabled,v.verified,v.config,p.data FROM workspace_connections w JOIN connections c ON c.id=w.connection_id JOIN connection_versions v ON v.id=c.active_version_id LEFT JOIN price_cards p ON p.connection_id=c.id AND p.active WHERE w.workspace_id=$1 AND w.enabled ORDER BY c.created_at DESC",
          [req.workspace],
        )
      ).rows;
      return {
        kinds: KINDS,
        skills,
        default_model_id:
          (
            await c.query(
              "SELECT default_model_id FROM memberships WHERE workspace_id=$1 AND user_id=$2",
              [req.workspace, req.identity.id],
            )
          ).rows[0]?.default_model_id || null,
        connections: connections.map((x) => ({
          id: x.id,
          name: x.name,
          kind: x.kind,
          ready:
            x.enabled && x.verified && (x.kind !== "model" || Boolean(x.data)),
          model: x.kind === "model" ? x.config.model : undefined,
          price: x.data ? publicPrice(x.data) : null,
        })),
        data_price: {
          ...publicDataPricing(),
          amazon: publicDataPricing("sellersprite"),
          snapshot_ttl_seconds: (
            await c.query(
              "SELECT ttl_seconds FROM data_cache_policies WHERE tool='*'",
            )
          ).rows[0].ttl_seconds,
          monthly_points: 2400,
          procurement_monthly_cny: 249,
        },
        supplier_api: "documentation_pending",
      };
    }),
  );
  app.get("/api/admin/health", { preHandler: app.admin }, async () => ({
    workers: (
      await db.query("SELECT * FROM worker_nodes ORDER BY last_seen DESC")
    ).rows,
    database: (
      await db.query("SELECT version FROM schema_versions ORDER BY version")
    ).rows,
  }));
  if (distRoot) {
    await app.register(staticFiles, { root: distRoot, index: "index.html" });
    app.get("/admin", async (_req, reply) => reply.sendFile("admin.html"));
  }
  app.setNotFoundHandler((_req, reply) =>
    reply
      .status(404)
      .send({ error: "not_found", message: errorLabel("not_found") }),
  );
  return app;
}
export async function start() {
  requireThat(process.env.DATABASE_URL, "DATABASE_URL_required", 500);
  const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
  const dataRoot =
    process.env.DATA_ROOT ||
    fileURLToPath(new URL("../data/", import.meta.url));
  const keyPath = process.env.MASTER_KEY_FILE,
    workerPath = process.env.WORKER_TOKEN_FILE;
  requireThat(keyPath && workerPath, "secret_files_required", 500);
  for (const p of [keyPath, workerPath]) {
    const s = await stat(p);
    requireThat((s.mode & 0o077) === 0, "secret_file_permissions", 500);
  }
  const master = await readFile(keyPath),
    workerKey = await readFile(workerPath);
  requireThat(
    master.length === 32 && workerKey.length === 32,
    "invalid_runtime_secret",
    500,
  );
  const db = createDatabase(process.env.DATABASE_URL);
  const role = (
    await db.query(
      "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user",
    )
  ).rows[0];
  requireThat(
    role && !role.rolsuper && !role.rolbypassrls,
    "database_role_bypasses_isolation",
    500,
  );
  requireThat(
    (
      await db.query(
        "SELECT 1 FROM schema_versions WHERE version='014_ai_test_suggestions'",
      )
    ).rowCount,
    "database_migration_required",
    503,
  );
  const store = new LocalStore(dataRoot),
    secrets = new SecretStore(dataRoot, master);
  const app = await buildApp({
    db,
    store,
    secrets,
    workerKey,
    publicOrigin: process.env.PUBLIC_ORIGIN || "http://127.0.0.1:4310",
    publicOrigins: process.env.PUBLIC_ORIGINS?.split(",").map((value) =>
      value.trim(),
    ),
    projectRoot,
    distRoot: fileURLToPath(new URL("../dist/", import.meta.url)),
    cookieSecure: process.env.COOKIE_SECURE === "true",
    publicAdminEnabled: process.env.PUBLIC_ADMIN_ENABLED === "true",
    logger: {
      level: process.env.LOG_LEVEL || "warn",
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.body",
        "res.headers.set-cookie",
      ],
    },
  });
  await app.listen({
    host: process.env.HOST || "127.0.0.1",
    port: Number(process.env.PORT || 9080),
  });
  let tls;
  if (process.env.TLS_CERT_FILE && process.env.TLS_KEY_FILE) {
    tls = httpsServer(
      {
        cert: await readFile(process.env.TLS_CERT_FILE),
        key: await readFile(process.env.TLS_KEY_FILE),
      },
      app.routing,
    );
    await new Promise((resolve, reject) => {
      tls.once("error", reject);
      tls.listen(Number(process.env.TLS_PORT || 9443), "127.0.0.1", resolve);
    });
  }
  for (const signal of ["SIGTERM", "SIGINT"])
    process.once(signal, async () => {
      tls?.close();
      await app.close();
      await db.close();
      process.exit(0);
    });
  return app;
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  start().catch((e) => {
    console.error("Startup failed:", e.code || e.name);
    process.exit(1);
  });
