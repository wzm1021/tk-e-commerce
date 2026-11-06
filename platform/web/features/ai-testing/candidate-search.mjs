export const candidateKey = (c) => c.report_id + ":" + c.product_id;
const normalize = (value) =>
  String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
function nearWord(a, b) {
  if (a.length < 4 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0,
    j = 0,
    edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length >= b.length) i++;
    if (b.length >= a.length) j++;
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
export function searchCandidates(items, query) {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  return items
    .map((item, index) => {
      const haystack = normalize(
        [item.title, item.product_id, ...(item.keywords || [])].join(" "),
      );
      const words = haystack.split(" ");
      let score = 0;
      for (const token of tokens) {
        if (haystack.includes(token)) score += 2;
        else if (words.some((word) => nearWord(token, word))) score++;
        else return null;
      }
      return { item, index, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((x) => x.item);
}
