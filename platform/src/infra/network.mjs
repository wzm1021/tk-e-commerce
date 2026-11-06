import dns from "node:dns/promises";
import ipaddr from "ipaddr.js";
import { Agent, fetch } from "undici";
import { AppError, requireThat } from "../common/core.mjs";
export function publicAddress(address) {
  try {
    let a = ipaddr.parse(address);
    if (a.kind() === "ipv6" && a.isIPv4MappedAddress()) a = a.toIPv4Address();
    return a.range() === "unicast";
  } catch {
    return false;
  }
}
export async function checkedEndpoint(value) {
  const url = new URL(value);
  requireThat(
    url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      !url.search &&
      (!url.port || url.port === "443"),
    "invalid_provider_endpoint",
  );
  const addresses = await dns.lookup(url.hostname, { all: true });
  requireThat(
    addresses.length && addresses.every((a) => publicAddress(a.address)),
    "private_endpoint_forbidden",
  );
  return { url, addresses };
}
export async function providerFetch(
  endpoint,
  options = {},
  credentialQuery = null,
) {
  const { transportTimeoutMs, ...fetchOptions } = options;
  const { url, addresses } = await checkedEndpoint(endpoint);
  const a = addresses[0];
  if (credentialQuery)
    for (const [k, v] of Object.entries(credentialQuery))
      url.searchParams.set(k, v);
  const dispatcher = new Agent({
    ...(transportTimeoutMs
      ? { headersTimeout: transportTimeoutMs, bodyTimeout: transportTimeoutMs }
      : {}),
    connect: {
      lookup: (_host, opts, callback) =>
        opts.all ? callback(null, [a]) : callback(null, a.address, a.family),
    },
  });
  try {
    const response = await fetch(url, {
      ...fetchOptions,
      dispatcher,
      redirect: "error",
      signal: options.signal || AbortSignal.timeout(90000),
    });
    return { response, close: () => dispatcher.close() };
  } catch {
    await dispatcher.close();
    throw new AppError("provider_transport_uncertain", 502);
  }
}
export async function readLimited(response, max = 10 * 1024 * 1024) {
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      requireThat(size <= max, "provider_payload_too_large", 502);
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}
