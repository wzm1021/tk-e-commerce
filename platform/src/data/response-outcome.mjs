import { parseEvidenceJson } from "./evidence.mjs";

const successCodes = new Set([0, 200, "0", "200", "SUCCESS"]);
const metadata = new Set([
  "code",
  "message",
  "msg",
  "success",
  "isError",
  "error",
  "status",
  "total",
  "total_count",
  "count",
  "page",
  "page_num",
  "page_size",
  "pagesize",
  "pagination",
  "has_more",
  "next_cursor",
  "params",
  "request",
  "tool_id",
]);
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function failed(v) {
  if (!object(v)) return false;
  if (
    v.isError === true ||
    v.success === false ||
    v.error ||
    ["error", "failed", "failure", "rate_limited"].includes(v.status) ||
    (v.code != null && !successCodes.has(v.code))
  )
    return true;
  // Only traverse known response envelopes; a product's descriptive fields are not status codes.
  return ["data", "result"].some((k) => object(v[k]) && failed(v[k]));
}
function empty(v) {
  if (v == null || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  if (!object(v)) return false; // Zero sales, false flags and non-empty text are real data.
  const entries = Object.entries(v).filter(([k]) => !metadata.has(k));
  return entries.length === 0 || entries.every(([, value]) => empty(value));
}

// Inspect the MCP envelope and its JSON text/structured payloads, never arbitrary prose keywords.
export function fastmossOutcome(result) {
  if (!result || failed(result)) return "failed";
  const values = [];
  let unparsed = false;
  if (Object.hasOwn(result, "structuredContent"))
    values.push(result.structuredContent);
  for (const item of result.content || []) {
    if (item.type !== "text") {
      unparsed = true;
      continue;
    }
    if (!item.text?.trim()) continue;
    try {
      values.push(parseEvidenceJson(item.text));
    } catch {
      unparsed = true;
    }
  }
  if (values.some(failed)) return "failed";
  if (values.some((v) => !empty(v))) return "success";
  if (unparsed) return "unknown";
  return "empty";
}
