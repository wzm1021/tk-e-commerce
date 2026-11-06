const reportTime = (row) =>
  Date.parse(row.data.captured_at || row.created_at) || 0;

export function orderedReports(items) {
  return [...items].sort(
    (a, b) => reportTime(b) - reportTime(a) || a.id.localeCompare(b.id),
  );
}

// A new completed report takes focus. Refreshing/revising an existing report
// must not select an older run or discard an intentional historical selection.
export function nextReportSelection(items, previous, focus = null) {
  const newest = orderedReports(items).find((row) => !row.data.superseded_by);
  const requested =
    focus && focus !== previous.focus
      ? items.find((row) => row.id === focus.id)
      : null;
  const selected = items.find((row) => row.id === previous.id);
  return {
    id:
      (
        requested ||
        (newest?.id !== previous.newestId ? newest : selected) ||
        newest ||
        items[0]
      )?.id || null,
    newestId: newest?.id || null,
    focus: requested ? focus : previous.focus,
  };
}

export const recommendationLabel = (candidate) =>
  ({ shortlist: "优先研究", watch: "继续观察", reject: "暂不推进" })[
    candidate.decision
  ] || "待补充分析";
