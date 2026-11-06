import { useState } from "react";
import { useLoad } from "../../hooks/useLoad.mjs";
import { Button, ErrorBox, Loading } from "../../components/ui.jsx";
import { ProfileFields, emptyProfile } from "./ProfileFields.jsx";
export function ProfileEditor({ api }) {
  const { data, error } = useLoad(api, "/api/account/profile", 0);
  return (
    <section className="panel">
      <h2>用户资料</h2>
      <p className="muted">
        完善公司和联系方式，便于我们为你提供服务。税号选填，其余为必填。
      </p>
      <ErrorBox error={error} />
      {data ? (
        <Editor
          api={api}
          initial={data.profile?.data || emptyProfile()}
          missing={!data.profile}
        />
      ) : (
        !error && <Loading />
      )}
    </section>
  );
}
function Editor({ api, initial, missing }) {
  const [value, setValue] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!value.company_size) {
          setError("请选择公司规模");
          return;
        }
        setBusy(true);
        setError("");
        try {
          await api("/api/account/profile", { method: "PUT", body: value });
          setSaved(true);
        } catch (e) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {missing && !saved && (
        <p className="notice">你还没有完善用户资料；现有功能可以继续使用。</p>
      )}
      <ProfileFields
        value={value}
        onChange={(v) => {
          setValue(v);
          setSaved(false);
        }}
      />
      <ErrorBox error={error} />
      {saved && (
        <p role="status" className="notice">
          用户资料已保存
        </p>
      )}
      <Button disabled={busy}>{busy ? "保存中…" : "保存用户资料"}</Button>
    </form>
  );
}
