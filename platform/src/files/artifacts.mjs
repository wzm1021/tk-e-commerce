import { id, requireThat } from "../common/core.mjs";
import { publicReportHtml } from "../common/public-report.mjs";
export async function saveArtifact(
  c,
  store,
  workspace,
  bytes,
  { name, mime = "application/json", kind = "evidence" },
) {
  const o = await store.put(workspace, bytes);
  return (
    await c.query(
      "INSERT INTO artifacts(id,workspace_id,object_key,sha256,size_bytes,name,mime,kind) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(object_key) DO UPDATE SET object_key=EXCLUDED.object_key RETURNING *",
      [id(), workspace, o.object_key, o.sha256, o.size_bytes, name, mime, kind],
    )
  ).rows[0];
}
export function installArtifacts(app, db, store) {
  app.get(
    "/api/artifacts/:id",
    { preHandler: app.user },
    async (req, reply) => {
      const a = await db.tenant(
        req.workspace,
        async (c) =>
          (
            await c.query("SELECT * FROM artifacts WHERE id=$1", [
              req.params.id,
            ])
          ).rows[0],
      );
      requireThat(a, "artifact_not_found", 404);
      requireThat(
        !["skill", "evidence"].includes(a.kind),
        "artifact_download_forbidden",
        403,
      );
      const body = await store.read(a.object_key, a.sha256);
      const download = req.query.download === "1";
      reply
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff");
      reply.header(
        "Content-Security-Policy",
        "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
      );
      reply.header(
        "Content-Disposition",
        `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(a.name)}`,
      );
      return reply
        .type(a.mime)
        .send(
          a.mime.split(";")[0] === "text/html"
            ? publicReportHtml(body.toString("utf8"))
            : body,
        );
    },
  );
}
