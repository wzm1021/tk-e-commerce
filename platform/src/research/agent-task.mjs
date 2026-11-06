// Only execution inputs cross into the tenant-controlled container.
// Full price cards and provider routing remain in the platform/supervisor boundary.
import { publicDataPricing } from "../data/pricing.mjs";
export function agentTask(task) {
  const snapshot = task.snapshot;
  return {
    id: task.id,
    kind: task.kind,
    request: task.request,
    checkpoint: task.checkpoint || {},
    limits: task.limits || {},
    data_access: {
      available: Boolean(snapshot.data),
      billing: "shared_workspace_balance",
      live_call_points: task.request?.platform === "amazon" ? 1 : null,
      live_tool_points: publicDataPricing(
        task.request?.platform === "amazon" ? "sellersprite" : "fastmoss",
      ).tools,
      snapshot_hit_points: 0.3,
    },
    snapshot: {
      created_at: snapshot.created_at,
      skill: {
        skill_id: snapshot.skill.skill_id,
        version: snapshot.skill.version,
        digest: snapshot.skill.digest,
      },
      model: {
        config: { model: snapshot.model.config.model },
        price: {
          max_context_tokens: snapshot.model.price.max_context_tokens,
          max_output_tokens: snapshot.model.price.max_output_tokens,
        },
      },
    },
  };
}
