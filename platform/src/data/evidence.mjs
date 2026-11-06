import { digest } from "../common/core.mjs";

// Preserve supplier product IDs and other integers that exceed JavaScript's safe range.
export function parseEvidenceJson(text) {
  return JSON.parse(text, (key, value, context) =>
    typeof value === "number" &&
    Number.isInteger(value) &&
    !Number.isSafeInteger(value)
      ? context.source
      : value,
  );
}

export function decodeMcpContent(result) {
  const decoded = [];
  for (const [index, item] of (result?.content || []).entries()) {
    if (item.type !== "text" || typeof item.text !== "string") continue;
    try {
      decoded.push({
        content_index: index,
        data: parseEvidenceJson(item.text),
      });
    } catch {
      /* Non-JSON explanatory text remains available in the original result. */
    }
  }
  return decoded;
}

// MCP text is a string, not an object. Correct only this known structural
// mistake, and only when BOTH the decoded archive and the quoted value match.
// Never search other fields for a value or replace a model's quoted number.
export function canonicalEvidencePointer(envelope, pointer, value) {
  const match = /^\/result\/content\/(0|[1-9]\d*)\/text(\/.*)$/.exec(pointer);
  if (!match || !envelope) return pointer;
  const contentIndex = Number(match[1]);
  const text = envelope.result?.content?.[contentIndex]?.text;
  if (typeof text !== "string") return pointer;
  const index = envelope.decoded?.findIndex(
    (item) => item.content_index === contentIndex,
  );
  if (!(index >= 0)) return pointer;
  try {
    const data = parseEvidenceJson(text);
    if (digest(data) !== digest(envelope.decoded[index].data)) return pointer;
    const found = match[2]
      .slice(1)
      .split("/")
      .reduce((v, part) => {
        const key = part.replaceAll("~1", "/").replaceAll("~0", "~");
        return v !== null && typeof v === "object" && Object.hasOwn(v, key)
          ? v[key]
          : undefined;
      }, data);
    if (found === undefined || digest(found) !== digest(value)) return pointer;
    return `/decoded/${index}/data${match[2]}`;
  } catch {
    return pointer;
  }
}
