import { z } from "zod";
import { digest, requireThat, uuid } from "../common/core.mjs";

export const AssistantResult = z
  .object({
    status: z.enum(["complete", "partial"]),
    answer: z.string().trim().min(1).max(16000),
    citations: z
      .array(
        z
          .object({
            source_type: z.enum(["context", "data"]),
            source_id: uuid,
            pointer: z.string().max(1500),
            value: z.unknown(),
            label: z.string().min(1).max(300),
          })
          .strict(),
      )
      .max(40),
    limitations: z.array(z.string().max(1500)).max(15),
    followups: z.array(z.string().max(500)).max(5),
  })
  .strict();
export const ASSISTANT_JSON_SCHEMA = z.toJSONSchema(AssistantResult);
const memoryText = z.string().min(1).max(2500);
export const AssistantStoredResult = AssistantResult.extend({
  compaction: z
    .object({
      version: z.literal(1),
      history_memory: z
        .object({
          summary: memoryText,
          through_job_id: uuid,
          digest: z.string().length(64),
          covered_turns: z.number().int().min(1).max(100),
        })
        .strict()
        .nullable(),
      context_memory: z
        .object({
          summary: memoryText,
          digest: z.string().length(64),
          context_count: z.number().int().min(1).max(10),
        })
        .strict()
        .nullable(),
      events: z
        .array(
          z
            .object({
              kind: z.enum(["history", "contexts"]),
              source_bytes: z.number().int().nonnegative(),
              summary_bytes: z.number().int().nonnegative(),
              parts: z.number().int().positive(),
            })
            .strict(),
        )
        .max(100),
      input_bytes: z.number().int().nonnegative(),
      output_bytes: z.number().int().nonnegative(),
    })
    .strict()
    .optional(),
});

export function valueAt(object, path) {
  if (path === "") return object;
  if (!path.startsWith("/")) return undefined;
  return path
    .slice(1)
    .split("/")
    .reduce((v, k) => {
      const key = k.replaceAll("~1", "/").replaceAll("~0", "~");
      return v !== null && typeof v === "object" && Object.hasOwn(v, key)
        ? v[key]
        : undefined;
    }, object);
}

export function validateAssistantCitations(result, contexts, sources) {
  const contextMap = new Map(contexts.map((x) => [x.id, x]));
  return result.citations.map((citation) => {
    const context =
      citation.source_type === "context"
        ? contextMap.get(citation.source_id)
        : null;
    const source =
      citation.source_type === "data" ? sources.get(citation.source_id) : null;
    requireThat(context || source, "unrecognized_evidence", 409);
    const value = valueAt(context || source.envelope, citation.pointer);
    requireThat(
      value !== undefined &&
        citation.value !== undefined &&
        digest(value) === digest(citation.value),
      "evidence_value_mismatch",
      409,
    );
    requireThat(
      Buffer.byteLength(JSON.stringify(value)) <= 6000,
      "citation_too_large",
      409,
    );
    return {
      ...citation,
      source: context
        ? context.source_note
        : "FastMoss · " + source.envelope.tool,
      captured_at: context ? context.captured_at : source.envelope.captured_at,
      artifact_id: source?.artifact_id || null,
    };
  });
}

export function assistantHistory(jobs, maxBytes = Infinity, maxTurns = 100) {
  const history = [];
  let bytes = 0;
  for (const job of jobs) {
    if (!["succeeded", "partial"].includes(job.status) || !job.result?.answer)
      continue;
    const entry = {
      job_id: job.id,
      question: job.request.question,
      answer: job.result.answer,
      contexts: job.request.contexts.map((x) => ({
        id: x.id,
        title: x.title,
        product_id: x.product_id,
      })),
      citations: job.result.citations,
      limitations: job.result.limitations,
    };
    const size = Buffer.byteLength(JSON.stringify(entry));
    if (history.length >= maxTurns || bytes + size > maxBytes) break;
    history.unshift(entry);
    bytes += size;
  }
  return history;
}
