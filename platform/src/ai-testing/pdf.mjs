import { BRAND_NAME, BRAND_TAGLINE } from "../../web/lib/brand.mjs";
import sharp from "sharp";
import { digest, requireThat } from "../common/core.mjs";
import { saveArtifact } from "../files/artifacts.mjs";
import { fullReport } from "./report.mjs";
import { reportSources } from "../../web/features/ai-testing/report-content.mjs";
import { reportDocument } from "./pdf-document.mjs";

export const PDF_VERSION = 2;
export function pdfName(run) {
  const title = (run.snapshot.data.name || "AI测品报告")
    .replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, "_")
    .slice(0, 90)
    .trim();
  return `${title || "AI测品"}-完整中文报告.pdf`;
}
export function pdfDigest(run, result) {
  const { pdf_zh: _pdf, ...content } = result;
  return digest({
    version: PDF_VERSION,
    result: content,
    snapshot: run.snapshot,
  });
}
export function publicPdf(run) {
  const p = run.result?.pdf_zh;
  return p?.version === PDF_VERSION
    ? {
        status: p.status,
        artifact_id: p.status === "ready" ? p.artifact_id : null,
        name: pdfName(run),
      }
    : { status: "not_requested" };
}
export async function queuePdf(c, store, run) {
  const result = await fullReport(c, store, run);
  const sources = reportSources(result),
    translations = result.presentation_zh?.translations || [];
  requireThat(
    !sources.length ||
      (result.presentation_zh?.status === "ready" &&
        sources.every((s) =>
          translations.some(
            (t) => t.source === s && /[\u3400-\u9fff]/.test(t.zh),
          ),
        )),
    "ai_pdf_translation_pending",
    409,
  );
  const source_digest = pdfDigest(run, result),
    previous = run.result.pdf_zh;
  if (
    previous?.source_digest === source_digest &&
    ["queued", "rendering", "ready"].includes(previous.status)
  )
    return publicPdf(run);
  // Re-rendering a failed local export is safe: no model or SDK call is made.
  const p = {
    version: PDF_VERSION,
    status: "queued",
    source_digest,
    requested_at: new Date().toISOString(),
  };
  await c.query(
    "UPDATE ai_test_runs SET result=jsonb_set(result,'{pdf_zh}',$2::jsonb) WHERE id=$1",
    [run.id, JSON.stringify(p)],
  );
  await c.query(
    "INSERT INTO ai_test_dispatch(id,workspace_id,kind) VALUES($1,$2,'run') ON CONFLICT(id) DO NOTHING",
    [run.id, run.workspace_id],
  );
  return { status: "queued", name: pdfName(run) };
}
export async function pdfScreenshots(c, store, run) {
  const images = [];
  for (const arm of run.snapshot.data.arms) {
    const ref = run.snapshot.images.find((i) => i.arm === arm.id);
    requireThat(ref?.artifact_id, "ai_pdf_image_missing", 409);
    const a = (
      await c.query("SELECT * FROM artifacts WHERE id=$1", [ref.artifact_id])
    ).rows[0];
    requireThat(
      a &&
        ["image/png", "image/jpeg", "image/webp"].includes(a.mime) &&
        a.size_bytes <= 5 * 1024 * 1024,
      "ai_pdf_image_missing",
      409,
    );
    const raw = await store.read(a.object_key, a.sha256);
    // Bound memory and PDF size; use the confirmed crop, never re-fetch the product URL.
    const bytes = await sharp(raw, { limitInputPixels: 80_000_000 })
      .rotate()
      .resize({
        width: 1800,
        height: 2600,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 88 })
      .toBuffer();
    images.push({
      arm: arm.id,
      data: "data:image/jpeg;base64," + bytes.toString("base64"),
    });
  }
  return images;
}
export async function renderPdf(html) {
  requireThat(
    Buffer.byteLength(html) <= 10 * 1024 * 1024,
    "ai_pdf_too_large",
    422,
  );
  const { chromium } = await import("playwright");
  let browser, timeout;
  try {
    browser = await chromium.launch({
      headless: true,
      timeout: 30000,
      ...(process.env.AI_TEST_BROWSER_PATH
        ? { executablePath: process.env.AI_TEST_BROWSER_PATH }
        : {}),
      args: ["--disable-background-networking", "--disable-quic"],
    });
    // Export is entirely offline. Neither product links nor text can request a URL.
    const context = await browser.newContext({
      javaScriptEnabled: false,
      serviceWorkers: "block",
      acceptDownloads: false,
      locale: "zh-CN",
    });
    await context.route("**/*", (route) => route.abort());
    await context.routeWebSocket("**/*", (socket) => socket.close());
    const page = await context.newPage();
    timeout = setTimeout(() => {
      browser.close().catch(() => {});
    }, 90000);
    await page.setContent(html, { waitUntil: "load", timeout: 30000 });
    await page.emulateMedia({ media: "print" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      tagged: true,
      outline: true,
      displayHeaderFooter: true,
      margin: { top: "17mm", right: "16mm", bottom: "18mm", left: "16mm" },
      headerTemplate: `<div style="font-family: sans-serif;font-size:8px;color:#60746e;margin-left:60px">${BRAND_NAME} · AI 测品报告 · ${BRAND_TAGLINE}</div>`,
      footerTemplate:
        '<div style="font-family:sans-serif;font-size:9px;color:#60746e;text-align:center;width:100%"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    });
    requireThat(
      pdf.subarray(0, 5).toString() === "%PDF-" &&
        pdf.length <= 12 * 1024 * 1024,
      "ai_pdf_too_large",
      422,
    );
    return pdf;
  } finally {
    clearTimeout(timeout);
    await browser?.close();
  }
}
export async function exportPdf(engine, q, run) {
  const p = run.result.pdf_zh;
  try {
    const { result, screenshots } = await engine.tx(q, async (c) => {
      const result = await fullReport(c, engine.store, run);
      requireThat(
        p.source_digest === pdfDigest(run, result),
        "ai_pdf_source_changed",
        409,
      );
      await c.query(
        "UPDATE ai_test_runs SET result=jsonb_set(result,'{pdf_zh,status}','\"rendering\"'::jsonb) WHERE id=$1",
        [run.id],
      );
      return {
        result,
        screenshots: await pdfScreenshots(c, engine.store, run),
      };
    });
    const html = await reportDocument(run, result, screenshots, p.requested_at);
    const bytes = await (engine.pdfRenderer || renderPdf)(html);
    requireThat(
      Buffer.isBuffer(bytes) &&
        bytes.subarray(0, 5).toString() === "%PDF-" &&
        bytes.length <= 12 * 1024 * 1024,
      "ai_pdf_invalid",
      502,
    );
    await engine.tx(q, async (c) => {
      const a = await saveArtifact(c, engine.store, run.workspace_id, bytes, {
        kind: "report",
        mime: "application/pdf",
        name: pdfName(run),
      });
      await c.query(
        "UPDATE ai_test_runs SET result=jsonb_set(result,'{pdf_zh}',$2::jsonb) WHERE id=$1",
        [run.id, JSON.stringify({ ...p, status: "ready", artifact_id: a.id })],
      );
      await c.query(
        "INSERT INTO ai_test_events(workspace_id,run_id,kind,detail) VALUES($1,$2,'report_pdf_exported',$3)",
        [
          run.workspace_id,
          run.id,
          {
            artifact_id: a.id,
            version: PDF_VERSION,
            source_digest: p.source_digest,
          },
        ],
      );
      await c.query("DELETE FROM ai_test_dispatch WHERE id=$1", [run.id]);
    });
  } catch (e) {
    if (e.code === "ai_lease_lost") throw e;
    await engine.tx(q, async (c) => {
      await c.query(
        "UPDATE ai_test_runs SET result=jsonb_set(result,'{pdf_zh,status}','\"failed\"'::jsonb) WHERE id=$1 AND status='completed'",
        [run.id],
      );
      await c.query(
        "INSERT INTO ai_test_events(workspace_id,run_id,kind,detail) VALUES($1,$2,'report_pdf_failed',$3)",
        [
          run.workspace_id,
          run.id,
          {
            code: /^ai_pdf_[a-z_]+$/.test(e.code || "")
              ? e.code
              : "ai_pdf_failed",
          },
        ],
      );
      await c.query("DELETE FROM ai_test_dispatch WHERE id=$1", [run.id]);
    });
  }
}
