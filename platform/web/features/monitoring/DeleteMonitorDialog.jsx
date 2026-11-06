import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { Dialog } from "../../components/Dialog.jsx";
import { Button, ErrorBox } from "../../components/ui.jsx";

export function DeleteMonitorDialog({ api, item, onClose, onDeleted }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef(false);
  async function remove() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await api(`/api/monitors/${item.id}/status`, {
        method: "POST",
        body: { status: "archived" },
      });
      onDeleted();
    } catch (e) {
      setError(e.message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="删除竞店监控"
      onClose={() => {
        if (!pending.current) onClose();
      }}
    >
      <p>
        确认删除 <strong>{item.name}</strong> 的监控？
      </p>
      <p className="muted">
        {item.market} · {item.seller_id}
      </p>
      <p>删除后将移出监控列表，停止后续自动巡检。需要时可以重新添加。</p>
      <p className="notice">
        历史巡检报告和费用记录会保留。已提交的巡检仍会继续，并按实际用量结算。
      </p>
      <ErrorBox error={error} />
      <div className="actions">
        <Button secondary disabled={busy} onClick={onClose}>
          取消
        </Button>
        <Button
          className="button monitor-delete"
          disabled={busy}
          onClick={remove}
        >
          <Trash2 size={15} />
          {busy ? "正在删除…" : "确认删除"}
        </Button>
      </div>
    </Dialog>
  );
}
