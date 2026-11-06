import { McpClient, McpRpcError } from "./mcp-client.ts";
import type { ClawecResponse, JsonObject, JsonValue } from "./types.ts";

export abstract class BaseApi {
  protected readonly mcp: McpClient;

  constructor(mcp: McpClient) {
    this.mcp = mcp;
  }

  protected async call<TData>(
    toolName: string,
    input: object,
  ): Promise<ClawecResponse<TData>> {
    const result = await this.mcp.callTool(toolName, input as JsonObject);

    if (result.structuredContent) {
      return this.assertEnvelope<TData>(result.structuredContent, toolName);
    }

    const text = result.content.find((item) => item.type === "text");
    if (!text || text.type !== "text") {
      throw new McpRpcError(`工具 ${toolName} 没有返回可解析的文本内容`);
    }

    let parsed: JsonValue;
    try {
      parsed = JSON.parse(text.text) as JsonValue;
    } catch {
      throw new McpRpcError(`工具 ${toolName} 返回的 text 不是有效 JSON`);
    }

    return this.assertEnvelope<TData>(parsed, toolName);
  }

  private assertEnvelope<TData>(
    value: JsonValue,
    toolName: string,
  ): ClawecResponse<TData> {
    if (
      value === null ||
      Array.isArray(value) ||
      typeof value !== "object" ||
      typeof value.status !== "number" ||
      typeof value.code !== "number" ||
      typeof value.msg !== "string" ||
      !("data" in value)
    ) {
      throw new McpRpcError(`工具 ${toolName} 返回了未知的业务数据封装`);
    }

    const response = value as unknown as ClawecResponse<TData>;
    if (response.status !== 1 || response.code < 200 || response.code >= 300) {
      throw new McpRpcError(
        `工具 ${toolName} 业务请求失败: ${response.msg}`,
        response.code,
        value,
      );
    }
    return response;
  }
}
