import { useEffect, useRef, useState } from "react";
import { Radar, BarChart3 } from "lucide-react";
import { Button, ErrorBox } from "../../components/ui.jsx";

export function MonitorShopButton({
  api,
  reportId,
  candidate,
  monitors,
  onAdded,
  onView,
  onOverview,
}) {
  const [created, setCreated] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef(false);
  const target = candidate.monitor_target;
  const existing =
    target &&
    (monitors?.find(
      (m) => m.seller_id === target.seller_id && m.market === target.market,
    ) ||
      created);
  useEffect(() => {
    if (created && monitors?.some((m) => m.id === created.id)) setCreated(null);
  }, [created, monitors]);
  async function add() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await api(
        `/api/reports/${reportId}/candidates/${encodeURIComponent(candidate.product_id)}/monitor`,
        {
          method: "POST",
          body: {},
        },
      );
      setCreated(result);
      onAdded(result);
    } catch (e) {
      setError(e.message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  if (!target)
    return <small className="muted">店铺资料待补充，暂不能监控</small>;
  return (
    <div className="candidate-monitor">
      <small>
        {target.name} · {target.market}
        {existing?.status === "paused" ? " · 监控已暂停" : ""}
      </small>
      <div className="candidate-shop-actions">
        <Button
          secondary
          disabled={busy}
          onClick={existing ? () => onView(existing.id) : add}
        >
          <Radar size={15} />
          {busy ? "正在添加…" : existing ? "查看监控" : "监控店铺"}
        </Button>
        <Button
          secondary
          onClick={onOverview}
          title="查看商品与店铺详情；首次补充数据按实际调用扣除积分"
        >
          <BarChart3 size={15} />
          数据总览
        </Button>
      </div>
      <ErrorBox error={error} />
    </div>
  );
}
