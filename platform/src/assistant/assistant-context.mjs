import { createHash } from "node:crypto";

export const bytes = (v) =>
  Buffer.byteLength(typeof v === "string" ? v : JSON.stringify(v));
export const contextDigest = (v) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");

// Split by Unicode code point, never discard a suffix or split a surrogate pair.
export function contextChunks(value, limit = 12000) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const chunks = [];
  let chunk = "",
    size = 0;
  for (const point of text) {
    const n = Buffer.byteLength(point);
    if (size + n > limit && chunk) {
      chunks.push(chunk);
      chunk = "";
      size = 0;
    }
    chunk += point;
    size += n;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

export function parseModelJson(text) {
  try {
    return JSON.parse(text);
  } catch {}
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  if (fenced.length === 1) return JSON.parse(fenced[0][1]);
  throw new Error("assistant_output_invalid");
}

export function reusableHistoryMemory(memory, history) {
  if (!memory?.through_job_id) return null;
  const index = history.findIndex((x) => x.job_id === memory.through_job_id);
  if (index < 0 || contextDigest(history.slice(0, index + 1)) !== memory.digest)
    return null;
  return { memory, index };
}

export function contextFacts(context) {
  const { id, title, product_id, captured_at, source_note } = context;
  const data = Object.fromEntries(
    Object.entries(context.data || {}).filter(
      ([, value]) => bytes(value) <= 600,
    ),
  );
  return {
    id,
    title,
    product_id,
    captured_at,
    source_note,
    data,
    omitted_fields: Object.keys(context.data || {}).filter(
      (key) => !Object.hasOwn(data, key),
    ),
  };
}

// summarize is a billed, no-tools model call. Originals remain in task.json and in DB.
export async function prepareAssistantContext(
  request,
  summarize,
  options = {},
) {
  const target = options.targetBytes ?? 22000;
  const history = request.history || [];
  const previous = request.previous_compaction;
  const reusable = reusableHistoryMemory(previous?.history_memory, history);
  let historyMemory = reusable?.memory || null;
  let covered = reusable ? reusable.index + 1 : 0;
  const contextHash = contextDigest(request.contexts);
  let contextMemory =
    previous?.context_memory?.digest === contextHash
      ? previous.context_memory
      : null;
  const events = [];
  let calls = 0;
  async function fold(kind, source, initial = "") {
    let summary = initial;
    const chunks = contextChunks(
      source,
      Math.min(12000, Math.max(4000, target)),
    );
    for (let i = 0; i < chunks.length; i++) {
      if (++calls > 24) throw new Error("assistant_compaction_limit");
      summary = await summarize({
        kind,
        previous_summary: summary,
        part: i + 1,
        parts: chunks.length,
        content: chunks[i],
      });
      if (
        typeof summary !== "string" ||
        !summary.trim() ||
        summary.length > 2500 ||
        bytes(summary) > 7500
      )
        throw new Error("assistant_compaction_invalid");
    }
    events.push({
      kind,
      source_bytes: bytes(source),
      summary_bytes: bytes(summary),
      parts: chunks.length,
    });
    return summary;
  }
  const view = () => ({
    question: request.question,
    data_mode: request.data_mode,
    contexts: contextMemory
      ? request.contexts.map(contextFacts)
      : request.contexts,
    context_summary: contextMemory?.summary || null,
    history_summary: historyMemory?.summary || null,
    history: history.slice(covered),
    original_context_path: "/work/task.json",
    summary_notice:
      "摘要是模型整理的辅助记忆，不是原始证据；完整商品及全部历史在 task.json 的 request 中。引用具体事实时核对原始字段。当前 contexts 才是选中的商品。",
  });
  let force = Boolean(options.force);
  if (
    !contextMemory &&
    bytes(request.contexts) > target / 2 &&
    bytes(view()) > target
  ) {
    const summary = await fold("contexts", request.contexts);
    contextMemory = {
      summary,
      digest: contextHash,
      context_count: request.contexts.length,
    };
  }
  while (covered < history.length && (bytes(view()) > target || force)) {
    // Keep recent turns verbatim when space permits, compress oldest turns incrementally.
    let end = covered + 1;
    while (
      end < Math.max(history.length - 2, covered + 1) &&
      bytes(history.slice(covered, end + 1)) < 12000
    )
      end++;
    const summary = await fold(
      "history",
      history.slice(covered, end),
      historyMemory?.summary || "",
    );
    covered = end;
    historyMemory = {
      summary,
      through_job_id: history[covered - 1].job_id,
      digest: contextDigest(history.slice(0, covered)),
      covered_turns: covered,
    };
    force = false;
  }
  if ((bytes(view()) > target || force) && request.contexts.length) {
    const summary = await fold("contexts", request.contexts);
    contextMemory = {
      summary,
      digest: contextHash,
      context_count: request.contexts.length,
    };
  }
  if (bytes(view()) > target)
    throw new Error("assistant_compaction_insufficient");
  return {
    input: view(),
    compaction: {
      version: 1,
      history_memory: historyMemory,
      context_memory: contextMemory,
      events,
      input_bytes: bytes({
        question: request.question,
        contexts: request.contexts,
        history,
      }),
      output_bytes: bytes(view()),
    },
  };
}
