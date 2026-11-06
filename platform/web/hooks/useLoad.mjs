import { useState, useEffect } from "react";

export function useLoad(api, path, version = 0) {
  const [cache, setCache] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!path) {
      setCache(null);
      return;
    }
    setCache((previous) => ({
      api,
      path,
      data:
        previous?.api === api && previous.path === path ? previous.data : null,
      error: "",
    }));
    api(path)
      .then((x) => {
        if (alive) setCache({ api, path, data: x, error: "" });
      })
      .catch((e) => {
        if (alive)
          setCache((previous) => ({
            ...previous,
            api,
            path,
            error: e.message,
          }));
      });
    return () => {
      alive = false;
    };
  }, [api, path, version]);
  const current = cache?.api === api && cache?.path === path;
  return {
    data: current ? cache.data : null,
    error: current ? cache.error : "",
  };
}
