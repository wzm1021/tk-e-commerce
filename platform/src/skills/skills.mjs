import { readFile, readdir, lstat } from "node:fs/promises";
import path from "node:path";
import { id, digest, requireThat, SKILL_IDS } from "../common/core.mjs";
import { saveArtifact } from "../files/artifacts.mjs";
export function validateBundle(bundle) {
  requireThat(
    bundle &&
      bundle.schema_version === 1 &&
      bundle.files &&
      typeof bundle.files === "object" &&
      !Array.isArray(bundle.files),
    "invalid_skill_bundle",
  );
  const entries = Object.entries(bundle.files);
  requireThat(
    entries.length > 0 && entries.length <= 300,
    "invalid_skill_files",
  );
  let total = 0;
  for (const [p, text] of entries) {
    requireThat(
      typeof text === "string" &&
        /^[a-zA-Z0-9_.\/-]+$/.test(p) &&
        !p.startsWith("/") &&
        !p.split("/").some((x) => ["..", ".", ""].includes(x)) &&
        !p.startsWith("."),
      "unsafe_skill_path",
    );
    requireThat(Buffer.byteLength(text) < 1024 * 1024, "skill_file_too_large");
    total += Buffer.byteLength(text);
  }
  requireThat(total < 6 * 1024 * 1024, "skill_bundle_too_large");
  return bundle;
}
export async function projectBundle(projectRoot, skillId, customInstructions) {
  requireThat(SKILL_IDS.includes(skillId), "unknown_skill");
  const files = {};
  async function walk(relative) {
    const full = path.join(projectRoot, relative);
    for (const e of await readdir(full, { withFileTypes: true })) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const p = relative + "/" + e.name;
      const s = await lstat(path.join(projectRoot, p));
      requireThat(!s.isSymbolicLink(), "skill_symlink_forbidden");
      if (e.isDirectory()) await walk(p);
      else if (/\.(md|json|mjs|ts|css|txt)$/.test(p))
        files[p] = await readFile(path.join(projectRoot, p), "utf8");
    }
  }
  await walk(`skills/${skillId}`);
  for (const p of skillId === "amazon-product-scouting"
    ? [
        "docs/amazon-integration-contract.md",
        "schemas/sellersprite-capabilities.json",
      ]
    : [
        "docs/fastmoss-analysis-contract.md",
        "docs/1688-integration-contract.md",
        "docs/fastmoss-api-catalog.md",
        "schemas/fastmoss-tools.snapshot.json",
        "src/fastmoss/generated-inputs.ts",
      ])
    files[p] = await readFile(path.join(projectRoot, p), "utf8");
  if (customInstructions !== undefined) {
    requireThat(
      typeof customInstructions === "string" &&
        customInstructions.length >= 30 &&
        customInstructions.length <= 120000,
      "invalid_skill_instructions",
    );
    files[`skills/${skillId}/SKILL.md`] = customInstructions;
  }
  return validateBundle({ schema_version: 1, skill_id: skillId, files });
}
export async function publishSkill(
  db,
  store,
  workspace,
  actor,
  skillId,
  bundle,
  expectedGeneration,
) {
  validateBundle(bundle);
  requireThat(
    bundle.skill_id === skillId && bundle.files[`skills/${skillId}/SKILL.md`],
    "skill_identity_mismatch",
  );
  return db.tenant(workspace, async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `skill:${workspace}:${skillId}`,
    ]);
    const current = (
      await c.query("SELECT * FROM skill_bindings WHERE skill_id=$1", [skillId])
    ).rows[0];
    requireThat(
      (current?.generation || 0) === expectedGeneration,
      "skill_publish_conflict",
      409,
    );
    const version = Number(
      (
        await c.query(
          "SELECT COALESCE(max(version),0)+1 AS v FROM skill_releases WHERE skill_id=$1",
          [skillId],
        )
      ).rows[0].v,
    );
    const sha = digest(bundle);
    const a = await saveArtifact(
      c,
      store,
      workspace,
      Buffer.from(JSON.stringify(bundle)),
      { name: `${skillId}-v${version}.json`, kind: "skill" },
    );
    const release = id();
    await c.query(
      "INSERT INTO skill_releases(id,workspace_id,skill_id,version,artifact_id,digest) VALUES($1,$2,$3,$4,$5,$6)",
      [release, workspace, skillId, version, a.id, sha],
    );
    await c.query(
      "INSERT INTO skill_bindings(workspace_id,skill_id,release_id,generation) VALUES($1,$2,$3,1) ON CONFLICT(workspace_id,skill_id) DO UPDATE SET release_id=$3,generation=skill_bindings.generation+1",
      [workspace, skillId, release],
    );
    await c.query(
      "INSERT INTO platform_audit(actor_id,action,target_id,summary) VALUES($1,'skill.publish',$2,$3)",
      [actor, workspace, { skill_id: skillId, version, digest: sha }],
    );
    return {
      release_id: release,
      version,
      generation: expectedGeneration + 1,
      digest: sha,
    };
  });
}

// Provision newly introduced skills in the same tenant transaction, without
// replacing custom bindings. The advisory lock protects first-use races.
export async function ensureDefaultSkill(
  c,
  store,
  projectRoot,
  workspace,
  skillId,
) {
  await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    `skill:${workspace}:${skillId}`,
  ]);
  if (
    (await c.query("SELECT 1 FROM skill_bindings WHERE skill_id=$1", [skillId]))
      .rowCount
  )
    return;
  const bundle = await projectBundle(projectRoot, skillId);
  const a = await saveArtifact(
    c,
    store,
    workspace,
    Buffer.from(JSON.stringify(bundle)),
    { name: `${skillId}-v1.json`, kind: "skill" },
  );
  const release = id();
  await c.query(
    "INSERT INTO skill_releases(id,workspace_id,skill_id,version,artifact_id,digest) VALUES($1,$2,$3,1,$4,$5)",
    [release, workspace, skillId, a.id, digest(bundle)],
  );
  await c.query(
    "INSERT INTO skill_bindings(workspace_id,skill_id,release_id,generation) VALUES($1,$2,$3,1)",
    [workspace, skillId, release],
  );
}
