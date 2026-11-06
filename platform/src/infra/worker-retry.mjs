// Only known rolled-back transactions may be retried for result submission.
// Heartbeats are idempotent and may also retry transient transport failures.
export async function workerRetry(
  run,
  {
    heartbeat = false,
    wait = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = {},
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      const retryable =
        error.code === "transaction_retry" ||
        (heartbeat &&
          (error.status >= 500 ||
            ["TypeError", "TimeoutError", "AbortError"].includes(error.name)));
      if (!retryable || attempt >= 2) throw error;
      await wait(1000);
    }
  }
}
