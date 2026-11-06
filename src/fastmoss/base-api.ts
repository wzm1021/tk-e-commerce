import { McpClient, McpRpcError } from "../mcp-client.ts";
import type { JsonObject, JsonValue } from "../types.ts";
import type {
  FastMossToolDataMap,
  FastMossToolName,
  FastMossToolResponse,
} from "./types.ts";

export abstract class FastMossBaseApi {
  protected readonly mcp: McpClient;

  constructor(mcp: McpClient) {
    this.mcp = mcp;
  }

  protected async call<TName extends FastMossToolName>(
    toolName: TName,
    input: JsonObject = {},
  ): Promise<FastMossToolResponse<FastMossToolDataMap[TName]>> {
    const raw = await this.mcp.callTool(toolName, input);

    if (raw.structuredContent) {
      return { data: raw.structuredContent, raw };
    }

    const textItems = raw.content.filter((item) => item.type === "text");
    if (textItems.length === 0) {
      throw new McpRpcError(`FastMoss 工具 ${toolName} 没有可解析的响应内容`);
    }

    const text = textItems.map((item) => item.text).join("\n");
    let data: JsonValue = text;
    try {
      data = JSON.parse(text) as JsonValue;
    } catch {
      // FastMoss 部分辅助工具可能返回自然语言，保留原文。
    }

    return { data, raw } as FastMossToolResponse<FastMossToolDataMap[TName]>;
  }
}
