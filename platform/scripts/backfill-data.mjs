import { readFile } from "node:fs/promises";
import { id, digest } from "../src/common/core.mjs";
import { snapshotKey, DataCache, reusableResponse } from "../src/data/data-cache.mjs";
import { parseEvidenceJson } from "../src/data/evidence.mjs";

// Copies existing verified evidence without a provider call or any billing mutation.
export async function backfillData(db, store, { actor = null } = {}) {
  const { tools } = JSON.parse(
    await readFile(
      new URL("../../schemas/fastmoss-tools.snapshot.json", import.meta.url),
      "utf8",
    ),
  );
  const catalog = new Map(tools.map((t) => [t.name, t.inputSchema])),
    cache = new DataCache(db);
  const summary = { imported: 0, already_imported: 0, skipped: 0 };
  for (const { id: workspace } of (
    await db.query("SELECT id FROM workspaces ORDER BY id")
  ).rows) {
    let after = "00000000-0000-0000-0000-000000000000";
    for (;;) {
      const rows = await db.tenant(
        workspace,
        async (c) =>
          (
            await c.query(
              "SELECT i.id,a.object_key,a.sha256,j.snapshot->'data' AS connection FROM invocations i JOIN artifacts a ON a.id=i.artifact_id JOIN jobs j ON j.id=i.job_id WHERE i.kind='data' AND i.state='succeeded' AND i.usage->>'test_only' IS DISTINCT FROM 'true' AND i.usage->>'snapshot_id' IS NULL AND i.id>$1 ORDER BY i.id LIMIT 100",
              [after],
            )
          ).rows,
      );
      if (!rows.length) break;
      for (const inv of rows) {
        after = inv.id;
        const existing = await db.tenant(workspace, (c) =>
          c.query("SELECT id FROM data_fetches WHERE invocation_id=$1", [
            inv.id,
          ]),
        );
        if (existing.rowCount) {
          summary.already_imported++;
          continue;
        }
        let envelope;
        try {
          envelope = parseEvidenceJson(
            (await store.read(inv.object_key, inv.sha256)).toString(),
          );
        } catch {
          summary.skipped++;
          continue;
        }
        const schema = catalog.get(envelope.tool),
          stamp = Date.parse(envelope.captured_at);
        if (
          envelope.source !== "FastMoss" ||
          !schema ||
          !Number.isFinite(stamp) ||
          !envelope.result ||
          !envelope.request ||
          !inv.connection
        ) {
          summary.skipped++;
          continue;
        }
        await db.tenant(workspace, async (c) => {
          await c.query("SELECT set_config('app.platform_admin','true',true)");
          const source = (
            await c.query(
              "SELECT share_market_snapshots FROM connections WHERE id=$1",
              [inv.connection.id],
            )
          ).rows[0];
          if (!source) {
            summary.skipped++;
            return;
          }
          const key = snapshotKey({
            connectionId: inv.connection.id,
            config: inv.connection.config,
            workspace,
            shared: source.share_market_snapshots,
            tool: envelope.tool,
            schema,
            args: envelope.request,
          });
          const f = (
            await c.query(
              "INSERT INTO data_fetches(id,cache_key,connection_id,scope_workspace_id,owner_workspace_id,tool,arguments,schema_digest,state,expires_at,invocation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'started',now(),$9) ON CONFLICT DO NOTHING RETURNING *",
              [
                id(),
                key,
                inv.connection.id,
                source.share_market_snapshots ? null : workspace,
                workspace,
                envelope.tool,
                envelope.request,
                digest(schema),
                inv.id,
              ],
            )
          ).rows[0];
          if (!f) {
            summary.skipped++;
            return;
          }
          const payload = {
            source: envelope.source,
            tool: envelope.tool,
            request: envelope.request,
            captured_at: envelope.captured_at,
            result: envelope.result,
            decoded: envelope.decoded || [],
          };
          const ttl = (
            await c.query(
              "SELECT ttl_seconds FROM data_cache_policies WHERE tool IN($1,'*') ORDER BY (tool=$1) DESC LIMIT 1",
              [envelope.tool],
            )
          ).rows[0].ttl_seconds;
          await cache.publish(c, f, {
            id: id(),
            payload,
            captured_at: envelope.captured_at,
            expires_at: new Date(stamp + ttl * 1000).toISOString(),
            reusable: reusableResponse(envelope.result),
          });
          summary.imported++;
        });
      }
    }
  }
  await db.query(
    "INSERT INTO platform_audit(actor_id,action,summary) VALUES($1,'snapshot.backfill',$2)",
    [actor, summary],
  );
  return summary;
}
