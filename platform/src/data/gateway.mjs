import {
  dataToolsForJob,
  sellerSpriteTools,
  sellerSpriteSchemaDigest,
} from "./sellersprite.mjs";
import { platformSpec } from "../common/platforms.mjs";
import {
  MODEL_RESPONSE_TIMEOUT_MS,
  MODEL_TRANSPORT_TIMEOUT_MS,
} from "../common/model-timeout.mjs";
import { CACHE_POINTS, pointUnits, points } from "../common/data-points.mjs";
import { ResourceGate, resourceFor } from "./resources.mjs";
import { assertWorkspaceAccess } from "../accounts/account-policy.mjs";
import { DataCache, snapshotKey, reusableResponse } from "./data-cache.mjs";
import { liveDataPrice, publicDataPricing } from "./pricing.mjs";
import { fastmossOutcome } from "./response-outcome.mjs";
import { collectionPlan } from "../monitoring/engine.mjs";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import Ajv from "ajv";
import {
  id,
  digest,
  requireThat,
  AppError,
  charges,
  callBound,
  modelCallBudget,
  serializedRequestTokenBound,
  uuid,
} from "../common/core.mjs";
import { lockedLease, jobEvent, finalizeJob } from "../research/jobs.mjs";
import { providerFetch, readLimited } from "../infra/network.mjs";
import { saveArtifact } from "../files/artifacts.mjs";
import { finishSettledJob } from "../reports/reports.mjs";
import { decodeMcpContent, parseEvidenceJson } from "./evidence.mjs";
import {
  responseEventStream,
  clientToolsOnly,
  adaptClientTools,
} from "./responses.mjs";
function parseSse(raw) {
  const events = [];
  for (const block of raw.replaceAll("\r\n", "\n").split("\n\n")) {
    const value = block
      .split("\n")
      .filter((x) => x.startsWith("data:"))
      .map((x) => x.slice(5).trimStart())
      .join("\n");
    if (value && value !== "[DONE]") {
      try {
        events.push(parseEvidenceJson(value));
      } catch {
        throw new AppError("provider_sse_invalid", 502);
      }
    }
  }
  return events;
}
function jsonRpc(raw, contentType) {
  if (contentType?.includes("text/event-stream")) {
    const events = parseSse(raw);
    return events.findLast((x) => x.id !== undefined) || {};
  }
  return raw.trim() ? parseEvidenceJson(raw) : {};
}
export async function fastmossRpc(
  endpoint,
  secret,
  method,
  params,
  { onResponse, onRateLimit, provider = "fastmoss" } = {},
) {
  const credentialQuery =
    provider === "sellersprite" ? null : { api_key: secret };
  const credentialHeaders =
    provider === "sellersprite" ? { "secret-key": secret } : {};
  const signal = AbortSignal.timeout(180000);
  let session = null;
  let index = 1;
  async function post(body) {
    const { response, close } = await providerFetch(
      endpoint,
      {
        method: "POST",
        signal,
        headers: {
          ...credentialHeaders,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...(session ? { "Mcp-Session-Id": session } : {}),
        },
        body: JSON.stringify(body),
      },
      credentialQuery,
    );
    try {
      if (response.headers.get("Mcp-Session-Id"))
        session = response.headers.get("Mcp-Session-Id");
      const raw = (await readLimited(response))
        .toString()
        .replaceAll(secret, "[REDACTED]");
      if (body.method === "tools/call")
        await onResponse?.({ status: response.status, raw });
      if (response.status === 429)
        await onRateLimit?.(response.headers.get("Retry-After"));
      if (!response.ok)
        throw new AppError(`${provider}_http_error`, 502, {
          data_no_charge: provider === "fastmoss",
          outcome: response.status === 429 ? "rate_limited" : "failed",
          http_status: response.status,
        });
      const data = jsonRpc(raw, response.headers.get("Content-Type"));
      if (data.error)
        throw new AppError(`${provider}_rpc_error`, 502, {
          data_no_charge: provider === "fastmoss",
          outcome: "failed",
        });
      return data.result;
    } finally {
      await close();
    }
  }
  await post({
    jsonrpc: "2.0",
    id: index++,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "tidelab-gateway", version: "0.1.0" },
    },
  });
  await post({ jsonrpc: "2.0", method: "notifications/initialized" });
  try {
    let result = await post({ jsonrpc: "2.0", id: index++, method, params });
    if (method === "tools/list") {
      const cursors = new Set();
      while (result.nextCursor) {
        requireThat(
          !cursors.has(result.nextCursor) && cursors.size < 20,
          "provider_catalog_pagination_invalid",
          502,
        );
        cursors.add(result.nextCursor);
        const page = await post({
          jsonrpc: "2.0",
          id: index++,
          method,
          params: { ...params, cursor: result.nextCursor },
        });
        result = {
          tools: [...(result.tools || []), ...(page.tools || [])],
          nextCursor: page.nextCursor,
        };
      }
    }
    return result;
  } finally {
    if (session) {
      try {
        const { response, close } = await providerFetch(
          endpoint,
          {
            method: "DELETE",
            signal: AbortSignal.timeout(5000),
            headers: { ...credentialHeaders, "Mcp-Session-Id": session },
          },
          credentialQuery,
        );
        await response.body?.cancel();
        await close();
      } catch {}
    }
  }
}
export async function currentConnection(c, snapshot, workspace) {
  const r = (
    await c.query(
      "SELECT v.*,c.kind,c.share_market_snapshots FROM connections c JOIN connection_versions v ON v.id=c.active_version_id JOIN workspace_connections w ON w.connection_id=c.id WHERE c.id=$1 AND c.enabled AND v.verified AND w.workspace_id=$2 AND w.enabled",
      [snapshot.id, workspace],
    )
  ).rows[0];
  requireThat(r, "connection_disabled", 409);
  requireThat(
    digest(r.config) === digest(snapshot.config) &&
      (!snapshot.kind || r.kind === snapshot.kind),
    "connection_configuration_changed",
    409,
  );
  return r;
}
export async function beginInvocation(
  db,
  scope,
  kind,
  operationKey,
  bound,
  metadata = {},
  onReserved = async () => {},
) {
  return db.tenant(scope.workspace_id, async (c) => {
    const j = await lockedLease(c, scope);
    const old = (
      await c.query(
        "SELECT * FROM invocations WHERE job_id=$1 AND operation_key=$2",
        [j.id, operationKey],
      )
    ).rows[0];
    if (old) {
      requireThat(old.kind === kind, "operation_key_conflict", 409);
      requireThat(
        old.state === "succeeded",
        "invocation_pending_reconciliation",
        409,
      );
      return { cached: old, job: j };
    }
    await assertWorkspaceAccess(c, scope.workspace_id, j.created_by);
    const snap = kind === "model" ? j.snapshot.model : j.snapshot.data;
    requireThat(snap, "connection_missing", 409);
    const connection = await currentConnection(c, snap, scope.workspace_id);
    const stem = kind === "model" ? "model" : "data";
    const currency = kind === "model" ? "model_micro_cny" : "data_points";
    const shared = j.billing_mode === "wallet_per_call";
    const available = shared
      ? BigInt(
          (
            await c.query(
              "SELECT available FROM wallets WHERE workspace_id=$1 AND currency=$2 FOR UPDATE",
              [scope.workspace_id, currency],
            )
          ).rows[0]?.available || 0,
        )
      : BigInt(j[stem + "_budget"]) -
        BigInt(j[stem + "_spent"]) -
        BigInt(j[stem + "_inflight"]);
    const n = BigInt(bound(j, available));
    requireThat(
      n > 0n || (kind === "data" && n === 0n),
      "invalid_call_bound",
      500,
    );
    requireThat(
      n <= available,
      shared ? `insufficient_${currency}` : "task_budget_exhausted",
      409,
    );
    const inv = id();
    if (shared && n > 0n) {
      requireThat(
        (
          await c.query(
            "UPDATE wallets SET available=available-$3,reserved=reserved+$3 WHERE workspace_id=$1 AND currency=$2 AND available>=$3",
            [scope.workspace_id, currency, n.toString()],
          )
        ).rowCount,
        `insufficient_${currency}`,
        409,
      );
      await c.query(
        "INSERT INTO ledger(id,workspace_id,currency,operation,amount,reference,detail) VALUES($1,$2,$3,'reserve',$4,$5,$6)",
        [
          id(),
          scope.workspace_id,
          currency,
          n.toString(),
          inv,
          { job_id: j.id },
        ],
      );
    }
    await c.query(
      `UPDATE jobs SET ${stem}_inflight=${stem}_inflight+$2 WHERE id=$1`,
      [j.id, n.toString()],
    );
    await c.query(
      "INSERT INTO invocations(id,workspace_id,job_id,operation_key,kind,state,reserved,usage) VALUES($1,$2,$3,$4,$5,'started',$6,$7)",
      [
        inv,
        scope.workspace_id,
        j.id,
        operationKey,
        kind,
        n.toString(),
        { request: metadata },
      ],
    );
    await onReserved(c, { id: inv, reserved: n.toString() });
    return {
      invocation: { id: inv, reserved: n.toString() },
      connection,
      job: j,
    };
  });
}
async function settleSharedWallet(c, workspace, job, invocation, charged) {
  if (job.billing_mode !== "wallet_per_call") return;
  const currency =
    invocation.kind === "model" ? "model_micro_cny" : "data_points";
  const reserved = BigInt(invocation.reserved);
  if (reserved === 0n) {
    requireThat(charged === 0n, "wallet_reservation_mismatch", 500);
    return;
  }
  const release = reserved - charged;
  requireThat(
    (
      await c.query(
        "UPDATE wallets SET reserved=reserved-$3,available=available+$4 WHERE workspace_id=$1 AND currency=$2 AND reserved>=$3",
        [workspace, currency, reserved.toString(), release.toString()],
      )
    ).rowCount,
    "wallet_reservation_mismatch",
    500,
  );
  for (const [operation, amount] of [
    ["charge", charged],
    ["release", release],
  ])
    if (amount > 0n)
      await c.query(
        "INSERT INTO ledger(id,workspace_id,currency,operation,amount,reference,detail) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          id(),
          workspace,
          currency,
          operation,
          amount.toString(),
          invocation.id,
          { job_id: job.id },
        ],
      );
}
export async function settleInvocation(
  db,
  store,
  scope,
  invocation,
  bytes,
  {
    sale,
    procurement,
    usage,
    providerId,
    mime = "application/json",
    onSettled = async () => {},
  },
) {
  return db.tenant(scope.workspace_id, async (c) => {
    // Response settlement remains valid after cancellation or lease loss; idempotency is tied to invocation ID.
    const inv = (
      await c.query("SELECT * FROM invocations WHERE id=$1 FOR UPDATE", [
        invocation.id,
      ])
    ).rows[0];
    requireThat(inv, "invocation_not_found", 404);
    if (inv.state === "succeeded" || inv.state === "rejected") return inv;
    const j = (
      await c.query("SELECT * FROM jobs WHERE id=$1 FOR UPDATE", [inv.job_id])
    ).rows[0];
    const bound = BigInt(inv.reserved);
    const capped = sale > bound ? bound : sale;
    const a = await saveArtifact(c, store, scope.workspace_id, bytes, {
      name: `${inv.id}.json`,
      mime,
      kind: "evidence",
    });
    const stem = inv.kind === "model" ? "model" : "data";
    await c.query(
      `UPDATE jobs SET ${stem}_inflight=${stem}_inflight-$2,${stem}_spent=${stem}_spent+$3,updated_at=now() WHERE id=$1`,
      [j.id, inv.reserved, capped.toString()],
    );
    await settleSharedWallet(c, scope.workspace_id, j, inv, capped);
    const r = (
      await c.query(
        "UPDATE invocations SET state='succeeded',charged=$2,procurement=$3,usage=$4,artifact_id=$5,provider_request_id=$6 WHERE id=$1 RETURNING *",
        [
          inv.id,
          capped.toString(),
          procurement.toString(),
          {
            ...inv.usage,
            ...usage,
            ...(sale > bound
              ? {
                  platform_absorbed: (sale - bound).toString(),
                  bound_breached: true,
                }
              : {}),
          },
          a.id,
          providerId || null,
        ],
      )
    ).rows[0];
    if (inv.kind === "data")
      await c.query(
        "INSERT INTO data_usage_daily(connection_id,live_calls,cache_hits,charged_units) VALUES($1,$2,$3,$4) ON CONFLICT(day,connection_id) DO UPDATE SET live_calls=data_usage_daily.live_calls+EXCLUDED.live_calls,cache_hits=data_usage_daily.cache_hits+EXCLUDED.cache_hits,charged_units=data_usage_daily.charged_units+EXCLUDED.charged_units",
        [
          j.snapshot.data.id,
          usage?.cache_hit ? 0 : 1,
          usage?.cache_hit ? 1 : 0,
          capped.toString(),
        ],
      );
    await onSettled(c);
    if (sale > bound && inv.kind === "model") {
      await c.query("UPDATE connections SET enabled=false WHERE id=$1", [
        j.snapshot.model.id,
      ]);
      await c.query(
        "UPDATE jobs SET cancel_requested=true,error_code='provider_usage_bound_breached' WHERE id=$1",
        [j.id],
      );
      await jobEvent(
        c,
        scope.workspace_id,
        j.id,
        "guardrail",
        "供应商用量超过请求上限，连接已暂停；超预算部分由平台承担",
      );
    }
    if (j.status === "reconciling") {
      const current = (await c.query("SELECT * FROM jobs WHERE id=$1", [j.id]))
        .rows[0];
      if (
        BigInt(current.model_inflight) === 0n &&
        BigInt(current.data_inflight) === 0n
      ) {
        await jobEvent(
          c,
          scope.workspace_id,
          current.id,
          "usage_settled",
          "在途调用已完成费用结算，继续处理已保存的研究结果",
        );
        await finishSettledJob(c, store, current);
      }
    }
    return r;
  });
}
export async function uncertainInvocation(
  db,
  scope,
  invocation,
  code,
  details = {},
) {
  if (!invocation) return;
  await db.tenant(scope.workspace_id, async (c) => {
    const changed = await c.query(
      "UPDATE invocations SET state='reconciling' WHERE id=$1 AND state='started'",
      [invocation.id],
    );
    if (!changed.rowCount) return;
    await c.query(
      "UPDATE jobs SET error_code=$2,updated_at=now() WHERE id=$1",
      [scope.job_id, code],
    );
    await jobEvent(
      c,
      scope.workspace_id,
      scope.job_id,
      "reconciling",
      code === "model_response_timeout"
        ? `模型无反应：超过 ${details.timeout_seconds} 秒未返回完整结果，已停止等待，预留费用待核对`
        : "调用结果未能确认，保留额度等待核对",
      { ...details, code, invocation_id: invocation.id },
    );
  });
}
export function makeValidator(db, secrets, tools) {
  return async (connectionId, actor) => {
    const r = (
      await db.query(
        "SELECT c.kind,v.* FROM connections c JOIN connection_versions v ON v.id=c.active_version_id WHERE c.id=$1",
        [connectionId],
      )
    ).rows[0];
    requireThat(r, "connection_not_found", 404);
    const secret = await secrets.read(r.secret_ref, `${connectionId}:${r.id}`);
    let validation;
    if (r.kind === "model") {
      const { response, close } = await providerFetch(r.config.endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: r.config.model,
          input: "Reply OK.",
          max_output_tokens: 128,
          stream: false,
          store: false,
        }),
      });
      try {
        requireThat(response.ok, "model_validation_http_error", 502);
        const data = JSON.parse((await readLimited(response)).toString());
        requireThat(
          data.status === "completed" &&
            Array.isArray(data.output) &&
            data.usage &&
            Number.isSafeInteger(data.usage.input_tokens) &&
            data.usage.input_tokens > 0,
          "model_responses_incompatible",
          409,
        );
        validation = {
          ok: true,
          model: data.model,
          usage: data.usage,
          checked_at: new Date().toISOString(),
          note: "小额模型探测；完整 Agent 协议另行验收",
        };
      } finally {
        await close();
      }
    } else if (r.kind === "fastmoss") {
      const data = await fastmossRpc(
        r.config.endpoint,
        secret,
        "tools/list",
        {},
      );
      requireThat(Array.isArray(data.tools), "fastmoss_tools_missing");
      const live = new Map(data.tools.map((t) => [t.name, t]));
      const drift = tools
        .filter(
          (t) =>
            !live.has(t.name) ||
            digest(t.inputSchema) !== digest(live.get(t.name).inputSchema),
        )
        .map((t) => t.name);
      requireThat(!drift.length, "fastmoss_schema_drift", 409);
      validation = {
        ok: true,
        tool_count: data.tools.length,
        schema_digest: digest(
          tools.map((t) => ({ name: t.name, inputSchema: t.inputSchema })),
        ),
        checked_at: new Date().toISOString(),
      };
    } else if (r.kind === "sellersprite") {
      const catalog = await fastmossRpc(
        r.config.endpoint,
        secret,
        "tools/list",
        {},
        { provider: "sellersprite" },
      );
      const checked = sellerSpriteTools(catalog?.tools);
      validation = {
        ok: true,
        tools: checked,
        tool_count: checked.length,
        schema_digest: sellerSpriteSchemaDigest(checked),
        checked_at: new Date().toISOString(),
      };
    } else throw new AppError("1688_documentation_required", 409);
    await db.tx(null, async (c) => {
      await c.query(
        "UPDATE connection_versions SET verified=true,validation=$2 WHERE id=$1",
        [r.id, validation],
      );
      await c.query(
        "INSERT INTO platform_audit(actor_id,action,target_id,summary) VALUES($1,'connection.validate',$2,$3)",
        [actor, connectionId, validation],
      );
    });
    return validation;
  };
}
export async function installGateway(
  app,
  db,
  store,
  secrets,
  projectRoot,
  overrides = {},
) {
  const gate = new ResourceGate(db, overrides.resourceOptions);
  const cache = new DataCache(db, overrides.cacheOptions);
  const dataRpc = overrides.dataRpc || fastmossRpc;
  const modelFetch = overrides.modelFetch || providerFetch;
  const modelTimeoutMs = overrides.modelTimeoutMs ?? MODEL_RESPONSE_TIMEOUT_MS;
  const { tools } = JSON.parse(
    await readFile(
      new URL("../../../schemas/fastmoss-tools.snapshot.json", import.meta.url),
      "utf8",
    ),
  );
  const ajv = new Ajv({ strict: false, allErrors: true });
  const researchTools = tools.filter((t) => t.name !== "credit_usage_summary");
  const validators = new Map(
    researchTools.map((t) => [t.name, ajv.compile(t.inputSchema)]),
  );
  const cachedBytes = async (scope, inv) =>
    db.tenant(scope.workspace_id, async (c) => {
      const a = (
        await c.query("SELECT * FROM artifacts WHERE id=$1", [inv.artifact_id])
      ).rows[0];
      return { bytes: await store.read(a.object_key, a.sha256), mime: a.mime };
    });
  app.get("/internal/job/tools", { preHandler: app.jobAuth }, async (req) =>
    db.tenant(req.jobScope.workspace_id, async (c) => {
      const job = await lockedLease(c, req.jobScope);
      return {
        tools: dataToolsForJob(job, researchTools).map((tool) => ({
          ...tool,
          billing: {
            live_points:
              job.request?.platform === "amazon"
                ? 1
                : publicDataPricing().tools[tool.name],
            snapshot_points: 0.3,
          },
        })),
      };
    }),
  );
  const authorize = (scope, kind) =>
    db.tenant(scope.workspace_id, async (c) => {
      const job = await lockedLease(c, scope);
      await assertWorkspaceAccess(c, scope.workspace_id, job.created_by);
      const snapshot = job.snapshot[kind === "model" ? "model" : "data"];
      requireThat(snapshot, "connection_missing", 409);
      const connection = await currentConnection(
        c,
        snapshot,
        scope.workspace_id,
      );
      return { job, connection };
    });
  const previousCall = (scope, key) =>
    db.tenant(scope.workspace_id, async (c) => {
      await lockedLease(c, scope);
      const old = (
        await c.query(
          "SELECT * FROM invocations WHERE job_id=$1 AND operation_key=$2",
          [scope.job_id, key],
        )
      ).rows[0];
      if (old)
        requireThat(
          old.state === "succeeded",
          "invocation_pending_reconciliation",
          409,
        );
      return old;
    });
  const callData = async (scope, body) => {
    const v = z
      .object({
        name: z.string(),
        arguments: z.record(z.string(), z.unknown()),
      })
      .strict()
      .parse(body);
    const key = "data:" + digest(v);
    const access = await authorize(scope, "data");
    const jobTools = dataToolsForJob(access.job, researchTools);
    const definition = jobTools.find((t) => t.name === v.name);
    requireThat(definition, "data_tool_forbidden", 403);
    const check =
      access.job.request?.platform === "amazon"
        ? ajv.compile(definition.inputSchema)
        : validators.get(v.name);
    requireThat(check && check(v.arguments), "data_input_invalid");
    if (access.job.kind === "monitoring")
      requireThat(
        collectionPlan(access.job.request.seller_id).some(
          (call) => digest(call) === digest(v),
        ),
        "monitor_tool_forbidden",
        403,
      );
    const old = await previousCall(scope, key);
    if (old)
      return JSON.parse((await cachedBytes(scope, old)).bytes.toString());
    const schema = definition.inputSchema;
    const meta = {
      source: platformSpec(access.job.request).source,
      connectionId: access.job.snapshot.data.id,
      config: access.connection.config,
      shared: access.connection.share_market_snapshots,
      workspace: scope.workspace_id,
      tool: v.name,
      schema,
      schemaDigest: digest(schema),
      args: v.arguments,
    };
    meta.key = snapshotKey(meta);
    const selection = await cache.lookupOrClaim(scope, meta, () =>
      authorize(scope, "data"),
    );
    let prepared,
      release,
      dispatched = false,
      price;
    try {
      if (selection.snapshot) {
        const snap = selection.snapshot;
        requireThat(
          digest(snap.payload) === snap.sha256,
          "snapshot_integrity",
          503,
        );
        prepared = await beginInvocation(
          db,
          scope,
          "data",
          key,
          () => CACHE_POINTS,
          {
            tool: v.name,
            arguments: v.arguments,
            pricing: { version: "snapshot-v1", points: 0.3 },
          },
        );
        if (prepared.cached)
          return JSON.parse(
            (await cachedBytes(scope, prepared.cached)).bytes.toString(),
          );
        const envelope = {
          ...snap.payload,
          invocation_id: prepared.invocation.id,
          snapshot_id: snap.id,
          cache_hit: true,
          points_charged: 0.3,
          served_at: new Date().toISOString(),
        };
        await settleInvocation(
          db,
          store,
          scope,
          prepared.invocation,
          Buffer.from(JSON.stringify(envelope)),
          {
            sale: CACHE_POINTS,
            procurement: 0n,
            usage: {
              points: 0.3,
              tool: v.name,
              cache_hit: true,
              snapshot_id: snap.id,
              captured_at: snap.captured_at,
              outcome: "success",
              pricing_version: "snapshot-v1",
            },
          },
        );
        return envelope;
      }
      price = liveDataPrice(platformSpec(access.job.request).provider, v.name);
      const resource = await resourceFor(db, meta.connectionId);
      release = await gate.acquire(resource, scope.workspace_id, () =>
        authorize(scope, "data"),
      );
      const secret = await secrets.read(
        access.connection.secret_ref,
        `${meta.connectionId}:${access.connection.id}`,
      );
      prepared = await beginInvocation(
        db,
        scope,
        "data",
        key,
        () => price.units,
        {
          tool: v.name,
          arguments: v.arguments,
          pricing: { version: price.version, points: price.points },
        },
        (c, inv) => cache.start(scope, selection.fetch, inv, c),
      );
      if (prepared.cached) {
        await cache.fail(scope, selection.fetch, false, "idempotent_replay");
        return JSON.parse(
          (await cachedBytes(scope, prepared.cached)).bytes.toString(),
        );
      }
      dispatched = true;
      const data = await dataRpc(
        prepared.connection.config.endpoint,
        secret,
        "tools/call",
        v,
        {
          provider: platformSpec(access.job.request).provider,
          onResponse: (r) => cache.capture(scope, selection.fetch, r),
          onRateLimit: (value) => gate.cooldown(resource, value),
        },
      );
      const captured = (
        await db.query("SELECT clock_timestamp() AS captured")
      ).rows[0].captured.toISOString();
      const outcome =
        meta.source === "FastMoss" ? fastmossOutcome(data) : "success";
      // Free helper tools may return prose. A paid unrecognizable response needs reconciliation.
      requireThat(
        outcome !== "unknown" || price.units === 0n,
        "data_response_unrecognized",
        502,
      );
      const billed = ["empty", "failed"].includes(outcome) ? 0n : price.units;
      const payload = {
        source: platformSpec(access.job.request).source,
        tool: v.name,
        request: v.arguments,
        captured_at: captured,
        result: data,
        decoded: decodeMcpContent(data),
      };
      const snap = {
        id: id(),
        payload,
        captured_at: captured,
        expires_at: new Date(
          Date.parse(captured) + selection.ttl * 1000,
        ).toISOString(),
        reusable: reusableResponse(data, meta.source) && outcome === "success",
      };
      const envelope = {
        ...payload,
        invocation_id: prepared.invocation.id,
        snapshot_id: snap.id,
        cache_hit: false,
        points_charged: Number(points(billed)),
        billing: { version: price.version, live_points: price.points, outcome },
        served_at: captured,
      };
      await settleInvocation(
        db,
        store,
        scope,
        prepared.invocation,
        Buffer.from(JSON.stringify(envelope)),
        {
          sale: billed,
          procurement: billed,
          usage: {
            points: Number(points(billed)),
            pricing_version: price.version,
            live_points: price.points,
            outcome,
            tool: v.name,
            cache_hit: false,
            snapshot_id: snap.id,
            captured_at: captured,
          },
          onSettled: (c) => cache.publish(c, selection.fetch, snap),
        },
      );
      return envelope;
    } catch (e) {
      if (
        e.detail?.data_no_charge &&
        prepared?.invocation &&
        !prepared.cached
      ) {
        const captured = new Date().toISOString();
        const outcome = e.detail.outcome;
        const payload = {
          source: meta.source,
          tool: v.name,
          request: v.arguments,
          captured_at: captured,
          result: {
            isError: true,
            content: [
              { type: "text", text: JSON.stringify({ error: e.code }) },
            ],
          },
          decoded: [],
        };
        const snap = {
          id: id(),
          payload,
          captured_at: captured,
          expires_at: captured,
          reusable: false,
        };
        try {
          await settleInvocation(
            db,
            store,
            scope,
            prepared.invocation,
            Buffer.from(
              JSON.stringify({
                ...payload,
                invocation_id: prepared.invocation.id,
                snapshot_id: snap.id,
                cache_hit: false,
                points_charged: 0,
                served_at: captured,
                billing: {
                  version: price.version,
                  live_points: price.points,
                  outcome,
                },
              }),
            ),
            {
              sale: 0n,
              procurement: 0n,
              usage: {
                points: 0,
                tool: v.name,
                cache_hit: false,
                outcome,
                pricing_version: price.version,
                live_points: price.points,
                snapshot_id: snap.id,
                captured_at: captured,
                error_code: e.code,
              },
              onSettled: (c) => cache.publish(c, selection.fetch, snap),
            },
          );
        } catch (settlementError) {
          await cache.fail(
            scope,
            selection.fetch,
            dispatched,
            "data_settlement_failed",
          );
          await uncertainInvocation(
            db,
            scope,
            prepared.invocation,
            "data_settlement_failed",
          );
          throw settlementError;
        }
        throw e;
      }
      await cache.fail(
        scope,
        selection.fetch,
        dispatched,
        e.code || "data_call_uncertain",
      );
      await uncertainInvocation(
        db,
        scope,
        prepared?.invocation,
        e.code || "data_call_uncertain",
      );
      throw e;
    } finally {
      await release?.();
    }
  };
  app.post("/internal/job/data", { preHandler: app.jobAuth }, (req) =>
    callData(req.jobScope, req.body),
  );
  const modelResponse = async (req, reply) => {
    const body = req.body;
    requireThat(
      body && Array.isArray(body.input) && Array.isArray(body.tools || []),
      "invalid_responses_body",
    );
    requireThat(
      !body.previous_response_id &&
        !body.background &&
        !body.conversation &&
        !body.include?.some((x) => String(x).includes("web_search")),
      "unsupported_response_features",
    );
    requireThat(clientToolsOnly(body.tools || []), "remote_tools_forbidden");
    const adapted = adaptClientTools(body);
    const operation = "model:" + digest(body);
    const requestTokenBound = serializedRequestTokenBound(body);
    const access = await authorize(req.jobScope, "model");
    if (access.job.kind === "monitoring")
      requireThat(
        access.job.request.config.ai_enabled && !(body.tools || []).length,
        "monitor_model_forbidden",
        403,
      );
    const prior = await previousCall(req.jobScope, operation);
    if (prior) {
      const old = await cachedBytes(req.jobScope, prior);
      return reply.type(old.mime).send(old.bytes);
    }
    const resource = await resourceFor(db, access.job.snapshot.model.id);
    const release = await gate.acquire(
      resource,
      req.jobScope.workspace_id,
      () => authorize(req.jobScope, "model"),
    );
    const outgoing = await (async () => {
      let p,
        outputLimit,
        modelSignal,
        responseReceived = false;
      try {
        p = await beginInvocation(
          db,
          req.jobScope,
          "model",
          operation,
          (j, available) => {
            requireThat(
              requestTokenBound <= j.snapshot.model.price.max_context_tokens,
              "model_context_budget_exceeded",
              409,
            );
            const budget = modelCallBudget(
              j.snapshot.model.price,
              requestTokenBound,
              available,
              body.max_output_tokens,
              j.billing_mode === "wallet_per_call"
                ? "insufficient_model_micro_cny"
                : "task_budget_exhausted",
            );
            outputLimit = budget.max_output_tokens;
            return budget.reserved;
          },
          {
            purpose: ["context_compaction", "format_repair"].includes(
              body.metadata?.tidelab_purpose,
            )
              ? body.metadata.tidelab_purpose
              : "answer",
          },
        );
        if (p.cached) {
          const old = await cachedBytes(req.jobScope, p.cached);
          return old;
        }
        try {
          const config = p.job.snapshot.model.config,
            card = p.job.snapshot.model.price;
          const secret = await secrets.read(
            p.connection.secret_ref,
            `${p.job.snapshot.model.id}:${p.connection.id}`,
          );
          const request = {
            ...adapted.request,
            model: config.model,
            max_output_tokens: outputLimit,
            store: false,
            stream:
              config.upstream_streaming === true &&
              body.stream !== false &&
              !adapted.hasNamespaces,
          };
          delete request.service_tier;
          delete request.user;
          delete request.safety_identifier;
          delete request.metadata;
          const pricingAt = new Date();
          modelSignal = AbortSignal.timeout(modelTimeoutMs);
          const { response, close } = await modelFetch(config.endpoint, {
            method: "POST",
            signal: modelSignal,
            transportTimeoutMs: MODEL_TRANSPORT_TIMEOUT_MS,
            headers: {
              Authorization: `Bearer ${secret}`,
              "X-Client-Request-Id": p.invocation.id,
              "Content-Type": "application/json",
              Accept: request.stream ? "text/event-stream" : "application/json",
            },
            body: JSON.stringify(request),
          });
          try {
            if (response.status === 429)
              await gate.cooldown(
                resource,
                response.headers.get("Retry-After"),
              );
            requireThat(response.ok, "model_provider_http_error", 502);
            const bytes = await readLimited(response);
            responseReceived = true;
            const raw = bytes.toString().replaceAll(secret, "[REDACTED]");
            const isSse = response.headers
              .get("Content-Type")
              ?.includes("text/event-stream");
            const events = isSse ? parseSse(raw) : [];
            const result = isSse
              ? events.findLast((e) =>
                  ["response.completed", "response.incomplete"].includes(
                    e.type,
                  ),
                )?.response
              : adapted.restore(JSON.parse(raw));
            requireThat(result?.usage, "model_usage_missing", 502);
            const cost = charges(result.usage, card, pricingAt);
            const replay = !isSse && body.stream !== false;
            const mime =
              isSse || replay ? "text/event-stream" : "application/json";
            const safe = Buffer.from(
              replay
                ? responseEventStream(result)
                : isSse
                  ? raw
                  : JSON.stringify(result),
            );
            await settleInvocation(
              db,
              store,
              req.jobScope,
              p.invocation,
              safe,
              {
                sale: cost.sale,
                procurement: cost.procurement,
                usage: {
                  raw: result.usage,
                  normalized: cost.normalized,
                  price_id: p.job.snapshot.model.price_id,
                  pricing_at: pricingAt.toISOString(),
                  upstream_streaming: isSse,
                  response_status: result.status,
                  max_output_tokens: outputLimit,
                  incomplete_reason: result.incomplete_details?.reason || null,
                },
                providerId: result.id,
                mime,
              },
            );
            if (result.status === "incomplete")
              await db.tenant(req.jobScope.workspace_id, (c) =>
                jobEvent(
                  c,
                  req.jobScope.workspace_id,
                  p.job.id,
                  "model_incomplete",
                  "模型本轮输出未完成，已保留调用记录和已采集数据",
                  {
                    reason: result.incomplete_details?.reason || "unknown",
                    invocation_id: p.invocation.id,
                  },
                ),
              );
            return { mime, bytes: safe };
          } finally {
            await close();
          }
        } catch (e) {
          const timedOut = !responseReceived && modelSignal?.aborted;
          const error = timedOut
            ? new AppError("model_response_timeout", 504)
            : e;
          await uncertainInvocation(
            db,
            req.jobScope,
            p?.invocation,
            error.code || "model_call_uncertain",
            timedOut ? { timeout_seconds: modelTimeoutMs / 1000 } : {},
          );
          throw error;
        }
      } finally {
        await release();
      }
    })();
    return reply.type(outgoing.mime).send(outgoing.bytes);
  };
  app.post(
    "/internal/job/v1/responses",
    { preHandler: app.jobAuth, bodyLimit: 8 * 1024 * 1024 },
    modelResponse,
  );
  app.get(
    "/api/admin/workspaces/:id/invocations",
    { preHandler: app.admin },
    async (req) =>
      db.tenant(uuid.parse(req.params.id), async (c) => ({
        items: (
          await c.query(
            "SELECT id,job_id,kind,state,reserved,charged,procurement,usage,provider_request_id,created_at FROM invocations ORDER BY created_at DESC LIMIT 100",
          )
        ).rows,
      })),
  );
  app.post(
    "/api/admin/workspaces/:id/invocations/:inv/resolve",
    { preHandler: app.admin },
    async (req) => {
      const wid = uuid.parse(req.params.id);
      const v = z
        .object({
          charged: z.string().regex(/^\d+(\.\d)?$/),
          procurement: z.string().regex(/^\d+(\.\d)?$/),
          provider_reference: z.string().min(5).max(500),
          note: z.string().min(5).max(1000),
        })
        .strict()
        .parse(req.body);
      return db.tenant(wid, async (c) => {
        const inv = (
          await c.query(
            "SELECT * FROM invocations WHERE id=$1 AND state='reconciling' FOR UPDATE",
            [uuid.parse(req.params.inv)],
          )
        ).rows[0];
        requireThat(inv, "unresolved_invocation_not_found", 404);
        const job = (
          await c.query("SELECT * FROM jobs WHERE id=$1 FOR UPDATE", [
            inv.job_id,
          ])
        ).rows[0];
        requireThat(
          job.status !== "running",
          "stop_worker_before_reconcile",
          409,
        );
        v.charged = (
          inv.kind === "data"
            ? pointUnits(v.charged)
            : BigInt(z.string().regex(/^\d+$/).parse(v.charged))
        ).toString();
        v.procurement = (
          inv.kind === "data"
            ? pointUnits(v.procurement)
            : BigInt(z.string().regex(/^\d+$/).parse(v.procurement))
        ).toString();
        requireThat(
          BigInt(v.charged) <= BigInt(inv.reserved),
          "reconciliation_exceeds_reserved",
        );
        const stem = inv.kind === "model" ? "model" : "data";
        await c.query(
          "UPDATE invocations SET state='rejected',charged=$2,procurement=$3,provider_request_id=$4,usage=usage||$5 WHERE id=$1",
          [
            inv.id,
            v.charged,
            v.procurement,
            v.provider_reference,
            { reconciliation_note: v.note },
          ],
        );
        const j = (
          await c.query(
            `UPDATE jobs SET ${stem}_inflight=${stem}_inflight-$2,${stem}_spent=${stem}_spent+$3 WHERE id=$1 RETURNING *`,
            [job.id, inv.reserved, v.charged],
          )
        ).rows[0];
        await settleSharedWallet(c, wid, job, inv, BigInt(v.charged));
        await c.query(
          "INSERT INTO platform_audit(actor_id,action,target_id,summary) VALUES($1,'invocation.resolve',$2,$3)",
          [req.identity.id, inv.id, v],
        );
        if (BigInt(j.model_inflight) === 0n && BigInt(j.data_inflight) === 0n)
          await finalizeJob(
            c,
            wid,
            j,
            j.cancel_requested ? "cancelled" : "failed",
            j.result,
            "reconciled_call_failure",
          );
        return { ok: true };
      });
    },
  );
  return {
    validateConnection: makeValidator(db, secrets, tools),
    tools,
    callData,
    callModel: (scope, body) =>
      modelResponse(
        { jobScope: scope, body: { ...body, stream: false } },
        {
          type() {
            return this;
          },
          send(bytes) {
            return JSON.parse(bytes.toString());
          },
        },
      ),
  };
}
