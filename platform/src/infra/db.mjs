import pg from "pg";
import { AppError } from "../common/core.mjs";
export function createDatabase(connectionString) {
  const pool = new pg.Pool({
    connectionString,
    max: Number(process.env.DB_POOL_SIZE || 5),
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 8000,
    options:
      "-c search_path=tidelab,public -c statement_timeout=15000 -c lock_timeout=5000",
  });
  const query = (text, values = []) => pool.query(text, values);
  async function tx(workspaceId, fn) {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.workspace_id',$1,true)", [
        workspaceId || "",
      ]);
      const result = await fn(c);
      await c.query("COMMIT");
      return result;
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }
  async function tenant(workspaceId, fn) {
    if (!workspaceId) throw new AppError("workspace_required", 403);
    return tx(workspaceId, fn);
  }
  return { pool, query, tx, tenant, close: () => pool.end() };
}
