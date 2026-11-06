import { z } from "zod";
import { id, uuid, requireThat } from "../common/core.mjs";
import { normalizeTikTokLinks } from "../research/requests.mjs";
import { researchKinds, SPECIALIST_KINDS } from "../research/scope.mjs";
import { specialistResultPresentation } from "../common/research-language.mjs";
import {
  calculateEconomics,
  quoteShipping,
} from "../../../skills/tiktok-unit-economics/scripts/calculate.mjs";
const text = z.string().trim().min(1).max(5000),
  short = z.string().trim().min(1).max(200),
  num = z.number().finite().nonnegative(),
  positive = z.number().finite().positive();
const httpUrl = z
  .string()
  .url()
  .refine((v) => ["https:", "http:"].includes(new URL(v).protocol));
const source = z
  .object({
    kind: z.enum([
      "manual",
      "historical_report",
      "fastmoss",
      "sellersprite",
      "1688",
    ]),
    reference: short,
    captured_at: z.string().datetime(),
  })
  .strict();
export const RecordSchemas = {
  opportunity: z
    .object({
      product_id: short,
      title: short,
      tk_url: httpUrl.nullable(),
      platform: z.enum(["tiktok", "amazon"]).optional(),
      market: z.string().max(2).optional(),
      product_url: httpUrl.optional(),
      stage: z
        .enum(["watch", "research", "sample", "test", "approved", "rejected"])
        .default("watch"),
      source,
      report_id: uuid.optional(),
      candidate_id: short.optional(),
      notes: z.string().max(6000).default(""),
    })
    .strict(),
  supplier: z
    .object({
      opportunity_id: uuid,
      offer_url: httpUrl,
      offer_id: short,
      sku_id: short,
      sku_description: text,
      price_cny: num,
      moq: positive.int(),
      status: z.enum(["candidate", "confirmed", "rejected"]),
      source: text,
      quoted_at: z.string().date(),
      notes: z.string().max(6000).default(""),
    })
    .strict(),
  measurement: z
    .object({
      supplier_id: uuid,
      packaging_version: short,
      weight_kg: positive,
      length_cm: positive,
      width_cm: positive,
      height_cm: positive,
      units_per_parcel: positive.int(),
      basis: z.enum(["measured", "supplier"]),
      recorded_at: z.string().date(),
      source: text,
      photo_artifact_id: uuid.optional(),
    })
    .strict(),
  rate_card: z
    .object({
      name: short,
      currency: z.enum(["CNY", "USD"]),
      destination: short,
      valid_from: z.string().date(),
      valid_until: z.string().date(),
      source: text,
      weight_mode: z.enum(["actual", "max_actual_volumetric"]),
      volumetric_divisor: positive.optional(),
      billing_increment_kg: positive,
      minimum_billable_kg: num,
      max_actual_kg: positive,
      max_billable_kg: positive,
      max_side_cm: positive,
      package_eligibility_confirmed: z.boolean(),
      pricing: z.union([
        z.object({ type: z.literal("per_kg"), amount_per_kg: num }).strict(),
        z
          .object({
            type: z.literal("first_then_increment"),
            first_weight_kg: positive,
            first_amount: num,
            additional_weight_kg: positive,
            additional_amount: num,
          })
          .strict(),
      ]),
      surcharges: z
        .object({
          fixed_per_parcel: num,
          fuel_rate: num.max(1),
          fuel_basis: z.enum(["base_freight", "base_plus_fixed"]),
        })
        .strict(),
    })
    .strict()
    .refine((v) => v.valid_until >= v.valid_from, "有效期结束须不早于开始"),
  experiment: z
    .object({
      opportunity_id: uuid.optional(),
      job_id: uuid.optional(),
      title: short,
      hypothesis: text,
      script: text,
      metric: short,
      target: short,
      owner: short,
      status: z.enum(["planned", "running", "completed", "cancelled"]),
      result: z.string().max(12000).default(""),
    })
    .strict(),
  action: z
    .object({
      opportunity_id: uuid.optional(),
      job_id: uuid.optional(),
      title: short,
      owner: short,
      due_at: z.string().date().optional(),
      status: z.enum(["open", "doing", "done", "cancelled"]),
      evidence: text,
      notes: z.string().max(12000).default(""),
    })
    .strict(),
  economics: z
    .object({
      title: short,
      opportunity_id: uuid,
      supplier_id: uuid,
      measurement_id: uuid,
      rate_card_id: uuid,
      input: z.record(z.string(), z.unknown()),
    })
    .strict(),
};
export async function validateRecord(c, kind, data) {
  const schema = RecordSchemas[kind];
  requireThat(schema, "unknown_record_kind");
  const v = schema.parse(data);
  if (kind === "opportunity")
    requireThat(
      v.platform === "amazon" ? v.product_url && v.market : v.tk_url,
      "candidate_url_missing",
    );
  const links = {
    opportunity_id: "opportunity",
    supplier_id: "supplier",
    measurement_id: "measurement",
    rate_card_id: "rate_card",
    report_id: "report",
  };
  const found = {};
  for (const [field, target] of Object.entries(links))
    if (v[field]) {
      const r = (
        await c.query("SELECT * FROM records WHERE id=$1 AND kind=$2", [
          v[field],
          target,
        ])
      ).rows[0];
      requireThat(r, "linked_record_not_found", 404);
      found[field] = r;
    }
  if (v.job_id)
    requireThat(
      (await c.query("SELECT 1 FROM jobs WHERE id=$1", [v.job_id])).rowCount,
      "job_not_found",
      404,
    );
  if (v.photo_artifact_id)
    requireThat(
      (
        await c.query(
          "SELECT 1 FROM artifacts WHERE id=$1 AND mime IN('image/png','image/jpeg','image/webp')",
          [v.photo_artifact_id],
        )
      ).rowCount,
      "photo_not_found",
      404,
    );
  if (kind === "supplier") {
    const url = new URL(v.offer_url);
    requireThat(
      url.hostname === "detail.1688.com" &&
        url.pathname === `/offer/${v.offer_id}.html` &&
        /^\d+$/.test(v.offer_id),
      "invalid_1688_offer_url",
    );
  }
  if (kind === "economics") {
    const s = found.supplier_id.data,
      m = found.measurement_id.data,
      r = found.rate_card_id.data;
    requireThat(
      s.opportunity_id === v.opportunity_id && m.supplier_id === v.supplier_id,
      "economics_identity_mismatch",
    );
    const input = {
      ...v.input,
      case_id: v.input.case_id || id(),
      supply: {
        item_id: v.opportunity_id,
        tk_product_id: found.opportunity_id.data.product_id,
        offer_id: s.offer_id,
        sku_id: s.sku_id,
        match_status: s.status === "confirmed" ? "confirmed" : "candidate",
        confirmation_source: s.source,
      },
      shipping: { mode: "rate_card", parcel: m, rate_card: r },
    };
    // Purchase costs must be explicit, so a new supplier price never silently rewrites an approved scenario.
    requireThat(
      input.costs?.find((x) => x.category === "procurement"),
      "procurement_cost_required",
    );
    return {
      ...v,
      input,
      result: calculateEconomics(input),
      dependencies: Object.fromEntries(
        Object.entries(found).map(([k, row]) => [
          k,
          { id: row.id, version: row.version },
        ]),
      ),
    };
  }
  return v;
}
export function installRecords(app, db) {
  app.post("/api/supply/batches", { preHandler: app.user }, async (req) => {
    const input = z
      .object({
        title: short,
        tk_urls: z.array(z.string().trim().min(1).max(2000)).min(1).max(200),
      })
      .strict()
      .parse(req.body);
    const items = normalizeTikTokLinks(input.tk_urls);
    return db.tenant(req.workspace, async (c) => {
      const data = {
        title: input.title,
        items,
        status: "waiting_manual_or_api",
        created_at: new Date().toISOString(),
        notice: "只解析 TK 链接身份；1688 自动检索待平台完成文档与权限接入。",
      };
      const row = (
        await c.query(
          "INSERT INTO records(id,workspace_id,kind,data,created_by) VALUES($1,$2,'source_batch',$3,$4) RETURNING *",
          [id(), req.workspace, data, req.identity.id],
        )
      ).rows[0];
      await c.query(
        "INSERT INTO tenant_audit(workspace_id,actor_id,action,target_id,summary) VALUES($1,$2,'supply.batch',$3,$4)",
        [
          req.workspace,
          req.identity.id,
          row.id,
          {
            count: items.length,
            parsed: items.filter((x) => x.product_id).length,
          },
        ],
      );
      return row;
    });
  });
  app.get("/api/records", { preHandler: app.user }, async (req) =>
    db.tenant(req.workspace, async (c) => {
      const kind = z
        .enum([...Object.keys(RecordSchemas), "report", "source_batch"])
        .parse(req.query.kind);
      const limit = z.coerce
        .number()
        .int()
        .min(1)
        .max(200)
        .default(100)
        .parse(req.query.limit);
      const offset = z.coerce
        .number()
        .int()
        .min(0)
        .default(0)
        .parse(req.query.offset);
      const rows = await c.query(
        "SELECT r.*,j.kind AS job_kind FROM records r LEFT JOIN jobs j ON j.id::text=r.data->>'job_id' WHERE r.kind=$1 AND ($4::text[] IS NULL OR COALESCE(r.data->>'research_kind',j.kind,'scouting')=ANY($4)) AND ($5::text IS NULL OR COALESCE(r.data->>'platform',j.request->>'platform','tiktok')=$5) ORDER BY r.updated_at DESC LIMIT $2 OFFSET $3",
        [
          kind,
          limit,
          offset,
          kind === "report" ? researchKinds(req.query.research_scope) : null,
          z.enum(["tiktok", "amazon"]).optional().parse(req.query.platform) ||
            null,
        ],
      );
      return {
        items: rows.rows.map(({ job_kind, ...record }) =>
          kind === "report" &&
          SPECIALIST_KINDS.includes(record.data.research_kind || job_kind)
            ? { ...record, data: specialistResultPresentation(record.data) }
            : record,
        ),
      };
    }),
  );
  app.get("/api/records/:id", { preHandler: app.user }, async (req) =>
    db.tenant(req.workspace, async (c) => {
      const row = (
        await c.query(
          "SELECT r.*,j.kind AS job_kind FROM records r LEFT JOIN jobs j ON j.id::text=r.data->>'job_id' WHERE r.id=$1",
          [uuid.parse(req.params.id)],
        )
      ).rows[0];
      requireThat(row, "record_not_found", 404);
      const { job_kind, ...record } = row;
      return record.kind === "report" &&
        SPECIALIST_KINDS.includes(record.data.research_kind || job_kind)
        ? { ...record, data: specialistResultPresentation(record.data) }
        : record;
    }),
  );
  app.post("/api/records", { preHandler: app.user }, async (req) =>
    db.tenant(req.workspace, async (c) => {
      const { kind, data } = z
        .object({ kind: z.string(), data: z.record(z.string(), z.unknown()) })
        .strict()
        .parse(req.body);
      const validated = await validateRecord(c, kind, data);
      const row = (
        await c.query(
          "INSERT INTO records(id,workspace_id,kind,data,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *",
          [id(), req.workspace, kind, validated, req.identity.id],
        )
      ).rows[0];
      await c.query(
        "INSERT INTO tenant_audit(workspace_id,actor_id,action,target_id) VALUES($1,$2,$3,$4)",
        [req.workspace, req.identity.id, "record.create", row.id],
      );
      return row;
    }),
  );
  app.put("/api/records/:id", { preHandler: app.user }, async (req) =>
    db.tenant(req.workspace, async (c) => {
      const input = z
        .object({
          version: z.number().int().positive(),
          data: z.record(z.string(), z.unknown()),
        })
        .strict()
        .parse(req.body);
      const old = (
        await c.query("SELECT * FROM records WHERE id=$1 FOR UPDATE", [
          uuid.parse(req.params.id),
        ])
      ).rows[0];
      requireThat(old, "record_not_found", 404);
      requireThat(
        old.version === input.version,
        "record_version_conflict",
        409,
      );
      requireThat(
        !["measurement", "economics", "report"].includes(old.kind),
        "record_is_immutable",
        409,
      );
      const data = await validateRecord(c, old.kind, input.data);
      const row = (
        await c.query(
          "UPDATE records SET data=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
          [old.id, data],
        )
      ).rows[0];
      await c.query(
        "INSERT INTO tenant_audit(workspace_id,actor_id,action,target_id,summary) VALUES($1,$2,$3,$4,$5)",
        [
          req.workspace,
          req.identity.id,
          "record.update",
          old.id,
          { version: row.version },
        ],
      );
      return row;
    }),
  );
  app.post("/api/economics/preview", { preHandler: app.user }, async (req) => {
    try {
      return calculateEconomics(req.body);
    } catch {
      throw new (await import("../common/core.mjs")).AppError(
        "economics_input_invalid",
      );
    }
  });
}
