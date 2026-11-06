import { useState, useEffect } from "react";
import { makeApi } from "../lib/api.mjs";
import { Login } from "../features/auth/Login.jsx";
import { Loading } from "../components/ui.jsx";
import { Console } from "../features/admin/AdminConsole.jsx";

export function AdminApp() {
  const [session, setSession] = useState(undefined);
  async function refresh() {
    try {
      setSession(await makeApi("admin")("/api/auth/me?audience=admin"));
    } catch {
      setSession(null);
    }
  }
  useEffect(() => {
    refresh();
  }, []);
  return session === undefined ? (
    <Loading />
  ) : session ? (
    <Console session={session} refreshSession={refresh} />
  ) : (
    <Login audience="admin" onLogin={refresh} />
  );
}
