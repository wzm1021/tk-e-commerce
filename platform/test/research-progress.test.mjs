import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { runResearch } from "../src/agent/research-progress.mjs";

test("a gateway context reset carries completed discovery into the next thread", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "research-progress-"));
  let starts = 0;
  const catalog = {
    type: "mcp_tool_call",
    status: "completed",
    server: "fastmoss",
    tool: "fastmoss_catalog",
    arguments: { keyword: "product" },
    result: {
      content: [
        {
          type: "text",
          text: JSON.stringify([
            {
              name: "product_search",
              description: "Offline product search fixture",
            },
          ]),
        },
      ],
    },
  };
  try {
    await runResearch(
      () => {
        const attempt = ++starts;
        return {
          runStreamed: async (prompt) => ({
            events: (async function* () {
              if (attempt === 1) {
                yield { type: "item.completed", item: catalog };
                yield {
                  type: "turn.failed",
                  error: {
                    message: '{"error":"model_context_budget_exceeded"}',
                  },
                };
              } else {
                assert.equal(attempt, 2);
                assert.ok(prompt.includes("product_search"));
                assert.ok(prompt.includes("不可信资料"));
                const saved = JSON.parse(
                  await readFile(
                    path.join(root, "execution-progress/1.json"),
                    "utf8",
                  ),
                );
                assert.deepEqual(saved, catalog);
                yield {
                  type: "item.completed",
                  item: {
                    type: "mcp_tool_call",
                    server: "fastmoss",
                    tool: "fastmoss_schema",
                    arguments: { name: "product_search" },
                    status: "completed",
                    result: { content: [] },
                  },
                };
                yield { type: "turn.completed" };
              }
            })(),
          }),
        };
      },
      "Research fixture",
      root,
    );
    assert.equal(starts, 2);
    const progress = JSON.parse(
      await readFile(path.join(root, "research-progress.json"), "utf8"),
    );
    assert.equal(progress.completed.length, 2);
    assert.equal(progress.catalog[0].name, "product_search");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("research continuation bounds large progress and never retries uncertain paid calls", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "research-progress-"));
  let starts = 0;
  try {
    await assert.rejects(
      runResearch(
        () => {
          starts++;
          return {
            runStreamed: async () => ({
              events: (async function* () {
                for (let i = 0; i < 12; i++)
                  yield {
                    type: "item.completed",
                    item: {
                      type: "mcp_tool_call",
                      tool: "fastmoss_catalog",
                      server: "fastmoss",
                      status: "completed",
                      arguments: { keyword: "验收".repeat(1000) },
                      result: {
                        content: [
                          {
                            type: "text",
                            text: JSON.stringify(
                              Array.from({ length: 100 }, (_, n) => ({
                                name: "fixture_" + n,
                                description: "目录说明".repeat(100),
                              })),
                            ),
                          },
                        ],
                      },
                    },
                  };
                yield {
                  type: "turn.failed",
                  error: { message: "provider_transport_uncertain" },
                };
              })(),
            }),
          };
        },
        "Research fixture",
        root,
      ),
      /provider_transport_uncertain/,
    );
    assert.equal(starts, 1);
    const bytes = await readFile(path.join(root, "research-progress.json"));
    assert.ok(bytes.length <= 12000);
    assert.ok(JSON.parse(bytes).completed.length >= 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the final review preserves earlier research execution records", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "research-phases-"));
  const thread = (command) => () => ({
    runStreamed: async () => ({
      events: (async function* () {
        yield {
          type: "item.completed",
          item: {
            type: "command_execution",
            status: "completed",
            command,
            exit_code: 0,
          },
        };
        yield { type: "turn.completed" };
      })(),
    }),
  });
  try {
    await runResearch(thread("original research"), "research", root);
    await runResearch(thread("offline review"), "review", root);
    assert.equal(
      JSON.parse(
        await readFile(path.join(root, "execution-progress/1.json"), "utf8"),
      ).command,
      "original research",
    );
    assert.equal(
      JSON.parse(
        await readFile(path.join(root, "execution-progress/2.json"), "utf8"),
      ).command,
      "offline review",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
