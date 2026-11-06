import { id, requireThat, AppError } from "../common/core.mjs";
import { setTimeout as sleep } from "node:timers/promises";

// Provider host is the conservative default quota boundary, including separate model connections.
export function defaultResourceKey(kind, endpoint) {
  return `${kind}:${new URL(endpoint).hostname}`;
}
export async function resourceFor(db, connectionId) {
  return db.tx(null, async (c) => {
    const row = (
      await c.query(
        "SELECT c.kind,c.resource_key,v.config FROM connections c JOIN connection_versions v ON v.id=c.active_version_id WHERE c.id=$1",
        [connectionId],
      )
    ).rows[0];
    requireThat(row, "connection_not_found", 404);
    const key =
      row.resource_key || defaultResourceKey(row.kind, row.config.endpoint);
    await c.query(
      "INSERT INTO api_resource_groups(key,kind,max_concurrent,max_per_workspace,requests_per_minute) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
      [
        key,
        row.kind,
        row.kind === "model" ? 4 : 8,
        row.kind === "model" ? 2 : 4,
        row.kind === "model" ? 60 : 120,
      ],
    );
    await c.query(
      "UPDATE connections SET resource_key=$2 WHERE id=$1 AND resource_key IS NULL",
      [connectionId, key],
    );
    return key;
  });
}

export class ResourceGate {
  constructor(db, { waitMs = 45000, pollMs = 500 } = {}) {
    this.db = db;
    this.waitMs = waitMs;
    this.pollMs = pollMs;
  }
  async acquire(key, workspace, check = async () => {}) {
    const ticket = id();
    await check();
    await this.db.tx(null, async (c) => {
      const p = (
        await c.query(
          "SELECT *,cooldown_until>clock_timestamp() AS cooling FROM api_resource_groups WHERE key=$1 FOR UPDATE",
          [key],
        )
      ).rows[0];
      requireThat(p, "resource_not_found", 404);
      // Keep a bounded rate history. Expired active slots outlive the upstream hard timeout.
      await c.query(
        "DELETE FROM api_resource_tickets WHERE resource_key=$1 AND expires_at<now() AND (started_at IS NULL OR started_at<now()-interval '1 minute')",
        [key],
      );
      const n = (
        await c.query(
          "SELECT count(*) AS n FROM api_resource_tickets WHERE resource_key=$1 AND state='queued' AND expires_at>now()",
          [key],
        )
      ).rows[0];
      requireThat(Number(n.n) < p.queue_limit, "resource_queue_full", 429);
      await c.query(
        "INSERT INTO api_resource_tickets(id,resource_key,workspace_id,state,expires_at) VALUES($1,$2,$3,'queued',now()+$4*interval '1 millisecond')",
        [ticket, key, workspace, this.waitMs + 10000],
      );
    });
    const until = Date.now() + this.waitMs;
    try {
      do {
        await check();
        const granted = await this.db.tx(null, async (c) => {
          const p = (
            await c.query(
              "SELECT *,cooldown_until>clock_timestamp() AS cooling FROM api_resource_groups WHERE key=$1 FOR UPDATE",
              [key],
            )
          ).rows[0];
          if (p.cooling) return false;
          const counts = (
            await c.query(
              "SELECT count(*) FILTER(WHERE state='active' AND expires_at>now()) AS active,count(*) FILTER(WHERE state='active' AND expires_at>now() AND workspace_id=$2) AS own,count(*) FILTER(WHERE started_at>now()-interval '1 minute') AS recent FROM api_resource_tickets WHERE resource_key=$1",
              [key, workspace],
            )
          ).rows[0];
          if (
            Number(counts.active) >= p.max_concurrent ||
            Number(counts.own) >= p.max_per_workspace ||
            Number(counts.recent) >= p.requests_per_minute
          )
            return false;
          // FIFO among eligible tenants. A tenant already at its cap cannot block other tenants.
          const next = (
            await c.query(
              "SELECT q.id FROM api_resource_tickets q WHERE q.resource_key=$1 AND q.state='queued' AND q.expires_at>now() AND (SELECT count(*) FROM api_resource_tickets a WHERE a.resource_key=q.resource_key AND a.workspace_id=q.workspace_id AND a.state='active' AND a.expires_at>now())<$2 ORDER BY q.created_at,q.id LIMIT 1",
              [key, p.max_per_workspace],
            )
          ).rows[0];
          if (next?.id !== ticket) return false;
          return (
            (
              await c.query(
                "UPDATE api_resource_tickets SET state='active',started_at=clock_timestamp(),expires_at=now()+interval '15 minutes' WHERE id=$1 AND state='queued' AND expires_at>now() RETURNING id",
                [ticket],
              )
            ).rowCount === 1
          );
        });
        if (granted) {
          let released = false;
          return async () => {
            if (released) return;
            await this.db.query(
              "UPDATE api_resource_tickets SET state='done',expires_at=now()+interval '1 minute' WHERE id=$1",
              [ticket],
            );
            released = true;
          };
        }
        await sleep(
          Math.min(
            this.pollMs + Math.floor(Math.random() * 100),
            Math.max(1, until - Date.now()),
          ),
        );
      } while (Date.now() < until);
      throw new AppError("resource_queue_timeout", 429);
    } catch (e) {
      await this.db.query(
        "UPDATE api_resource_tickets SET state='done',expires_at=now() WHERE id=$1 AND state='queued'",
        [ticket],
      );
      throw e;
    }
  }
  async cooldown(key, retryAfter) {
    const seconds = /^\d+$/.test(String(retryAfter))
      ? Number(retryAfter)
      : (Date.parse(retryAfter) - Date.now()) / 1000;
    await this.db.query(
      "UPDATE api_resource_groups SET cooldown_until=GREATEST(cooldown_until,now()+$2*interval '1 second') WHERE key=$1",
      [
        key,
        Math.min(300, Math.max(1, Number.isFinite(seconds) ? seconds : 30)),
      ],
    );
  }
}
