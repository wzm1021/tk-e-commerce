// The adapter exposes discovery and a validated dispatcher, keeping 55 full schemas out of every model request.
import readline from "node:readline";
import { mkdir, writeFile } from "node:fs/promises";
const provider =
  process.env.TIDELAB_PLATFORM === "amazon" ? "sellersprite" : "fastmoss";
const base = process.env.TIDELAB_GATEWAY,
  key = process.env.TIDELAB_JOB_TOKEN;
async function request(path, body) {
  const r = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(390000),
  });
  const result = await r.json();
  if (!r.ok) throw new Error(result.error || "gateway_error");
  return result;
}
let definitions;
const schemas = async () =>
  (definitions ??= (await request("/internal/job/tools")).tools);
const tools = [
  {
    name: "policy_search",
    description:
      "Search official policy pages. Public policy keywords only; snippets are not verified policy. No FastMoss points. Fetch pages before citing them.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", maxLength: 240 } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "policy_fetch",
    description:
      "Read and archive an official FTC/CPSC/eCFR/TikTok/Amazon Seller policy page. Unavailable pages remain unverified. Returns evidence_path.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "fastmoss_catalog",
    description:
      "List available FastMoss data tools by keyword. Local catalog; does not spend a data point.",
    inputSchema: {
      type: "object",
      properties: { keyword: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "fastmoss_schema",
    description:
      "Read the exact validated input schema of a FastMoss tool before calling it. No data point spent.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "fastmoss_call",
    description:
      "Call one FastMoss data tool using its exact schema. Read billing.live_points in the catalog: FastMoss live calls cost 0/1/2/3 points by tool, SellerSprite live calls cost 1. Snapshot hits cost 0.3; identical calls within this job are free. FastMoss empty results, confirmed failures and rate limits are free; an unconfirmed price blocks a live call. Saves the full envelope at evidence_path and returns a short preview. Read exact fields from the saved file; cite JSON Pointers into that full envelope. The preview may be truncated.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        arguments: { type: "object", additionalProperties: true },
      },
      required: ["name", "arguments"],
      additionalProperties: false,
    },
  },
];
const exposedTools = tools.map((tool) => ({
  ...tool,
  name: tool.name.replace("fastmoss_", provider + "_"),
  description: tool.description.replaceAll(
    "FastMoss",
    provider === "sellersprite" ? "SellerSprite" : "FastMoss",
  ),
}));
const lines = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});
for await (const line of lines) {
  let msg;
  try {
    msg = JSON.parse(line);
    if (msg.id === undefined) continue;
    let result;
    if (msg.method === "initialize")
      result = {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: `tidelab-${provider}`, version: "0.1.0" },
      };
    else if (msg.method === "tools/list") result = { tools: exposedTools };
    else if (msg.method === "tools/call") {
      const args = msg.params.arguments || {};
      let data;
      if (["policy_search", "policy_fetch"].includes(msg.params.name)) {
        const envelope = await request(
          "/internal/job/policy",
          msg.params.name === "policy_search"
            ? { action: "search", query: args.query }
            : { action: "fetch", url: args.url },
        );
        await mkdir("/work/evidence", { recursive: true, mode: 0o700 });
        const evidencePath = `/work/evidence/${envelope.invocation_id}.json`;
        await writeFile(evidencePath, JSON.stringify(envelope), {
          mode: 0o600,
        });
        data = {
          ...envelope,
          text: envelope.text?.slice(0, 1200),
          evidence_path: evidencePath,
        };
      } else if (msg.params.name === `${provider}_catalog`) {
        const all = await schemas();
        data = all
          .filter(
            (t) =>
              !args.keyword ||
              (t.name + " " + t.description)
                .toLowerCase()
                .includes(args.keyword.toLowerCase()),
          )
          .map((t) => ({
            name: t.name,
            description: t.description,
            billing: t.billing,
          }));
      } else if (msg.params.name === `${provider}_schema`) {
        data = (await schemas()).find((t) => t.name === args.name);
        if (!data) throw new Error("tool_not_found");
      } else if (msg.params.name === `${provider}_call`) {
        const envelope = await request("/internal/job/data", {
          name: args.name,
          arguments: args.arguments || {},
        });
        if (!/^[0-9a-f-]{36}$/.test(envelope.invocation_id))
          throw new Error("invalid_evidence_id");
        await mkdir("/work/evidence", { recursive: true, mode: 0o700 });
        const evidencePath = `/work/evidence/${envelope.invocation_id}.json`;
        await writeFile(evidencePath, JSON.stringify(envelope), {
          mode: 0o600,
        });
        const preview = JSON.stringify(
          envelope.decoded?.length ? envelope.decoded : envelope.result,
        );
        data = {
          source: envelope.source,
          invocation_id: envelope.invocation_id,
          captured_at: envelope.captured_at,
          cache_hit: envelope.cache_hit,
          points_charged: envelope.points_charged,
          snapshot_id: envelope.snapshot_id,
          evidence_path: evidencePath,
          preview: preview.slice(0, 6000),
          citation_roots: (envelope.decoded || []).map((item, index) => ({
            content_index: item.content_index,
            pointer: `/decoded/${index}/data`,
          })),
          citation_notice:
            "result.content[i].text is a string. Cite exact fields under the decoded pointer roots in the saved envelope; preserve raw value types.",
          preview_truncated: preview.length > 6000,
          is_error: Boolean(
            envelope.result?.isError ||
            ["failed", "rate_limited"].includes(envelope.billing?.outcome),
          ),
        };
      } else throw new Error("tool_not_found");
      result = {
        content: [{ type: "text", text: JSON.stringify(data) }],
        isError: Boolean(data.is_error || data.result?.isError),
      };
    } else if (msg.method === "ping") result = {};
    else throw new Error("method_not_found");
    process.stdout.write(
      JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\n",
    );
  } catch (e) {
    if (msg?.id !== undefined)
      process.stdout.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          error: {
            code: -32000,
            message: /^[a-z_]{3,100}$/.test(e.message)
              ? e.message
              : "gateway_error",
          },
        }) + "\n",
      );
  }
}
