import { requireThat } from "../common/core.mjs";
export async function candidateSource(c, store, reportId, productId) {
  const report = (
    await c.query(
      "SELECT r.*,j.request FROM records r LEFT JOIN jobs j ON j.id::text=r.data->>'job_id' WHERE r.id=$1 AND r.kind='report'",
      [reportId],
    )
  ).rows[0];
  requireThat(report, "report_not_found", 404);
  const artifact = (
    await c.query("SELECT * FROM artifacts WHERE id=$1", [
      report.data.candidates_artifact_id,
    ])
  ).rows[0];
  requireThat(artifact, "report_candidates_missing", 409);
  const candidate = JSON.parse(
    (await store.read(artifact.object_key, artifact.sha256)).toString(),
  ).find((p) => p.product_id === productId);
  requireThat(candidate, "candidate_not_found", 404);
  const related = (
    await c.query(
      `SELECT id,kind,data,updated_at FROM records WHERE kind='opportunity' AND data->>'report_id'=$1 AND data->>'product_id'=$2`,
      [reportId, productId],
    )
  ).rows;
  const linked = related.length
    ? (
        await c.query(
          `SELECT id,kind,data,updated_at FROM records WHERE data->>'opportunity_id'=ANY($1::text[]) ORDER BY created_at`,
          [related.map((r) => r.id)],
        )
      ).rows
    : [];
  // Preserve all product-scoped saved supplements. Do not copy shop-wide supplier envelopes into a product.
  const supplements = (
    await c.query(
      `SELECT id,checkpoint->>'supplement_kind' AS kind,result,updated_at FROM jobs WHERE COALESCE(checkpoint->>'source_report_id',request->>'report_id')=$1 AND COALESCE(checkpoint->>'product_id',request->>'product_id')=$2 AND status IN('succeeded','partial')`,
      [reportId, productId],
    )
  ).rows;
  const productEvidence = [];
  const references = new Set(
    (candidate.evidence || []).map((e) => e.invocation_id).filter(Boolean),
  );
  for (const supplement of supplements) {
    if (supplement.result?.panels) {
      supplement.result = {
        ...supplement.result,
        panels: Object.fromEntries(
          Object.entries(supplement.result.panels).filter(([name]) =>
            name.startsWith("product_"),
          ),
        ),
      };
      for (const reference of Object.values(supplement.result.panels))
        references.add(reference);
    }
  }
  for (const reference of references) {
    if (!/^[0-9a-f-]{36}$/i.test(reference)) continue;
    const artifact = (
      await c.query(
        "SELECT a.* FROM invocations i JOIN artifacts a ON a.id=i.artifact_id WHERE i.id=$1 AND i.state='succeeded'",
        [reference],
      )
    ).rows[0];
    if (!artifact) continue;
    const envelope = JSON.parse(
      (await store.read(artifact.object_key, artifact.sha256)).toString(),
    );
    if (
      envelope.request?.filter?.product_id !== productId ||
      !String(envelope.tool).startsWith("product_")
    )
      continue;
    productEvidence.push({
      invocation_id: reference,
      artifact_id: artifact.id,
      tool: envelope.tool,
      captured_at: envelope.captured_at,
      request: envelope.request,
      data: (envelope.decoded || []).map((x) => x.data).filter(Boolean),
    });
  }
  return {
    candidate,
    report_id: reportId,
    artifact_id: artifact.id,
    artifact_digest: artifact.sha256,
    market:
      candidate.market || report.request?.market || report.data.market || "",
    platform: candidate.platform || report.data.platform || "tiktok",
    captured_at: report.data.captured_at || report.created_at,
    related,
    linked,
    supplements,
    product_evidence: productEvidence,
  };
}
