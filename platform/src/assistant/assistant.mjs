import { pointUnits, pointBudget } from "../common/data-points.mjs";
import { z } from "zod";
import { id, uuid, digest, requireThat, micro, money } from "../common/core.mjs";
import { freezeTask, jobEvent } from "../research/jobs.mjs";
import { assistantHistory } from "./assistant-contract.mjs";
import {
  assertWorkspaceAccess,
  selectedModel,
} from "../accounts/account-policy.mjs";

const text = z.string().trim().min(1);
const Ref = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("candidate"),
      report_id: uuid,
      product_id: text.max(100),
    })
    .strict(),
  z.object({ kind: z.literal("opportunity"), record_id: uuid }).strict(),
  z
    .object({
      kind: z.literal("manual"),
      title: text.max(300),
      product_id: z
        .string()
        .regex(/^\d{10,30}$/)
        .optional(),
      tk_url: z
        .string()
        .url()
        .max(2000)
        .refine((x) => {
          const u = new URL(x);
          return (
            u.protocol === "https:" &&
            (u.hostname === "tiktok.com" || u.hostname.endsWith(".tiktok.com"))
          );
        })
        .optional(),
      notes: text.max(6000),
    })
    .strict(),
]);
const Contexts = z.array(Ref).max(10);
export const ContextEdit = z
  .object({
    version: z.number().int().positive(),
    additions: Contexts.default([]),
    remove_ids: z.array(uuid).max(10).default([]),
  })
  .strict();
const turnInput = z
  .object({
    question: text.max(3000),
    context_version: z.number().int().positive(),
    data_mode: z.enum(["auto", "context_only"]).default("auto"),
    model_connection_id: uuid.optional(),
    model_budget: money.optional(),
    data_budget: pointBudget(20).optional(),
    idempotency_key: z.string().min(12).max(80),
  })
  .strict();

async function conversation(c, cid, lock = false) {
  const row = (
    await c.query(
      "SELECT * FROM records WHERE id=$1 AND kind='conversation'" +
        (lock ? " FOR UPDATE" : ""),
      [cid],
    )
  ).rows[0];
  requireThat(row, "conversation_not_found", 404);
  return row;
}
function compactProduct(candidate) {
  const keys = [
    "product_id",
    "title",
    "tk_url",
    "rating",
    "price",
    "price_currency",
    "units7",
    "gmv7",
    "strategy_a",
    "strategy_b",
    "decision",
    "source_kind",
    "limitations",
    "discrepancies",
    "reason",
  ];
  const out = Object.fromEntries(
    keys
      .filter((k) => candidate[k] !== undefined)
      .map((k) => [k, candidate[k]]),
  );
  if (typeof out.reason === "string" && out.reason.length > 1400) {
    out.reason = out.reason.slice(0, 1400);
    out.reason_excerpted = true;
  }
  out.evidence = (candidate.evidence || [])
    .filter((e) => Buffer.byteLength(JSON.stringify(e)) <= 800)
    .slice(0, 12);
  out.evidence_selection = "最多附带 12 条简短证据；完整证据仍在来源报告中。";
  return out;
}
async function candidateData(c, store, rid, pid) {
  const r = (
    await c.query("SELECT * FROM records WHERE id=$1 AND kind='report'", [rid])
  ).rows[0];
  requireThat(r, "report_not_found", 404);
  const a = (
    await c.query("SELECT * FROM artifacts WHERE id=$1 AND kind='candidates'", [
      r.data.candidates_artifact_id,
    ])
  ).rows[0];
  requireThat(a, "artifact_not_found", 404);
  const rows = JSON.parse(
    (await store.read(a.object_key, a.sha256)).toString(),
  );
  const product = rows.find((x) => x.product_id === pid);
  requireThat(product, "candidate_not_found", 404);
  return { report: r, product: compactProduct(product) };
}
async function hydrate(c, store, ref) {
  const context = {
    id: id(),
    ref,
    kind: ref.kind,
    added_at: new Date().toISOString(),
  };
  if (ref.kind === "manual")
    return {
      ...context,
      title: ref.title,
      product_id: ref.product_id || null,
      tk_url: ref.tk_url || null,
      captured_at: context.added_at,
      source_note: "用户手工提供，未由数据接口核验",
      data: { notes: ref.notes },
    };
  if (ref.kind === "candidate") {
    const { report, product } = await candidateData(
      c,
      store,
      ref.report_id,
      ref.product_id,
    );
    return {
      ...context,
      title: product.title,
      product_id: product.product_id,
      tk_url: product.tk_url,
      captured_at: report.data.captured_at || report.created_at,
      source_note:
        (report.data.source_kind === "user_provided_historical_report"
          ? "历史导入报告"
          : "已保存研究报告") +
        (report.data.superseded_by ? " · 已有修订，请注意原稿限制" : ""),
      data: product,
    };
  }
  const row = (
    await c.query("SELECT * FROM records WHERE id=$1 AND kind='opportunity'", [
      ref.record_id,
    ])
  ).rows[0];
  requireThat(row, "opportunity_not_found", 404);
  const data = { ...row.data };
  if (row.data.report_id)
    data.report_product = (
      await candidateData(c, store, row.data.report_id, row.data.product_id)
    ).product;
  const related = (
    await c.query(
      "SELECT id,kind,version,data,updated_at FROM records WHERE kind IN('supplier','economics') AND data->>'opportunity_id'=$1 ORDER BY updated_at DESC LIMIT 4",
      [row.id],
    )
  ).rows;
  data.related_records = related.map((r) => ({
    id: r.id,
    kind: r.kind,
    version: r.version,
    captured_at: r.updated_at,
    data:
      r.kind === "economics"
        ? { result: r.data.result, dependencies: r.data.dependencies }
        : r.data,
  }));
  return {
    ...context,
    title: row.data.title,
    product_id: row.data.product_id,
    tk_url: row.data.tk_url,
    captured_at: row.updated_at,
    source_note: "机会池快照 · 附最近最多 4 条货源/利润记录，时间分别标注",
    data,
  };
}
export async function resolveContexts(
  c,
  store,
  old,
  additions,
  removeIds = [],
) {
  let contexts = old.filter((x) => !removeIds.includes(x.id));
  const keys = new Set(contexts.map((x) => digest(x.ref)));
  for (const ref of additions) {
    const key = digest(ref);
    if (keys.has(key)) continue;
    contexts.push(await hydrate(c, store, ref));
    keys.add(key);
  }
  requireThat(contexts.length <= 10, "assistant_context_limit", 409);
  requireThat(
    Buffer.byteLength(JSON.stringify(contexts)) <= 256000,
    "assistant_context_too_large",
    413,
  );
  return contexts;
}

export function installAssistant(app, db, store) {
  app.get("/api/assistant/conversations", { preHandler: app.user }, (req) =>
    db.tenant(req.workspace, async (c) => ({
      items: (
        await c.query(
          "SELECT id,data->>'title' AS title,jsonb_array_length(data->'contexts') AS context_count,version,created_at,updated_at FROM records WHERE kind='conversation' ORDER BY updated_at DESC LIMIT 100",
        )
      ).rows,
    })),
  );
  app.post(
    "/api/assistant/conversations",
    { preHandler: app.user },
    async (req) => {
      const input = z
        .object({
          id: uuid,
          title: text.max(160).default("商品对话"),
          contexts: Contexts.default([]),
        })
        .strict()
        .parse(req.body);
      return db.tenant(req.workspace, async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          req.workspace + input.id,
        ]);
        const old = (
          await c.query(
            "SELECT * FROM records WHERE id=$1 AND kind='conversation'",
            [input.id],
          )
        ).rows[0];
        if (old) {
          requireThat(
            old.data.creation_hash === digest(input),
            "conversation_id_conflict",
            409,
          );
          return old;
        }
        const contexts = await resolveContexts(c, store, [], input.contexts);
        const row = (
          await c.query(
            "INSERT INTO records(id,workspace_id,kind,data,created_by) VALUES($1,$2,'conversation',$3,$4) RETURNING *",
            [
              input.id,
              req.workspace,
              { title: input.title, contexts, creation_hash: digest(input) },
              req.identity.id,
            ],
          )
        ).rows[0];
        await c.query(
          "INSERT INTO tenant_audit(workspace_id,actor_id,action,target_id) VALUES($1,$2,'assistant.create',$3)",
          [req.workspace, req.identity.id, row.id],
        );
        return row;
      });
    },
  );
  app.put(
    "/api/assistant/conversations/:id/contexts",
    { preHandler: app.user },
    async (req) => {
      const cid = uuid.parse(req.params.id),
        input = ContextEdit.parse(req.body);
      return db.tenant(req.workspace, async (c) => {
        const row = await conversation(c, cid, true);
        requireThat(
          row.version === input.version,
          "record_version_conflict",
          409,
        );
        const contexts = await resolveContexts(
          c,
          store,
          row.data.contexts,
          input.additions,
          input.remove_ids,
        );
        const updated = (
          await c.query(
            "UPDATE records SET data=jsonb_set(data,'{contexts}',$2),version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
            [cid, JSON.stringify(contexts)],
          )
        ).rows[0];
        await c.query(
          "INSERT INTO tenant_audit(workspace_id,actor_id,action,target_id,summary) VALUES($1,$2,'assistant.contexts',$3,$4)",
          [
            req.workspace,
            req.identity.id,
            cid,
            { version: updated.version, count: contexts.length },
          ],
        );
        return updated;
      });
    },
  );
  app.get(
    "/api/assistant/conversations/:id",
    { preHandler: app.user },
    async (req) =>
      db.tenant(req.workspace, async (c) => {
        const row = await conversation(c, uuid.parse(req.params.id));
        const turns = (
          await c.query(
            "SELECT id,status,request,result,model_spent,data_spent,model_budget,data_budget,error_code,created_at,snapshot->'model'->'config'->>'model' AS model_name FROM jobs WHERE kind='assistant' AND request->>'conversation_id'=$1 ORDER BY created_at,id LIMIT 100",
            [row.id],
          )
        ).rows;
        const calls = turns.length
          ? (
              await c.query(
                "SELECT job_id,id,kind,state,charged,created_at,usage->'request'->>'tool' AS tool,usage->'request'->>'purpose' AS purpose,usage->>'bound_breached' AS bound_breached,usage->>'cache_hit' AS cache_hit,usage->>'captured_at' AS captured_at FROM invocations WHERE job_id=ANY($1::uuid[]) ORDER BY created_at",
                [turns.map((x) => x.id)],
              )
            ).rows
          : [];
        return {
          ...row,
          turns: turns.map((t) => ({
            ...t,
            request: {
              question: t.request.question,
              data_mode: t.request.data_mode,
              contexts: t.request.contexts,
              context_version: t.request.context_version,
              history_count: t.request.history.length,
            },
            calls: calls.filter((x) => x.job_id === t.id),
          })),
        };
      }),
  );
  app.post(
    "/api/assistant/conversations/:id/messages",
    { preHandler: app.user },
    async (req) => {
      const cid = uuid.parse(req.params.id),
        input = turnInput.parse(req.body);
      return db.tenant(req.workspace, async (c) => {
        const row = await conversation(c, cid, true);
        await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          req.workspace + "assistant:" + input.idempotency_key,
        ]);
        const old = (
          await c.query("SELECT * FROM jobs WHERE idempotency_key=$1", [
            "assistant:" + input.idempotency_key,
          ])
        ).rows[0];
        const submissionHash = digest({ conversation_id: cid, ...input });
        if (old) {
          requireThat(
            old.kind === "assistant" &&
              old.request.submission_hash === submissionHash,
            "job_idempotency_conflict",
            409,
          );
          return { id: old.id, status: old.status };
        }
        requireThat(
          row.version === input.context_version,
          "record_version_conflict",
          409,
        );
        const previous = (
          await c.query(
            "SELECT id,status,request,result FROM jobs WHERE kind='assistant' AND request->>'conversation_id'=$1 ORDER BY created_at DESC,id DESC LIMIT 100",
            [cid],
          )
        ).rows;
        requireThat(previous.length < 100, "assistant_turn_limit", 409);
        requireThat(
          !previous.some((x) =>
            [
              "queued",
              "running",
              "awaiting_connection",
              "waiting_input",
            ].includes(x.status),
          ),
          "assistant_turn_active",
          409,
        );
        const history = assistantHistory(previous);
        await assertWorkspaceAccess(c, req.workspace, req.identity.id);
        const job = {
          id: id(),
          kind: "assistant",
          billing_mode: "wallet_per_call",
          model_budget: "0",
          data_budget: "0",
          requested_model_id: await selectedModel(
            c,
            req.workspace,
            req.identity.id,
            input.model_connection_id,
          ),
          request: {
            conversation_id: cid,
            context_version: row.version,
            question: input.question,
            contexts: row.data.contexts,
            history,
            previous_compaction:
              previous.find(
                (x) =>
                  ["succeeded", "partial"].includes(x.status) &&
                  x.result?.compaction,
              )?.result.compaction || null,
            history_omitted: previous.length - history.length,
            data_mode: input.data_mode,
            submission_hash: submissionHash,
          },
        };
        const frozen = await freezeTask(c, req.workspace, job);
        const status = frozen.missing ? "awaiting_connection" : "queued";
        await c.query(
          "INSERT INTO jobs(id,workspace_id,created_by,kind,title,request,snapshot,digest,status,idempotency_key,model_budget,data_budget,requested_model_id,auto_budget,billing_mode) VALUES($1,$2,$3,'assistant',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
          [
            job.id,
            req.workspace,
            req.identity.id,
            input.question.slice(0, 160),
            job.request,
            frozen.snapshot || null,
            frozen.digest || null,
            status,
            "assistant:" + input.idempotency_key,
            job.model_budget,
            job.data_budget,
            job.requested_model_id,
            true,
            job.billing_mode,
          ],
        );
        if (status === "queued") {
          await c.query(
            "INSERT INTO dispatch(job_id,workspace_id) VALUES($1,$2)",
            [job.id, req.workspace],
          );
        }
        await c.query("UPDATE records SET updated_at=now() WHERE id=$1", [cid]);
        await jobEvent(
          c,
          req.workspace,
          job.id,
          status,
          status === "queued"
            ? "问题已提交，商品上下文和技能版本已固定"
            : "问题已保存，等待平台完成模型或技能配置",
        );
        return { id: job.id, status, missing: frozen.missing || [] };
      });
    },
  );
}
