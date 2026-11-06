import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createDatabase } from "./infra/db.mjs";
import { LocalStore, SecretStore } from "./infra/storage.mjs";
import { requireThat } from "./common/core.mjs";
import { createMailer } from "./infra/mailer.mjs";
import { FeedbackDelivery } from "./feedback/delivery.mjs";
export async function startFeedbackWorker() {
  requireThat(
    process.env.DATABASE_URL && process.env.MASTER_KEY_FILE,
    "runtime_configuration_required",
    500,
  );
  requireThat(
    ((await stat(process.env.MASTER_KEY_FILE)).mode & 0o077) === 0,
    "secret_file_permissions",
    500,
  );
  const db = createDatabase(process.env.DATABASE_URL),
    root =
      process.env.DATA_ROOT ||
      fileURLToPath(new URL("../data/", import.meta.url));
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
        "SELECT 1 FROM schema_versions WHERE version='012_customer_feedback'",
      )
    ).rowCount,
    "database_migration_required",
    503,
  );
  const engine = new FeedbackDelivery({
    db,
    store: new LocalStore(root),
    mailer: createMailer(
      db,
      new SecretStore(root, await readFile(process.env.MASTER_KEY_FILE)),
    ),
  });
  let stopped = false;
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => {
      stopped = true;
    });
  try {
    while (!stopped) {
      try {
        if (!(await engine.once()))
          await new Promise((r) => setTimeout(r, 2000));
      } catch {
        console.error("Feedback worker: execution_failed");
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  } finally {
    await db.close();
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  startFeedbackWorker().catch(() => {
    console.error("Feedback worker startup failed");
    process.exitCode = 1;
  });
