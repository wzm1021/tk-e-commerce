import { useState, useEffect } from "react";
import { makeApi } from "../lib/api.mjs";
import { Login } from "../features/auth/Login.jsx";
import { Loading } from "../components/ui.jsx";
import { Workspace } from "./Workspace.jsx";

export function App() {
  const [session, setSession] = useState(undefined);
  async function refresh() {
    try {
      setSession(await makeApi()("/api/auth/me"));
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
    <Workspace session={session} refreshSession={refresh} />
  ) : (
    <Login audience="web" onLogin={refresh} />
  );
}
