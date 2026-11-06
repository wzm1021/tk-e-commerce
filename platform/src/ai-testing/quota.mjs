import { id, requireThat } from "../common/core.mjs";

// Call inside the run transaction, after locking the run and provider pool.
// A platform use is independent of provider credits, retries and account switches.
export async function reserveTestUse(c, run) {
  requireThat(
    (
      await c.query(
        "UPDATE wallets SET available=available-1,reserved=reserved+1 WHERE workspace_id=$1 AND currency='ai_test_uses' AND available>=1",
        [run.workspace_id],
      )
    ).rowCount,
    "insufficient_ai_test_uses",
    409,
  );
  await c.query("UPDATE ai_test_runs SET quota_state='reserved' WHERE id=$1", [
    run.id,
  ]);
  await entry(c, run, "reserve", "AI 测品提交，预留 1 次");
}

export async function settleTestUse(c, run, succeeded) {
  if (run.quota_state !== "reserved") return;
  requireThat(
    (
      await c.query(
        "UPDATE wallets SET reserved=reserved-1,available=available+$2 WHERE workspace_id=$1 AND currency='ai_test_uses' AND reserved>=1",
        [run.workspace_id, succeeded ? 0 : 1],
      )
    ).rowCount,
    "wallet_reservation_mismatch",
    500,
  );
  await entry(
    c,
    run,
    succeeded ? "charge" : "release",
    succeeded ? "AI 测品成功，扣除 1 次" : "AI 测品失败或取消，退回预留次数",
  );
  await c.query("UPDATE ai_test_runs SET quota_state=$2 WHERE id=$1", [
    run.id,
    succeeded ? "charged" : "released",
  ]);
}

async function entry(c, run, operation, reason) {
  await c.query(
    "INSERT INTO ledger(id,workspace_id,currency,operation,amount,reference,detail) VALUES($1,$2,'ai_test_uses',$3,1,$4,$5)",
    [
      id(),
      run.workspace_id,
      operation,
      run.id,
      {
        reason,
        ai_test_run_id: run.id,
        actor_id: run.created_by,
        test_name: run.snapshot.data.name,
      },
    ],
  );
}
