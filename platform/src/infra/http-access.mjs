import { requireThat } from "../common/core.mjs";

export function allowedOrigins(values) {
  requireThat(
    Array.isArray(values) && values.length > 0 && values.length <= 10,
    "invalid_public_origins",
  );
  const origins = new Set();
  for (const value of values) {
    let url;
    try {
      url = new URL(value);
    } catch {}
    requireThat(
      url &&
        ["http:", "https:"].includes(url.protocol) &&
        url.origin === value &&
        !url.username &&
        !url.password,
      "invalid_public_origin",
    );
    origins.add(value);
  }
  return origins;
}

// Only the local reverse proxy supplies this marker; it only restricts access.
export function fromPublicProxy(request) {
  return (
    ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
      request.raw.socket.remoteAddress,
    ) && request.headers["x-tidelab-public-ingress"] === "1"
  );
}
