import { pathToFileURL } from "node:url";
import path from "node:path";
import { createDatabase } from "../src/infra/db.mjs";
import { LocalStore } from "../src/infra/storage.mjs";
import { saveArtifact } from "../src/files/artifacts.mjs";
import {
  renderSpecialistReport,
  SPECIALIST_REPORT_VERSION,
} from "../src/reports/specialist-report.mjs";
import { SPECIALIST_KINDS } from "../src/research/scope.mjs";
import { requireThat, uuid } from "../src/common/core.mjs";

export async function rerenderSpecialistReport(
  db,
  store,
  workspaceId,
  reportId,
) {
  return db.tenant(workspaceId, async (c) => {
    const report = (
      await c.query(
        "SELECT * FROM records WHERE id=$1 AND kind='report' FOR UPDATE",
        [reportId],
      )
    ).rows[0];
    requireThat(report, "report_not_found", 404);
    const job = (
      await c.query("SELECT * FROM jobs WHERE id=$1", [report.data.job_id])
    ).rows[0];
    requireThat(
      job?.result && SPECIALIST_KINDS.includes(job.kind),
      "report_not_rerenderable",
      409,
    );
    const sources = new Map();
    const invocations = (
      await c.query(
        "SELECT i.id,a.object_key,a.sha256 FROM invocations i JOIN artifacts a ON a.id=i.artifact_id WHERE i.job_id=$1 AND i.kind='data' AND i.state='succeeded'",
        [job.id],
      )
    ).rows;
    for (const inv of invocations)
      sources.set(
        inv.id,
        JSON.parse((await store.read(inv.object_key, inv.sha256)).toString()),
      );
    const html = await saveArtifact(
      c,
      store,
      workspaceId,
      Buffer.from(
        renderSpecialistReport(job.result, {
          title: job.title,
          kind: job.kind,
          skill_version: job.snapshot.skill.version,
          created_at: report.data.captured_at || report.created_at,
          sources,
        }),
      ),
      {
        name: `${job.title}.html`,
        mime: "text/html; charset=utf-8",
        kind: "report",
      },
    );
    const data = {
      ...report.data,
      research_kind: job.kind,
      template_version: SPECIALIST_REPORT_VERSION,
      artifact_id: html.id,
      revised_at: new Date().toISOString(),
      previous_artifact_ids: [
        ...new Set([
          ...(report.data.previous_artifact_ids || []),
          report.data.artifact_id,
        ]),
      ],
    };
    await c.query(
      "UPDATE records SET data=$2,version=version+1,updated_at=now() WHERE id=$1",
      [reportId, data],
    );
    await c.query(
      "INSERT INTO tenant_audit(workspace_id,actor_id,action,target_id,summary) VALUES($1,$2,'report.rerender',$3,$4)",
      [
        workspaceId,
        report.created_by,
        reportId,
        {
          previous_artifact_id: report.data.artifact_id,
          artifact_id: html.id,
          billing_changed: false,
          template_version: SPECIALIST_REPORT_VERSION,
        },
      ],
    );
    return {
      report_id: reportId,
      artifact_id: html.id,
      billing_changed: false,
    };
  });
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  const db = createDatabase(process.env.DATABASE_URL);
  try {
    console.log(
      JSON.stringify(
        await rerenderSpecialistReport(
          db,
          new LocalStore(process.env.DATA_ROOT),
          uuid.parse(process.env.WORKSPACE_ID),
          uuid.parse(process.env.REPORT_ID),
        ),
      ),
    );
  } finally {
    await db.close();
  }
}
