// randomUUID is unavailable on public HTTP origins. getRandomValues remains
// available there, so retries and resource IDs still use cryptographic UUIDs.
export function randomId(cryptoSource = globalThis.crypto) {
  if (typeof cryptoSource?.randomUUID === "function")
    return cryptoSource.randomUUID();
  if (typeof cryptoSource?.getRandomValues !== "function")
    throw new Error("当前浏览器无法生成请求编号，请升级浏览器后重试");
  const bytes = cryptoSource.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
