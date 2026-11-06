import { useState } from "react";

import { Button, ErrorBox } from "../../components/ui.jsx";

export function SaveForm({ api, kind, onSaved, children, convert }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const data = convert(new FormData(e.currentTarget));
          const r = await api("/api/records", {
            method: "POST",
            body: { kind, data },
          });
          onSaved(r);
        } catch (e) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
      <ErrorBox error={error} />
      <div className="dialog-actions">
        <Button disabled={busy}>{busy ? "正在保存…" : "保存记录"}</Button>
      </div>
    </form>
  );
}
