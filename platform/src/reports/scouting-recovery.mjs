import { ensureScoutingCandidates } from "./scouting-policy.mjs";

export function recoverScoutingDraft(
  request,
  sources,
  reason = "agent_execution_failed",
) {
  const result = ensureScoutingCandidates(
    {
      status: "partial",
      summary:
        "研究中断，已从本任务归档数据恢复候选资料；尚未完成的分析与验证需要继续。",
      sections: [],
      candidates: [],
      questions: [],
      next_actions: [],
      limitations: [
        "本次研究执行中断，以下候选从已成功归档的商品搜索或榜单恢复，不代表已完成筛选。",
      ],
    },
    request,
    sources,
  );
  if (!result.candidates.length) return null;
  return { ...result, recovery: { reason, from_archived_data: true } };
}
