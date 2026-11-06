import pg from "pg";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const client = new pg.Client({
  connectionString:
    process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
});
await client.connect();
try {
  await client.query("SELECT pg_advisory_lock(93419730)");
  const dir = new URL("../migrations/", import.meta.url);
  for (const file of (await readdir(dir))
    .filter((x) => x.endsWith(".sql"))
    .sort()) {
    const exists = await client.query(
      "SELECT to_regclass('tidelab.schema_versions') AS t",
    );
    if (
      exists.rows[0].t &&
      (
        await client.query(
          "SELECT 1 FROM tidelab.schema_versions WHERE version=$1",
          [file.slice(0, -4)],
        )
      ).rowCount
    )
      continue;
    await client.query("BEGIN");
    try {
      await client.query(await readFile(new URL(file, dir), "utf8"));
      await client.query("COMMIT");
      console.log("Applied", file);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  }
} finally {
  await client.query("SELECT pg_advisory_unlock(93419730)").catch(() => {});
  await client.end();
}
