import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Codex } from "@openai/codex-sdk";
import { adaptClientTools, responseEventStream } from "../src/data/responses.mjs";

const group = {
  type: "namespace",
  name: "mcp__fastmoss",
  tools: [
    {
      type: "function",
      name: "fastmoss_catalog",
      parameters: {
        type: "object",
        properties: { keyword: { type: "string" } },
      },
    },
  ],
};
const call = {
  type: "function_call",
  namespace: group.name,
  name: "fastmoss_catalog",
  call_id: "call_history",
  arguments: '{"keyword":"category"}',
};

test("compaction preserves historical MCP names and outputs without re-enabling tools", () => {
  const active = adaptClientTools({ input: [call], tools: [group] });
  const output = {
    type: "function_call_output",
    call_id: call.call_id,
    output: '{"name":"category_list"}',
  };
  const body = { input: [call, output, call], tools: [], tool_choice: "none" };
  const compact = adaptClientTools(body);
  assert.deepEqual(compact.request.tools, []);
  assert.equal(compact.hasNamespaces, false);
  assert.equal(compact.request.tool_choice, "none");
  assert.deepEqual(compact.request.input, [
    active.request.input[0],
    output,
    active.request.input[0],
  ]);
  assert.equal(call.namespace, group.name);
  assert.deepEqual(body.tools, []);
  // A history-only name does not become a newly executable mapping.
  const response = { output: [compact.request.input[0]] };
  assert.deepEqual(compact.restore(response), response);
});

test("disabled historical tools and custom calls remain distinct from current permissions", () => {
  const custom = {
    type: "custom_tool_call",
    namespace: "files",
    name: "apply_patch",
    call_id: "custom_history",
    input: "fixture patch",
  };
  const enabled = { type: "function", name: "exec_command" };
  const result = adaptClientTools({ input: [call, custom], tools: [enabled] });
  assert.deepEqual(result.request.tools, [enabled]);
  assert.equal(result.request.input[1].input, custom.input);
  assert.equal(result.request.input[1].call_id, custom.call_id);
  assert.equal(result.request.input[1].namespace, undefined);
  assert.notEqual(result.request.input[0].name, result.request.input[1].name);
  for (const tool_choice of [
    { type: "function", namespace: group.name, name: call.name },
    {
      type: "allowed_tools",
      tools: [
        enabled,
        { type: "function", namespace: group.name, name: call.name },
      ],
    },
  ]) {
    assert.throws(
      () => adaptClientTools({ input: [call], tools: [enabled], tool_choice }),
      /unsupported_tool_namespace/,
    );
  }
  assert.throws(
    () => adaptClientTools({ input: [call], tools: [{ type: "web_search" }] }),
    /remote_tools_forbidden/,
  );
  assert.throws(
    () => adaptClientTools({ input: [{ ...call, namespace: {} }], tools: [] }),
    /unsupported_tool_namespace/,
  );
});

test(
  "real Codex SDK compacts after MCP and continues tool use against a local fixture",
  { timeout: 60000 },
  async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "tidelab-compaction-test-"),
    );
    await mkdir(path.join(root, "home/.codex"), { recursive: true });
    const failures = [];
    let modelTurns = 0,
      compactions = 0,
      catalogLoads = 0;
    const server = http.createServer(async (req, res) => {
      try {
        if (req.url === "/internal/job/tools") {
          catalogLoads++;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              tools: [
                { name: "category_list", description: "Offline fixture only" },
              ],
            }),
          );
          return;
        }
        assert.equal(req.url, "/responses");
        let raw = "";
        for await (const bytes of req) raw += bytes;
        const body = JSON.parse(raw),
          adapted = adaptClientTools(body);
        const compact = body.tools.length === 0;
        let output,
          usage = { input_tokens: 100, output_tokens: 20, total_tokens: 120 };
        if (compact) {
          compactions++;
          assert.equal(compactions, 1);
          assert.equal(modelTurns, 1);
          const previous = adapted.request.input.find(
            (x) => x.type === "function_call",
          );
          assert.ok(previous.name.startsWith("tl_"));
          assert.equal(previous.namespace, undefined);
          assert.ok(
            adapted.request.input.some(
              (x) =>
                x.type === "function_call_output" &&
                x.call_id === previous.call_id,
            ),
          );
          assert.deepEqual(adapted.request.tools, []);
          output = [
            {
              type: "message",
              id: "summary",
              role: "assistant",
              status: "completed",
              content: [
                {
                  type: "output_text",
                  text: "The catalog was read. Continue with one more catalog call, then finish.",
                  annotations: [],
                },
              ],
            },
          ];
        } else {
          modelTurns++;
          assert.ok(modelTurns <= 3);
          const tool = adapted.request.tools.find((x) =>
            x.name.endsWith("fastmoss_catalog"),
          );
          assert.ok(tool);
          if (modelTurns <= 2) {
            output = [
              {
                type: "function_call",
                id: `fc_${modelTurns}`,
                call_id: `call_${modelTurns}`,
                name: tool.name,
                arguments: '{"keyword":"category"}',
                status: "completed",
              },
            ];
            if (modelTurns === 1)
              usage = {
                input_tokens: 16000,
                output_tokens: 20,
                total_tokens: 16020,
              };
          } else {
            const outputs = body.input.filter(
              (x) => x.type === "function_call_output",
            );
            assert.ok(
              outputs.some((x) =>
                JSON.stringify(x.output).includes("category_list"),
              ),
            );
            output = [
              {
                type: "message",
                id: "final",
                role: "assistant",
                status: "completed",
                content: [
                  {
                    type: "output_text",
                    text: "Compaction and tool continuation passed.",
                    annotations: [],
                  },
                ],
              },
            ];
          }
        }
        const response = adapted.restore({
          id: `resp_${modelTurns}_${compactions}`,
          object: "response",
          status: "completed",
          output,
          usage,
        });
        res.setHeader("Content-Type", "text/event-stream");
        res.end(responseEventStream(response));
      } catch (error) {
        failures.push(error);
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "offline_fixture_failed" }));
      }
    });
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const base = `http://127.0.0.1:${server.address().port}`;
      const codex = new Codex({
        env: {
          PATH: process.env.PATH,
          HOME: path.join(root, "home"),
          CODEX_HOME: path.join(root, "home/.codex"),
          TIDELAB_GATEWAY: base,
          TIDELAB_JOB_TOKEN: "OFFLINE-FIXTURE-NO-PRODUCTION-AUTHORITY",
        },
        config: {
          model_provider: "fixture",
          model_providers: {
            fixture: {
              name: "Local test fixture",
              base_url: base,
              env_key: "TIDELAB_JOB_TOKEN",
              wire_api: "responses",
              request_max_retries: 0,
              stream_max_retries: 0,
            },
          },
          model_context_window: 64000,
          model_auto_compact_token_limit: 13952,
          features: {
            responses_websockets: false,
            multi_agent: false,
            goals: false,
          },
          mcp_servers: {
            fastmoss: {
              command: process.execPath,
              args: [
                fileURLToPath(
                  new URL("../src/agent/agent-tools.mjs", import.meta.url),
                ),
              ],
              env_vars: ["TIDELAB_GATEWAY", "TIDELAB_JOB_TOKEN"],
            },
          },
        },
      });
      const result = await codex
        .startThread({
          model: "deepseek-v4-pro",
          workingDirectory: root,
          skipGitRepoCheck: true,
          sandboxMode: "danger-full-access",
          approvalPolicy: "never",
          webSearchMode: "disabled",
          modelReasoningEffort: "low",
        })
        .run(
          "Exercise the offline catalog, compact and continue. No real provider calls.",
          { signal: AbortSignal.timeout(40000) },
        );
      assert.deepEqual(failures, []);
      assert.equal(compactions, 1);
      assert.equal(modelTurns, 3);
      assert.equal(catalogLoads, 1);
      assert.equal(
        result.finalResponse,
        "Compaction and tool continuation passed.",
      );
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await rm(root, { recursive: true, force: true });
    }
  },
);
