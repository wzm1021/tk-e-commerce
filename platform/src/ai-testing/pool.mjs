import { id, requireThat } from "../common/core.mjs";
export const utcMonth = (date = new Date()) => date.toISOString().slice(0, 7);
export async function eligibleAccounts(c, credits, { lock = false } = {}) {
  const { rows } = await c.query(
    `SELECT a.*,
 (SELECT count(*)::int FROM ai_test_reservations r WHERE r.account_id=a.id AND r.state IN('reserved','started','uncertain') AND NOT r.trial_counted) AS trial_reserved,
 (SELECT COALESCE(sum(credits),0)::int FROM ai_test_reservations r WHERE r.account_id=a.id AND r.state IN('reserved','started','uncertain') AND r.quota_month=$1) AS credits_reserved,
 (SELECT count(*)::int FROM ai_test_reservations r WHERE r.account_id=a.id AND r.state IN('reserved','started','uncertain')) AS active
 FROM ai_test_accounts a WHERE enabled AND verified AND trial_used IS NOT NULL AND state IN('ready','monthly_exhausted')
 AND (cooldown_until IS NULL OR cooldown_until<=now()) ORDER BY priority,created_at,id ${lock ? "FOR UPDATE OF a" : ""}`,
    [utcMonth()],
  );
  return rows
    .filter(
      (a) => a.state !== "monthly_exhausted" || a.quota_month !== utcMonth(),
    )
    .filter(
      (a) =>
        a.trial_limit - a.trial_used - a.trial_reserved > 0 &&
        a.monthly_limit -
          (a.quota_month === utcMonth() ? a.monthly_used : 0) -
          a.credits_reserved >=
          credits &&
        a.active < 1,
    );
}
export async function reserve(c, run, credits) {
  // Serialize decisions across workspaces; never retain a database lock during network I/O.
  await c.query("SELECT pg_advisory_xact_lock(93419741)");
  const active = await c.query(
    "SELECT count(*)::int AS n FROM ai_test_reservations WHERE workspace_id=$1 AND state IN('reserved','started','uncertain')",
    [run.workspace_id],
  );
  requireThat(active.rows[0].n < 3, "ai_workspace_capacity", 429);
  const account = (await eligibleAccounts(c, credits, { lock: true }))[0];
  requireThat(account, "ai_pool_empty", 409);
  if (account.quota_month !== utcMonth())
    await c.query(
      "UPDATE ai_test_accounts SET quota_month=$2,monthly_used=0,state='ready' WHERE id=$1",
      [account.id, utcMonth()],
    );
  const attempt = run.attempt + 1,
    reservation = id(),
    key = `ai:${run.id}:${attempt}`;
  await c.query(
    `INSERT INTO ai_test_reservations(id,workspace_id,run_id,account_id,attempt,credits,quota_month,state,secret_ref,secret_version,sdk_key)
 VALUES($1,$2,$3,$4,$5,$6,$7,'reserved',$8,$9,$10)`,
    [
      reservation,
      run.workspace_id,
      run.id,
      account.id,
      attempt,
      credits,
      utcMonth(),
      account.secret_ref,
      account.secret_version,
      key,
    ],
  );
  await c.query(
    "UPDATE ai_test_runs SET account_id=$2,attempt=$3,sdk_key=$4,remote_id=NULL,status='queued',error_code=NULL,updated_at=now() WHERE id=$1",
    [run.id, account.id, attempt, key],
  );
  await c.query(
    "INSERT INTO ai_test_events(workspace_id,run_id,kind,detail) VALUES($1,$2,'reserved',$3)",
    [run.workspace_id, run.id, { attempt, credits }],
  );
  return { account, attempt, key };
}
export async function markStarted(c, run) {
  const r = (
    await c.query(
      "SELECT * FROM ai_test_reservations WHERE run_id=$1 AND attempt=$2 FOR UPDATE",
      [run.id, run.attempt],
    )
  ).rows[0];
  if (!r || ["settled", "released"].includes(r.state)) return;
  if (!r.trial_counted)
    await c.query(
      "UPDATE ai_test_accounts SET trial_used=trial_used+1 WHERE id=$1",
      [r.account_id],
    );
  await c.query(
    "UPDATE ai_test_reservations SET state='started',trial_counted=true,updated_at=now() WHERE id=$1",
    [r.id],
  );
}
export async function settle(c, run, { billable, started = true } = {}) {
  if (started) await markStarted(c, run);
  const r = (
    await c.query(
      "SELECT * FROM ai_test_reservations WHERE run_id=$1 AND attempt=$2 FOR UPDATE",
      [run.id, run.attempt],
    )
  ).rows[0];
  if (!r || ["settled", "released"].includes(r.state)) return;
  requireThat(typeof billable === "boolean", "ai_billing_unknown", 409);
  const charged = billable ? r.credits : 0;
  if (charged)
    await c.query(
      `UPDATE ai_test_accounts SET monthly_used=CASE WHEN quota_month=$2 THEN monthly_used+$3 ELSE $3 END,quota_month=$2
 WHERE id=$1 AND quota_month<=$2`,
      [r.account_id, r.quota_month, charged],
    );
  await c.query(
    "UPDATE ai_test_reservations SET state=$2,charged=$3,updated_at=now() WHERE id=$1",
    [r.id, started ? "settled" : "released", charged],
  );
  await c.query(
    "INSERT INTO ai_test_events(workspace_id,run_id,kind,detail) VALUES($1,$2,'settled',$3)",
    [
      run.workspace_id,
      run.id,
      { credits: charged, trial_counted: r.trial_counted, billable },
    ],
  );
}
