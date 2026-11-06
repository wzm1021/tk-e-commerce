import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createFastMossClientFromEnv } from "../src/fastmoss/client.ts";
import { generateFastMossInputTypes } from "./generate-fastmoss-input-types.ts";

const client = createFastMossClientFromEnv();
try {
  const tools = await client.listTools();
  const syncedAt = new Date().toISOString();
  const directory = resolve("schemas");
  const outputPath = resolve(directory, "fastmoss-tools.snapshot.json");
  await mkdir(directory, { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify({ syncedAt, tools }, null, 2)}\n`,
    "utf8",
  );
  await generateFastMossInputTypes(tools, syncedAt);
  console.log(`已同步 ${tools.length} 个 FastMoss 工具到 ${outputPath}`);
} finally {
  await client.close();
}
