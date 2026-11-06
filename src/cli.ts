import { createTikTokDataClientFromEnv } from "./client.ts";

type Callable = (input: never) => Promise<unknown>;

const [path, rawInput = "{}"] = process.argv.slice(2);
if (!path) {
  console.error(
    '用法: npm run cli -- <领域.方法> \'{"region":"US", ...}\'',
  );
  process.exitCode = 1;
} else {
  const client = createTikTokDataClientFromEnv();
  const [domainName, methodName] = path.split(".");
  const domain = client[domainName as keyof typeof client] as
    | Record<string, unknown>
    | undefined;
  const method = domain?.[methodName] as Callable | undefined;

  if (typeof method !== "function") {
    console.error(`未知接口: ${path}`);
    process.exitCode = 1;
  } else {
    try {
      const input = JSON.parse(rawInput);
      const result = await method.call(domain, input);
      console.log(JSON.stringify(result, null, 2));
    } finally {
      await client.close();
    }
  }
}
