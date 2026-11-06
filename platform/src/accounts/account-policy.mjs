import { id, digest, requireThat, SKILL_IDS } from "../common/core.mjs";
import { projectBundle } from "../skills/skills.mjs";
import { saveArtifact } from "../files/artifacts.mjs";

export const normalizeEmail = (value) => value.trim().toLowerCase();
export async function eligibleModels(c, workspace) {
  return (
    await c.query(
      `SELECT c.id,c.name,v.config,p.data AS price FROM workspace_connections w
    JOIN connections c ON c.id=w.connection_id JOIN connection_versions v ON v.id=c.active_version_id
    JOIN price_cards p ON p.connection_id=c.id AND p.active
    WHERE w.workspace_id=$1 AND w.enabled AND c.kind='model' AND c.enabled AND v.verified ORDER BY c.created_at DESC`,
      [workspace],
    )
  ).rows;
}
export async function selectedModel(c, workspace, user, requested) {
  const models = await eligibleModels(c, workspace);
  if (requested) {
    requireThat(
      models.some((x) => x.id === requested),
      "model_unavailable",
      409,
    );
    return requested;
  }
  const preferred =
    user &&
    (
      await c.query(
        "SELECT default_model_id FROM memberships WHERE workspace_id=$1 AND user_id=$2",
        [workspace, user],
      )
    ).rows[0]?.default_model_id;
  return models.find((x) => x.id === preferred)?.id || models[0]?.id || null;
}
export async function assertWorkspaceAccess(c, workspace, user) {
  const row = (
    await c.query(
      `SELECT w.enabled,w.subscription_required,m.role,u.enabled AS user_enabled,
    s.ends_at>clock_timestamp() AND s.starts_at<=clock_timestamp() AS subscribed
    FROM workspaces w JOIN memberships m ON m.workspace_id=w.id JOIN users u ON u.id=m.user_id
    LEFT JOIN subscription_periods s ON s.id=w.subscription_id
    WHERE w.id=$1 AND m.user_id=$2`,
      [workspace, user],
    )
  ).rows[0];
  requireThat(row?.enabled && row.user_enabled, "workspace_forbidden", 403);
  requireThat(
    !row.subscription_required || row.subscribed,
    "subscription_inactive",
    409,
  );
  return row;
}
export function defaultProvisioner(projectRoot, store) {
  let bundles;
  const prepare = () =>
    (bundles ||= Promise.all(
      SKILL_IDS.map((s) => projectBundle(projectRoot, s)),
    ).catch((e) => {
      bundles = null;
      throw e;
    }));
  return {
    prepare,
    async create(c, workspace, owner, name, kind, prepared) {
      await c.query(
        "INSERT INTO workspaces(id,name,kind,subscription_required) VALUES($1,$2,$3,$4)",
        [workspace, name, kind, kind === "team"],
      );
      await c.query(
        "INSERT INTO memberships(user_id,workspace_id,role) VALUES($1,$2,'owner')",
        [owner, workspace],
      );
      await c.query("SELECT set_config('app.workspace_id',$1,true)", [
        workspace,
      ]);
      for (const currency of ["model_micro_cny", "data_points", "ai_test_uses"])
        await c.query(
          "INSERT INTO wallets(workspace_id,currency) VALUES($1,$2)",
          [workspace, currency],
        );
      await c.query(
        `INSERT INTO workspace_connections(workspace_id,connection_id)
        SELECT $1,c.id FROM connections c JOIN connection_versions v ON v.id=c.active_version_id
        WHERE c.signup_default AND c.enabled AND v.verified`,
        [workspace],
      );
      for (const bundle of prepared) {
        const release = id(),
          a = await saveArtifact(
            c,
            store,
            workspace,
            Buffer.from(JSON.stringify(bundle)),
            { name: `${bundle.skill_id}-v1.json`, kind: "skill" },
          );
        await c.query(
          "INSERT INTO skill_releases(id,workspace_id,skill_id,version,artifact_id,digest) VALUES($1,$2,$3,1,$4,$5)",
          [release, workspace, bundle.skill_id, a.id, digest(bundle)],
        );
        await c.query(
          "INSERT INTO skill_bindings(workspace_id,skill_id,release_id) VALUES($1,$2,$3)",
          [workspace, bundle.skill_id, release],
        );
      }
      await c.query(
        "INSERT INTO tenant_audit(workspace_id,actor_id,action,summary) VALUES($1,$2,'workspace.created',$3)",
        [workspace, owner, { kind }],
      );
    },
  };
}
