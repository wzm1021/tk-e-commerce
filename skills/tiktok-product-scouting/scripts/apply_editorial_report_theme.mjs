import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const inputArg = process.argv[2];
const outputArg = process.argv[3] ?? inputArg;

if (!inputArg) {
  console.error("Usage: node apply_editorial_report_theme.mjs <input.html> [output.html]");
  process.exit(2);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const themePath = resolve(scriptDir, "../assets/editorial-report-theme.css");
const inputPath = resolve(inputArg);
const outputPath = resolve(outputArg);
const marker = "data-tiktok-product-scouting-theme=\"editorial\"";

const [html, css] = await Promise.all([
  readFile(inputPath, "utf8"),
  readFile(themePath, "utf8"),
]);

if (!html.includes("</head>")) {
  throw new Error("Expected a complete HTML document with </head>");
}

const styleBlock = `<style ${marker}>\n${css}\n</style>`;
const existingTheme = /<style data-tiktok-product-scouting-theme="editorial">[\s\S]*?<\/style>/;
const themed = existingTheme.test(html)
  ? html.replace(existingTheme, styleBlock)
  : html.replace("</head>", `${styleBlock}\n</head>`);

await writeFile(outputPath, themed, "utf8");
console.log(outputPath);
