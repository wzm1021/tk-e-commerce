import { id, digest, requireThat, AppError } from "../common/core.mjs";
import { setTimeout as sleep } from "node:timers/promises";
import { fastmossOutcome } from "./response-outcome.mjs";

export function snapshotKey({
  source = "FastMoss",
  connectionId,
  config,
  workspace,
  shared,
  tool,
  schema,
  args,
}) {
  return digest({
    v: 1,
    source,
    connection: connectionId,
    config,
    scope: shared ? "platform" : workspace,
    tool,
    schema: digest(schema),
    arguments: args,
  });
}
export function reusableResponse(result, source = "FastMoss") {
  // Business errors inside the supplier envelope are never used as successful cache hits.
  if (!result || result.isError === true || result.error) return false;
  for (const part of result.content || [])
    if (part.type === "text") {
      try {
        const v = JSON.parse(part.text);
        if (
          v &&
          (v.error ||
            v.success === false ||
            v.isError === true ||
            (v.code != null &&
              ![0, 200, "0", "200", "SUCCESS"].includes(v.code) &&
              !(source === "SellerSprite" && v.code === "OK")))
        )
          return false;
      } catch {
        /* Plain text MCP results remain evidence but are not cacheable. */ return false;
      }
    }
  return Boolean(result.structuredContent || result.content?.length);
}
export class DataCache {
  constructor(db, { waitMs = 210000, pollMs = 700 } = {}) {
    this.db = db;
    this.waitMs = waitMs;
    this.pollMs = pollMs;
  }
  async lookupOrClaim(scope, meta, check) {
    const until = Date.now() + this.waitMs;
    do {
      await check();
      const result = await this.db.tenant(scope.workspace_id, async (c) => {
        const policy = (
          await c.query(
            "SELECT ttl_seconds FROM data_cache_policies WHERE tool IN($1,'*') ORDER BY (tool=$1) DESC LIMIT 1",
            [meta.tool],
          )
        ).rows[0];
        const ttl = policy.ttl_seconds;
        const snapshot = (
          await c.query(
            "SELECT * FROM data_snapshots WHERE cache_key=$1 AND reusable AND expires_at>now() AND captured_at>now()-$2*interval '1 second' ORDER BY captured_at DESC LIMIT 1",
            [meta.key, ttl],
          )
        ).rows[0];
        const usable = (s) =>
          s &&
          (meta.source !== "FastMoss" ||
            fastmossOutcome(s.payload.result) === "success");
        if (usable(snapshot)) return { snapshot };
        // Never hold a pooled connection waiting for another caller's lookup lock.
        const lock = (
          await c.query(
            "SELECT pg_try_advisory_xact_lock(hashtextextended($1,93419732)) AS acquired",
            [meta.key],
          )
        ).rows[0];
        if (!lock.acquired) return null;
        // A publisher may have committed between the optimistic read and this lock.
        const published = (
          await c.query(
            "SELECT * FROM data_snapshots WHERE cache_key=$1 AND reusable AND expires_at>now() AND captured_at>now()-$2*interval '1 second' ORDER BY captured_at DESC LIMIT 1",
            [meta.key, ttl],
          )
        ).rows[0];
        if (usable(published)) return { snapshot: published };
        const pending = (
          await c.query(
            "SELECT *,expires_at>clock_timestamp() AS lease_valid FROM data_fetches WHERE cache_key=$1 AND state IN('queued','started','uncertain') FOR UPDATE",
            [meta.key],
          )
        ).rows[0];
        if (pending) {
          if (pending.state === "uncertain")
            throw new AppError("data_fetch_pending_reconciliation", 409);
          if (pending.lease_valid) return null;
          if (pending.state === "started") {
            await c.query(
              "UPDATE data_fetches SET state='uncertain',error_code='data_fetch_lease_expired' WHERE id=$1",
              [pending.id],
            );
            return { uncertain: true };
          }
          await c.query(
            "UPDATE data_fetches SET state='aborted',completed_at=now(),error_code='queue_lease_expired' WHERE id=$1",
            [pending.id],
          );
        }
        const fetch = (
          await c.query(
            "INSERT INTO data_fetches(id,cache_key,connection_id,scope_workspace_id,owner_workspace_id,tool,arguments,schema_digest,state,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'queued',now()+interval '75 seconds') RETURNING *",
            [
              id(),
              meta.key,
              meta.connectionId,
              meta.shared ? null : scope.workspace_id,
              scope.workspace_id,
              meta.tool,
              meta.args,
              meta.schemaDigest,
            ],
          )
        ).rows[0];
        return { fetch, ttl };
      });
      if (result?.uncertain)
        throw new AppError("data_fetch_pending_reconciliation", 409);
      if (result) return result;
      await sleep(
        Math.min(
          this.pollMs + Math.floor(Math.random() * 150),
          Math.max(1, until - Date.now()),
        ),
      );
    } while (Date.now() < until);
    throw new AppError("data_fetch_wait_timeout", 429);
  }
  async start(scope, fetch, invocation, c) {
    // Called in the billing reservation transaction, before any provider I/O.
    requireThat(
      (
        await c.query(
          "UPDATE data_fetches SET state='started',invocation_id=$2,expires_at=now()+interval '5 minutes' WHERE id=$1 AND state='queued' AND expires_at>now() AND owner_workspace_id=$3 RETURNING id",
          [fetch.id, invocation.id, scope.workspace_id],
        )
      ).rowCount,
      "data_fetch_lease_lost",
      409,
    );
  }
  async capture(scope, fetch, response) {
    await this.db.tenant(scope.workspace_id, (c) =>
      c.query(
        "INSERT INTO data_provider_responses(id,fetch_id,http_status,body) VALUES($1,$2,$3,$4)",
        [id(), fetch.id, response.status, response.raw],
      ),
    );
  }
  async publish(c, fetch, snapshot) {
    // Publish and lookup use the same lock: avoid a missing snapshot followed by a vanished pending row.
    await c.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1,93419732))",
      [fetch.cache_key],
    );
    requireThat(
      (
        await c.query(
          "UPDATE data_fetches SET state=$2,completed_at=now() WHERE id=$1 AND state IN('started','uncertain') RETURNING id",
          [fetch.id, snapshot.reusable ? "succeeded" : "failed"],
        )
      ).rowCount,
      "data_fetch_lease_lost",
      409,
    );
    await c.query(
      "INSERT INTO data_snapshots(id,fetch_id,cache_key,connection_id,scope_workspace_id,tool,payload,sha256,captured_at,expires_at,reusable,size_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [
        snapshot.id,
        fetch.id,
        fetch.cache_key,
        fetch.connection_id,
        fetch.scope_workspace_id,
        fetch.tool,
        snapshot.payload,
        digest(snapshot.payload),
        snapshot.captured_at,
        snapshot.expires_at,
        snapshot.reusable,
        Buffer.byteLength(JSON.stringify(snapshot.payload)),
      ],
    );
  }
  async fail(scope, fetch, dispatched, code) {
    if (!fetch) return;
    await this.db.tenant(scope.workspace_id, (c) =>
      c.query(
        "UPDATE data_fetches SET state=$2,error_code=$3,completed_at=now() WHERE id=$1 AND state IN('queued','started')",
        [fetch.id, dispatched ? "uncertain" : "aborted", code],
      ),
    );
  }
}
