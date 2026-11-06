import type { JsonObject, JsonValue } from "./types.ts";

interface JsonRpcSuccess<TResult> {
  jsonrpc: "2.0";
  id: number;
  result: TResult;
}

interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: number | null;
  error: {
    code: number;
    message: string;
    data?: JsonValue;
  };
}

type JsonRpcResponse<TResult> = JsonRpcSuccess<TResult> | JsonRpcFailure;

export interface McpTextContent {
  type: "text";
  text: string;
}

export interface McpResourceContent extends JsonObject {
  type: string;
}

export interface McpCallToolResult {
  _meta?: JsonObject;
  content: Array<McpTextContent | McpResourceContent>;
  isError?: boolean;
  structuredContent?: JsonObject;
}

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema: JsonObject;
  outputSchema?: JsonObject;
}

export interface McpClientOptions {
  endpoint: string | URL;
  timeoutMs?: number;
  clientName?: string;
  clientVersion?: string;
  protocolVersion?: string;
  fetchImplementation?: typeof fetch;
}

export class McpRpcError extends Error {
  readonly code?: number;
  readonly data?: JsonValue;

  constructor(
    message: string,
    code?: number,
    data?: JsonValue,
  ) {
    super(message);
    this.name = "McpRpcError";
    this.code = code;
    this.data = data;
  }
}

export class McpClient {
  readonly endpoint: URL;
  readonly timeoutMs: number;
  readonly clientName: string;
  readonly clientVersion: string;
  readonly protocolVersion: string;

  #fetch: typeof fetch;
  #sessionId?: string;
  #requestId = 0;
  #initializing?: Promise<void>;

  constructor(options: McpClientOptions) {
    this.endpoint = new URL(options.endpoint);
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.clientName = options.clientName ?? "tk-e-commerce-data-client";
    this.clientVersion = options.clientVersion ?? "0.1.0";
    this.protocolVersion = options.protocolVersion ?? "2025-06-18";
    this.#fetch = options.fetchImplementation ?? fetch;
  }

  get sessionId(): string | undefined {
    return this.#sessionId;
  }

  async initialize(): Promise<void> {
    if (this.#sessionId) return;
    if (this.#initializing) return this.#initializing;

    this.#initializing = this.#doInitialize();
    try {
      await this.#initializing;
    } finally {
      this.#initializing = undefined;
    }
  }

  async #doInitialize(): Promise<void> {
    await this.#post({
      jsonrpc: "2.0",
      id: this.#nextId(),
      method: "initialize",
      params: {
        protocolVersion: this.protocolVersion,
        capabilities: {},
        clientInfo: { name: this.clientName, version: this.clientVersion },
      },
    });

    await this.#post({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
  }

  async listTools(): Promise<McpToolDefinition[]> {
    await this.initialize();
    const response = await this.#post<{ tools: McpToolDefinition[] }>({
      jsonrpc: "2.0",
      id: this.#nextId(),
      method: "tools/list",
      params: {},
    });
    return response.tools;
  }

  async callTool(
    name: string,
    args: JsonObject,
  ): Promise<McpCallToolResult> {
    await this.initialize();
    const result = await this.#post<McpCallToolResult>({
      jsonrpc: "2.0",
      id: this.#nextId(),
      method: "tools/call",
      params: { name, arguments: args },
    });

    if (result.isError) {
      const message = result.content
        .filter((item): item is McpTextContent => item.type === "text")
        .map((item) => item.text)
        .join("\n");
      throw new McpRpcError(message || `MCP 工具 ${name} 调用失败`);
    }

    return result;
  }

  async close(): Promise<void> {
    if (!this.#sessionId) return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      await this.#fetch(this.endpoint, {
        method: "DELETE",
        headers: { "Mcp-Session-Id": this.#sessionId },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
      this.#sessionId = undefined;
    }
  }

  #nextId(): number {
    this.#requestId += 1;
    return this.#requestId;
  }

  async #post<TResult = unknown>(body: JsonObject): Promise<TResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (this.#sessionId) headers["Mcp-Session-Id"] = this.#sessionId;

    try {
      const response = await this.#fetch(this.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const nextSessionId = response.headers.get("Mcp-Session-Id");
      if (nextSessionId) this.#sessionId = nextSessionId;

      if (!response.ok) {
        throw new McpRpcError(
          `MCP HTTP ${response.status}: ${await response.text()}`,
          response.status,
        );
      }

      if (response.status === 204) return undefined as TResult;

      const raw = await response.text();
      if (!raw.trim()) return undefined as TResult;
      const parsed = this.#parseTransportResponse<TResult>(raw, response.headers);
      if ("error" in parsed) {
        throw new McpRpcError(
          parsed.error.message,
          parsed.error.code,
          parsed.error.data,
        );
      }
      return parsed.result;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new McpRpcError(`MCP 请求超过 ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  #parseTransportResponse<TResult>(
    raw: string,
    headers: Headers,
  ): JsonRpcResponse<TResult> {
    const contentType = headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream")) {
      return JSON.parse(raw) as JsonRpcResponse<TResult>;
    }

    const dataLines = raw
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean);

    if (dataLines.length === 0) {
      throw new McpRpcError("MCP SSE 响应中没有 data 事件");
    }

    return JSON.parse(dataLines.at(-1)!) as JsonRpcResponse<TResult>;
  }
}
