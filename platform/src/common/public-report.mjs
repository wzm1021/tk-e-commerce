import { Parser } from "htmlparser2";
import { researchDisplayText } from "./research-language.mjs";
import { BRAND_NAME, BRAND_TAGLINE } from "../../web/lib/brand.mjs";

const reportBrandText = (value) =>
  value
    .replace(/(?:潮准\s*)?\bTIDE\s*LAB\b|潮准/gi, BRAND_NAME)
    .replace(/证据驱动的跨境经营研究/g, BRAND_TAGLINE);

const displayText = (value) =>
  value
    .replace(
      /https?:\/\/(?:[\w-]+\.)*fastmoss\.com\b[^\s<>"'，。；）]*/gi,
      "数据API",
    )
    .replace(/fastmoss/gi, "数据API")
    .replace(
      /https?:\/\/(?:[\w-]+\.)*sellersprite\.com\b[^\s<>"'，。；）]*/gi,
      "电商数据",
    )
    .replace(/sellersprite|卖家精灵/gi, "电商数据");

// Replace visible branding without reserializing HTML, touching image bytes,
// styles or the immutable source objects used to validate the report.
export function publicReportHtml(html) {
  const edits = [];
  const elements = [];
  let scoutingReport = false;
  let specialistReport = false;
  let hidden = 0;
  const hiddenTags = new Set(["style", "script"]);
  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (hiddenTags.has(name)) hidden++;
        const start = parser.startIndex,
          end = parser.endIndex + 1;
        if (
          name === "meta" &&
          attrs.name === "report-template" &&
          attrs.content?.startsWith("scouting-editorial-")
        )
          scoutingReport = true;
        if (
          name === "meta" &&
          attrs.name === "report-template" &&
          attrs.content?.startsWith("specialist-")
        )
          specialistReport = true;
        elements.push({
          name,
          start,
          classes: (attrs.class || "").split(/\s+/),
        });
        const original = html.slice(start, end);
        let replacement = original.replace(
          /(\s(?:title|alt|aria-label)\s*=\s*)(["'])([\s\S]*?)\2/gi,
          (_, prefix, quote, value) =>
            prefix +
            quote +
            displayText(specialistReport ? researchDisplayText(value) : value) +
            quote,
        );
        if (
          name === "a" &&
          /^https?:\/\/(?:[\w-]+\.)*(?:fastmoss|sellersprite)\.com(?:[/:?#]|$)/i.test(
            attrs.href || "",
          )
        )
          replacement = replacement.replace(
            /\s+href\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i,
            "",
          );
        if (replacement !== original) edits.push([start, end, replacement]);
      },
      onclosetag(name) {
        if (hiddenTags.has(name)) hidden = Math.max(0, hidden - 1);
        const element = elements.pop();
        if (!scoutingReport || !element || element.name !== name) return;
        const end = parser.endIndex + 1;
        // Retired system gates are not current product recommendations. Hide
        // these UI blocks in archived reports too, without rewriting evidence.
        if (
          element.classes.includes("criteria-grid") ||
          (element.classes.includes("strategy-row") &&
            /[AB]\s*·\s*(?:未通过|通过|待核验)/.test(
              html.slice(element.start, end),
            ))
        )
          edits.push([element.start, end, ""]);
      },
      ontext(value) {
        if (hidden) return;
        let replacement = displayText(
          specialistReport ? researchDisplayText(value) : value,
        );
        if (
          elements.some(
            (element) =>
              ["header", "footer", "title"].includes(element.name) ||
              element.classes.some((name) =>
                ["brand", "eyebrow", "wordmark"].includes(name),
              ),
          )
        )
          replacement = reportBrandText(replacement);
        if (replacement !== value)
          edits.push([parser.startIndex, parser.endIndex + 1, replacement]);
      },
    },
    { decodeEntities: false },
  );
  parser.end(html);
  let output = "",
    offset = 0;
  for (const [start, end, replacement] of edits.sort(
    (a, b) => a[0] - b[0] || b[1] - a[1],
  )) {
    if (start < offset) continue;
    output += html.slice(offset, start) + replacement;
    offset = end;
  }
  return output + html.slice(offset);
}
