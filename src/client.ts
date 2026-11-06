import { CreatorsApi } from "./api/creators.ts";
import { LivesApi } from "./api/lives.ts";
import { MarketApi } from "./api/market.ts";
import { ProductsApi } from "./api/products.ts";
import { ShopsApi } from "./api/shops.ts";
import { VideosApi } from "./api/videos.ts";
import { McpClient, type McpClientOptions } from "./mcp-client.ts";

export class TikTokDataClient {
  readonly mcp: McpClient;
  readonly videos: VideosApi;
  readonly creators: CreatorsApi;
  readonly shops: ShopsApi;
  readonly market: MarketApi;
  readonly lives: LivesApi;
  readonly products: ProductsApi;

  constructor(options: McpClientOptions) {
    this.mcp = new McpClient(options);
    this.videos = new VideosApi(this.mcp);
    this.creators = new CreatorsApi(this.mcp);
    this.shops = new ShopsApi(this.mcp);
    this.market = new MarketApi(this.mcp);
    this.lives = new LivesApi(this.mcp);
    this.products = new ProductsApi(this.mcp);
  }

  initialize(): Promise<void> {
    return this.mcp.initialize();
  }

  close(): Promise<void> {
    return this.mcp.close();
  }
}

export function createTikTokDataClientFromEnv(
  env: Record<string, string | undefined> = process.env,
): TikTokDataClient {
  const rawUrl = env.CLAWEC_MCP_URL;
  if (!rawUrl) throw new Error("缺少环境变量 CLAWEC_MCP_URL");

  const endpoint = new URL(rawUrl);
  if (env.CLAWEC_MCP_KEY) endpoint.searchParams.set("key", env.CLAWEC_MCP_KEY);
  if (env.CLAWEC_MCP_ID) endpoint.searchParams.set("id", env.CLAWEC_MCP_ID);

  const timeoutMs = env.CLAWEC_MCP_TIMEOUT_MS
    ? Number(env.CLAWEC_MCP_TIMEOUT_MS)
    : undefined;
  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    throw new Error("CLAWEC_MCP_TIMEOUT_MS 必须是正数");
  }

  return new TikTokDataClient({ endpoint, timeoutMs });
}
