import { readFile, writeFile, lstat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Ajv from "ajv/dist/2020.js";

export async function validateResearchResult(root = "/work") {
  try {
    const file = path.join(root, "result.json");
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size >= 3 * 1024 * 1024)
      return [
        {
          path: "/",
          message: "result.json must be a regular JSON file smaller than 3 MB",
        },
      ];
    const result = JSON.parse(await readFile(file, "utf8"));
    const schema = JSON.parse(
      await readFile(path.join(root, "result.schema.json"), "utf8"),
    );
    const ajv = new Ajv({
      allErrors: true,
      strict: false,
      formats: {
        uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        uri: (value) => {
          try {
            new URL(value);
            return true;
          } catch {
            return false;
          }
        },
      },
    });
    const validate = ajv.compile(schema);
    if (validate(result)) return [];
    return validate.errors.slice(0, 20).map((e) => ({
      path: e.instancePath || "/",
      message: e.message,
      params: e.params,
    }));
  } catch (error) {
    return [
      {
        path: "/",
        message:
          error.code === "ENOENT"
            ? "result.json is missing"
            : "Result or schema is not readable JSON",
      },
    ];
  }
}

export async function ensureResearchResult(repair, root = "/work") {
  let errors = await validateResearchResult(root);
  if (!errors.length) return;
  await writeFile(
    path.join(root, "result-validation.json"),
    JSON.stringify(errors),
    { mode: 0o600 },
  );
  await repair(
    `本次研究已结束取数，现在只修复 result.json 的结构。读取 result-validation.json 中的真实校验错误与 result.schema.json 的相应字段，定向修改结果文件。禁止调用任何数据或政策工具，禁止重做研究、增加事实或修改证据原值/来源。可从已有结果和 evidence/ 恢复缺失信息；空的 limitations 用 [] 表示，不臆造限制。保留实际完成状态，不把 partial 强行改成 complete。用 node /app/src/agent/research-result.mjs 校验，直到无结构错误后结束。错误：${JSON.stringify(errors)}`,
  );
  errors = await validateResearchResult(root);
  if (errors.length) {
    await writeFile(
      path.join(root, "result-validation.json"),
      JSON.stringify(errors),
      { mode: 0o600 },
    );
    throw new Error("research_output_invalid");
  }
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  const errors = await validateResearchResult();
  console.log(JSON.stringify({ valid: !errors.length, errors }));
  process.exitCode = errors.length ? 1 : 0;
}
