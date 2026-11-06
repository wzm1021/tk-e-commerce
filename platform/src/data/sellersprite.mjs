import Ajv from "ajv";
import { requireThat, digest } from "../common/core.mjs";
import { readFile } from "node:fs/promises";
const registry = JSON.parse(
  await readFile(
    new URL("../../../schemas/sellersprite-capabilities.json", import.meta.url),
    "utf8",
  ),
);
const allowed = new Set(
  registry.tools.flatMap((t) => (t.runtime_name ? [t.runtime_name] : [])),
);
// Only reviewed read-only capabilities with live schemas become callable.
export function sellerSpriteTools(catalog) {
  requireThat(Array.isArray(catalog), "sellersprite_tools_missing", 409);
  // A healthy catalog also advertises credential-error tools. Only an error-only
  // catalog means the connection failed; never expose those tools to agents.
  const hasProductTools = catalog.some((t) =>
    ["product_research", "competitor_lookup"].includes(t?.name),
  );
  requireThat(
    hasProductTools || !catalog.some((t) => t?.name === "secret_expired"),
    "sellersprite_secret_expired",
    409,
  );
  const ajv = new Ajv({
    strict: false,
    allErrors: true,
    formats: { int32: true, int64: true, float: true, double: true },
  });
  const seen = new Set();
  const tools = catalog
    .filter((t) => allowed.has(t?.name))
    .map((t) => {
      requireThat(
        !seen.has(t.name) && t.inputSchema?.type === "object",
        "sellersprite_schema_invalid",
        409,
      );
      seen.add(t.name);
      ajv.compile(t.inputSchema);
      return {
        name: t.name,
        description: String(t.description || "").slice(0, 12000),
        inputSchema: t.inputSchema,
      };
    });
  requireThat(
    tools.some((t) =>
      ["product_research", "competitor_lookup"].includes(t.name),
    ),
    "sellersprite_product_tools_missing",
    409,
  );
  return tools;
}
export const sellerSpriteSchemaDigest = (tools) =>
  digest(tools.map((t) => ({ name: t.name, inputSchema: t.inputSchema })));
export function dataToolsForJob(job, fastmossTools) {
  if (!job.snapshot.data) return [];
  const amazon = job.request?.platform === "amazon";
  requireThat(
    !job.snapshot.data.kind ||
      job.snapshot.data.kind === (amazon ? "sellersprite" : "fastmoss"),
    "data_platform_mismatch",
    403,
  );
  return amazon ? sellerSpriteTools(job.snapshot.data.tools) : fastmossTools;
}
