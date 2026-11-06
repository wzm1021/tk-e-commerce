import { useEffect, useRef } from "react";
// Only foreground navigation or human input creates activity. Polls and background jobs never do.
export function useCustomerActivity(api, page) {
  const last = useRef(0);
  useEffect(() => {
    const ping = () => {
      if (
        document.visibilityState !== "visible" ||
        Date.now() - last.current < 60000
      )
        return;
      last.current = Date.now();
      api("/api/account/activity", { method: "POST", body: { page } }).catch(
        () => {},
      );
    };
    const input = (e) => {
      if (e.isTrusted) ping();
    };
    ping();
    window.addEventListener("pointerdown", input);
    window.addEventListener("keydown", input);
    return () => {
      window.removeEventListener("pointerdown", input);
      window.removeEventListener("keydown", input);
    };
  }, [api, page]);
}
