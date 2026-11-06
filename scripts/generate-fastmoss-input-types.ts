import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { McpToolDefinition } from "../src/mcp-client.ts";

interface JsonSchema {
  type?: string | string[];
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  description?: string;
}

function indent(level: number): string {
  return "  ".repeat(level);
}

function primitiveType(type: string | undefined): string {
  switch (type) {
    case "string":
      return "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    default:
      return "JsonValue";
  }
}

function schemaToType(schema: JsonSchema, level: number): string {
  if (schema.enum?.length) {
    return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  }

  if (Array.isArray(schema.type)) {
    return schema.type
      .map((type) =>
        type === "array"
          ? `Array<${schemaToType(schema.items ?? {}, level)}>`
          : primitiveType(type),
      )
      .join(" | ");
  }

  if (schema.type === "array") {
    return `Array<${schemaToType(schema.items ?? {}, level)}>`;
  }

  if (schema.type === "object" || schema.properties) {
    const properties = schema.properties ?? {};
    const required = new Set(schema.required ?? []);
    const entries = Object.entries(properties);
    if (entries.length === 0) return "Record<string, JsonValue | undefined>";

    const lines = entries.map(([name, property]) => {
      const description = property.description
        ? `${indent(level + 1)}/** ${property.description.replaceAll("*/", "*∕")} */\n`
        : "";
      const optional = required.has(name) ? "" : "?";
      return `${description}${indent(level + 1)}${JSON.stringify(name)}${optional}: ${schemaToType(property, level + 1)};`;
    });
    return `{\n${lines.join("\n")}\n${indent(level)}}`;
  }

  return primitiveType(typeof schema.type === "string" ? schema.type : undefined);
}

export async function generateFastMossInputTypes(
  tools: McpToolDefinition[],
  syncedAt: string,
  outputPath = resolve("src/fastmoss/generated-inputs.ts"),
): Promise<void> {
  const entries = [...tools]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((tool) => {
      const inputType = schemaToType(tool.inputSchema as JsonSchema, 1);
      return `  ${JSON.stringify(tool.name)}: ${inputType};`;
    });

  const source = `// 此文件由 scripts/generate-fastmoss-input-types.ts 自动生成。\n// Schema 同步时间：${syncedAt}\n// 请勿手工编辑；运行 npm run fastmoss:sync-tools 更新。\nimport type { JsonValue } from "../types.ts";\n\nexport interface FastMossInputMap {\n${entries.join("\n")}\n}\n\nexport type FastMossInput<TName extends keyof FastMossInputMap> =\n  FastMossInputMap[TName];\n`;

  await writeFile(outputPath, source, "utf8");
}

if (import.meta.main) {
  const snapshot = JSON.parse(
    await readFile(resolve("schemas/fastmoss-tools.snapshot.json"), "utf8"),
  ) as { syncedAt: string; tools: McpToolDefinition[] };
  await generateFastMossInputTypes(snapshot.tools, snapshot.syncedAt);
  console.log(`已根据 ${snapshot.tools.length} 个工具生成 FastMoss 输入类型`);
}
