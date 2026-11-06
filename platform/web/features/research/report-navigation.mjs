export function reportPage(kind) {
  return kind === "scouting"
    ? "scouting"
    : kind === "monitoring"
      ? "monitoring"
      : "research";
}
