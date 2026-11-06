import { useEffect, useState } from "react";
import { money } from "../../lib/format.mjs";

export function BalanceSummary({ api, space, version, onOpen }) {
  const [balance, setBalance] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let pending = false;
    const controller = new AbortController();
    async function refresh() {
      if (pending || document.visibilityState === "hidden") return;
      pending = true;
      try {
        const result = await api("/api/wallet/summary", {
          signal: controller.signal,
        });
        if (alive) {
          setBalance(result);
          setFailed(false);
        }
      } catch {
        if (alive) setFailed(true);
      } finally {
        pending = false;
      }
    }
    refresh();
    const timer = setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      alive = false;
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [api, version]);
  const model = balance?.wallets.find((w) => w.currency === "model_micro_cny");
  const data = balance?.wallets.find((w) => w.currency === "data_points");
  const tests = balance?.wallets.find((w) => w.currency === "ai_test_uses");
  return (
    <button
      type="button"
      className="balance-summary"
      onClick={onOpen}
      aria-label={`${space?.kind === "team" ? "团队共享余额" : "个人余额"}，查看余额与账单`}
      title={`${space?.name || "当前空间"} · 可用余额不含正在调用中的预留；每 15 秒刷新`}
    >
      <span>{space?.kind === "team" ? "团队共享余额" : "个人余额"}</span>
      {failed ? (
        <strong>余额暂不可用 · 点击查看</strong>
      ) : (
        <strong>
          ¥ {model ? money(model.available) : "—"}
          <span className="balance-divider">·</span>
          {data?.available ?? "—"} 数据积分
          <span className="balance-divider">·</span>
          {balance ? (tests?.available ?? 0) : "—"} 次测品
        </strong>
      )}
    </button>
  );
}
