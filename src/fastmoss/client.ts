import { McpClient, type McpClientOptions } from "../mcp-client.ts";
import { FastMossAdvertisingApi } from "./api/advertising.ts";
import { FastMossAgenciesApi } from "./api/agencies.ts";
import { FastMossAuxiliaryApi } from "./api/auxiliary.ts";
import { FastMossCreatorsApi } from "./api/creators.ts";
import { FastMossLivesApi } from "./api/lives.ts";
import { FastMossMarketApi } from "./api/market.ts";
import { FastMossProductsApi } from "./api/products.ts";
import { FastMossShopsApi } from "./api/shops.ts";
import { FastMossVideosApi } from "./api/videos.ts";

export interface FastMossClientOptions
  extends Omit<McpClientOptions, "endpoint"> {
  endpoint?: string | URL;
  apiKey?: string;
}

export class FastMossClient {
  readonly mcp: McpClient;
  readonly advertising: FastMossAdvertisingApi;
  readonly agencies: FastMossAgenciesApi;
  readonly creators: FastMossCreatorsApi;
  readonly products: FastMossProductsApi;
  readonly shops: FastMossShopsApi;
  readonly market: FastMossMarketApi;
  readonly lives: FastMossLivesApi;
  readonly videos: FastMossVideosApi;
  readonly auxiliary: FastMossAuxiliaryApi;

  constructor(options: FastMossClientOptions = {}) {
    const endpoint = new URL(
      options.endpoint ?? "https://mcp.fastmoss.com/mcp",
    );
    if (options.apiKey) endpoint.searchParams.set("api_key", options.apiKey);

    this.mcp = new McpClient({
      ...options,
      endpoint,
      clientName: options.clientName ?? "tk-e-commerce-data-client",
      clientVersion: options.clientVersion ?? "0.2.0",
    });
    this.advertising = new FastMossAdvertisingApi(this.mcp);
    this.agencies = new FastMossAgenciesApi(this.mcp);
    this.creators = new FastMossCreatorsApi(this.mcp);
    this.products = new FastMossProductsApi(this.mcp);
    this.shops = new FastMossShopsApi(this.mcp);
    this.market = new FastMossMarketApi(this.mcp);
    this.lives = new FastMossLivesApi(this.mcp);
    this.videos = new FastMossVideosApi(this.mcp);
    this.auxiliary = new FastMossAuxiliaryApi(this.mcp);
  }

  initialize() {
    return this.mcp.initialize();
  }

  listTools() {
    return this.mcp.listTools();
  }

  close() {
    return this.mcp.close();
  }
}

export function createFastMossClientFromEnv(
  env: Record<string, string | undefined> = process.env,
): FastMossClient {
  const apiKey = env.FASTMOSS_API_KEY;
  if (!apiKey) throw new Error("缺少环境变量 FASTMOSS_API_KEY");

  const timeoutMs = env.FASTMOSS_MCP_TIMEOUT_MS
    ? Number(env.FASTMOSS_MCP_TIMEOUT_MS)
    : undefined;
  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    throw new Error("FASTMOSS_MCP_TIMEOUT_MS 必须是正数");
  }

  return new FastMossClient({
    endpoint: env.FASTMOSS_MCP_URL,
    apiKey,
    timeoutMs,
  });
}
