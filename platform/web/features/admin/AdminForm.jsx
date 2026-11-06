import { useState } from "react";
import { Button, ErrorBox } from "../../components/ui.jsx";

export function AdminForm({
  api,
  path,
  method = "POST",
  convert,
  onSaved,
  children,
  submitLabel = "保存",
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const result = await api(path, {
            method,
            body: convert(new FormData(e.currentTarget)),
          });
          onSaved(result);
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
        <Button disabled={busy}>{busy ? "正在处理…" : submitLabel}</Button>
      </div>
    </form>
  );
}
