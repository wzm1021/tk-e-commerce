// Check file references without connecting to a database or starting an Agent.
import { readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawnSync } from "node:child_process";

const platform = fileURLToPath(new URL("../", import.meta.url));
const exists = async (file) =>
  stat(file).then(
    () => true,
    () => false,
  );
const failures = [];
let count = 0;
for (const folder of ["src", "web", "scripts", "test"]) {
  for (const relative of await readdir(path.join(platform, folder), {
    recursive: true,
  })) {
    if (!/\.(mjs|jsx)$/.test(relative)) continue;
    const file = path.join(platform, folder, relative);
    const source = await readFile(file, "utf8");
    count++;
    // Static imports, re-exports, dynamic imports and module-relative resources.
    const references = [
      ...source.matchAll(
        /\b(?:import|export)\s+(?:[^;]*?\s+from\s+)?["'](\.{1,2}\/[^"']+)["']/g,
      ),
      ...source.matchAll(/\bimport\s*\(\s*["'](\.{1,2}\/[^"']+)["']/g),
      ...source.matchAll(
        /new URL\(\s*["'](\.{1,2}\/[^"']+)["']\s*,\s*import\.meta\.url/g,
      ),
    ];
    for (const [, specifier] of references) {
      const target = path.resolve(path.dirname(file), specifier);
      const runtimeDirectory = ["data", "dist"].some(
        (name) => target === path.join(platform, name),
      );
      if (!runtimeDirectory && !(await exists(target)))
        failures.push(`${folder}/${relative}: missing ${specifier}`);
      if (folder === "web") {
        const insideWeb = target.startsWith(
          path.join(platform, "web") + path.sep,
        );
        if (!insideWeb)
          failures.push(
            `${folder}/${relative}: browser code imports outside web/`,
          );
        if (
          /^(lib|hooks|components)\//.test(relative) &&
          /[/\\](features|app)[/\\]/.test(target)
        )
          failures.push(
            `${folder}/${relative}: shared code depends on a feature or app`,
          );
      }
    }
    if (file.endsWith(".mjs")) {
      const result = spawnSync(process.execPath, ["--check", file], {
        encoding: "utf8",
      });
      if (result.status !== 0)
        failures.push(`${folder}/${relative}: ${result.stderr}`);
    }
  }
}
// The container only copies platform/src; all absolute runner references must be packaged.
for (const file of ["Dockerfile.agent", "src/agent/agent-runner.mjs"]) {
  for (const [, relative] of (
    await readFile(path.join(platform, file), "utf8")
  ).matchAll(/["']\/app\/(src\/[^"']+)["']/g)) {
    if (!(await exists(path.join(platform, relative))))
      failures.push(`${file}: missing container file ${relative}`);
  }
}
for (const name of ["server", "worker"]) {
  const unit = await readFile(
    path.join(
      platform,
      "deploy",
      `tidelab-${name === "server" ? "app" : name}.service`,
    ),
    "utf8",
  );
  if (
    !unit.includes(`src/${name}.mjs`) ||
    !(await exists(path.join(platform, "src", `${name}.mjs`)))
  )
    failures.push(`systemd ${name} entry point mismatch`);
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `Structure OK: ${count} modules, browser boundaries, container and service entry points.`,
  );
