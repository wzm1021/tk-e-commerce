import { z } from "zod";
import { id, uuid, digest, requireThat } from "../common/core.mjs";
import { assertWorkspaceAccess } from "../accounts/account-policy.mjs";
import { finalizeJob } from "../research/jobs.mjs";
import { reportMonitorCandidates } from "../monitoring/candidate-shop.mjs";
import { points } from "../common/data-points.mjs";
import { productAdvertisingEvidence } from "./product-advertising.mjs";
import { TIKTOK_CURRENCIES } from "../common/platforms.mjs";
import { productPriceWarning } from "./product-price.mjs";

export const OverviewInput = z
  .object({
    refresh_key: uuid.optional(),
    section: z
      .enum([
        "overview",
        "sales",
        "products",
        "creators",
        "videos",
        "lives",
        "product_advertising",
        "advertising",
        "sku",
      ])
      .default("overview"),
    days: z.union([z.literal(7), z.literal(28), z.literal(90)]).default(28),
    page: z.number().int().min(1).max(500).default(1),
  })
  .strict();

export function overviewPlan(target, productId, input) {
  const { section, days, page } = OverviewInput.parse(input);
  requireThat(
    typeof productId === "string" && /^\d{1,40}$/.test(productId),
    "overview_product_invalid",
  );
  requireThat(
    typeof target?.seller_id === "string" &&
      /^\d{1,40}$/.test(target.seller_id),
    "overview_shop_missing",
    409,
  );
  const shop = (name, list = false, order) => ({
    name,
    arguments: {
      filter: {
        seller_id: target.seller_id,
        ...(name === "shop_base_info" ? {} : { time_range_days: days }),
      },
      ...(list
        ? { page, pagesize: 10, orderby: [{ field: order, order: "desc" }] }
        : {}),
    },
  });
  switch (section) {
    case "overview":
      return [
        {
          name: "product_detail_info",
          arguments: { filter: { product_id: productId } },
        },
        {
          name: "product_overview",
          arguments: {
            filter: { product_id: productId, time_range_days: days },
          },
        },
        shop("shop_base_info"),
        shop("shop_data_trends"),
      ];
    case "sales":
      return [shop("shop_sale_analysis")];
    case "products":
      return [shop("shop_product_analysis", true, `day${days}_gmv`)];
    case "creators":
      return [shop("shop_creator_analysis", true, "sale_amount")];
    case "videos":
      return [shop("shop_video_analysis", true, "gmv")];
    case "lives":
      return [shop("shop_live_analysis", true, "gmv")];
    case "advertising":
      return [shop("shop_investment_analysis")];
    case "product_advertising":
      return [
        {
          name: "product_investment",
          arguments: {
            filter: { product_id: productId, time_range_days: days },
          },
        },
      ];
    case "sku":
      requireThat(days !== 90, "overview_sku_period_invalid");
      return [
        {
          name: "product_sku",
          arguments: {
            filter: { product_id: productId, time_range_days: days },
          },
        },
      ];
  }
}

// Inspect only the documented data blocks; never pass provider envelopes/configuration to the browser.
export function overviewData(envelope, call, target, productId) {
  requireThat(
    envelope.tool === call.name &&
      digest(envelope.request) === digest(call.arguments),
    "overview_source_mismatch",
  );
  const blocks =
    envelope.decoded?.filter(
      (x) => x?.data && typeof x.data === "object" && !Array.isArray(x.data),
    ) || [];
  requireThat(blocks.length === 1, "overview_data_missing");
  let data = blocks[0].data;
  const warnings = [];
  if (
    call.name === "shop_video_analysis" &&
    data.summary?.region &&
    data.summary.region !== target.market
  ) {
    data = { ...data, summary: undefined };
    warnings.push(
      "视频汇总的市场标识与店铺不一致，已隐藏汇总；仅展示市场一致的明细。",
    );
  }
  if (
    call.name === "shop_video_analysis" &&
    Array.isArray(data.videos?.items)
  ) {
    const verified = data.videos.items.filter(
      (row) => row.region === target.market,
    );
    if (verified.length !== data.videos.items.length)
      warnings.push(
        "部分视频的市场未核实，已隐藏对应明细；总条数为接口原始分页总量。",
      );
    data = { ...data, videos: { ...data.videos, items: verified } };
  }
  const seller = data.shop?.seller_id ?? data.shop?.shop_id;
  const product = data.product_id ?? data.product?.product_id;
  requireThat(
    seller == null || seller === target.seller_id,
    "overview_shop_changed",
  );
  requireThat(
    product == null || product === productId,
    "overview_source_mismatch",
  );
  if (call.name === "product_investment")
    requireThat(
      call.arguments.filter.product_id === productId &&
        [data.product_id, data.product?.product_id]
          .filter((value) => value != null)
          .every((value) => value === productId),
      "overview_source_mismatch",
    );
  const regions = [
    data.region,
    data.shop?.region,
    data.product?.region,
    data.summary?.region,
    data.creator_summary?.region,
  ].filter(Boolean);
  requireThat(
    regions.every((region) => region === target.market),
    "overview_market_mismatch",
  );
  const currency = TIKTOK_CURRENCIES[target.market];
  requireThat(
    [data.currency_code, data.shop?.currency_code, data.product?.currency_code]
      .filter(Boolean)
      .every((c) => c === currency),
    "overview_currency_mismatch",
  );
  const priceWarning = productPriceWarning(data.product, target.market);
  if (priceWarning) {
    warnings.push(priceWarning);
    data = {
      ...data,
      product: {
        ...data.product,
        floor_price: null,
        ceiling_price: null,
        price_status: "unverified",
      },
    };
  }
  return {
    data,
    ...(call.name === "product_investment"
      ? {
          advertising_evidence: productAdvertisingEvidence(
            data,
            productId,
            call.arguments.filter.time_range_days,
          ),
        }
      : {}),
    warnings,
    captured_at: envelope.captured_at,
    invocation_id: envelope.invocation_id,
  };
}

async function context(c, store, reportId, productId) {
  uuid.parse(reportId);
  const candidate = (await reportMonitorCandidates(c, store, reportId)).find(
    (x) => x.product_id === productId,
  );
  requireThat(candidate, "overview_candidate_missing", 404);
  requireThat(candidate.monitor_target, "overview_shop_missing", 409);
  return { candidate, target: candidate.monitor_target };
}

async function present(db, store, workspace, job, target, productId, plan) {
  const panels = {},
    failures = { ...(job.result?.failures || {}) };
  await db.tenant(workspace, async (c) => {
    for (const call of plan) {
      const invocation = job.result?.panels?.[call.name];
      const artifact = (
        await c.query(
          "SELECT a.* FROM invocations i JOIN artifacts a ON a.id=i.artifact_id WHERE (i.id=$1 OR ($1::uuid IS NULL AND i.job_id=$2 AND i.operation_key=$3)) AND i.state='succeeded'",
          [invocation || null, job.id, "data:" + digest(call)],
        )
      ).rows[0];
      if (!artifact) {
        if (job.status !== "running")
          failures[call.name] ||= "overview_data_missing";
        continue;
      }
      try {
        panels[call.name] = overviewData(
          JSON.parse(
            (await store.read(artifact.object_key, artifact.sha256)).toString(),
          ),
          call,
          target,
          productId,
        );
        delete failures[call.name];
      } catch (e) {
        failures[call.name] = e.code || "overview_data_missing";
      }
    }
  });
  return {
    job_id: job.id,
    status:
      job.status === "failed" && Object.keys(panels).length
        ? "partial"
        : job.status,
    target,
    product_id: productId,
    ...job.request.overview,
    panels,
    failures,
    data_points: points(job.data_spent),
    model_cost: "0",
  };
}

export async function loadCandidateOverview(
  db,
  store,
  callData,
  { workspace, actor, reportId, productId, input },
) {
  const { refresh_key, ...selection } = OverviewInput.parse(input);
  let target,
    plan,
    started = false;
  const job = await db.tenant(workspace, async (c) => {
    ({ target } = await context(c, store, reportId, productId));
    plan = overviewPlan(target, productId, selection);
    const baseKey =
      "candidate-overview:" +
      digest({ reportId, productId, target, selection });
    const key = refresh_key ? baseKey + ":" + refresh_key : baseKey;
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      workspace + baseKey,
    ]);
    const latest = (
      await c.query(
        "SELECT * FROM jobs WHERE checkpoint->>'overview_key'=$1 OR idempotency_key=$1 ORDER BY created_at DESC LIMIT 1",
        [baseKey],
      )
    ).rows[0];
    if (
      latest &&
      (!refresh_key || ["running", "reconciling"].includes(latest.status))
    )
      return latest;
    const existing = (
      await c.query("SELECT * FROM jobs WHERE idempotency_key=$1", [key])
    ).rows[0];
    if (existing) return existing;
    await assertWorkspaceAccess(c, workspace, actor);
    const data = (
      await c.query(
        `SELECT c.id,c.kind,v.id AS version_id,v.config,v.validation
      FROM workspace_connections w JOIN connections c ON c.id=w.connection_id JOIN connection_versions v ON v.id=c.active_version_id
      WHERE w.workspace_id=$1 AND w.enabled AND c.enabled AND c.kind='fastmoss' AND v.verified ORDER BY c.created_at DESC LIMIT 1`,
        [workspace],
      )
    ).rows[0];
    requireThat(data, "connection_not_ready", 409);
    const request = {
      platform: "tiktok",
      market: target.market,
      overview: selection,
    };
    const snapshot = {
      schema_version: 1,
      data,
      model: null,
      skill: null,
      form: request,
      created_at: new Date().toISOString(),
    };
    started = true;
    return (
      await c.query(
        `INSERT INTO jobs(id,workspace_id,created_by,kind,title,request,snapshot,digest,status,idempotency_key,billing_mode,auto_budget,worker_id,fence,lease_expires_at,checkpoint)
      VALUES($1,$2,$3,'competitor',$4,$5,$6,$7,'running',$8,'wallet_per_call',true,'candidate-overview',1,now()+interval '10 minutes',$9) RETURNING *`,
        [
          id(),
          workspace,
          actor,
          `数据总览 · ${target.name}`,
          request,
          snapshot,
          digest(snapshot),
          key,
          {
            supplement_kind: "candidate_overview",
            overview_key: baseKey,
            source_report_id: reportId,
            product_id: productId,
            seller_id: target.seller_id,
          },
        ],
      )
    ).rows[0];
  });
  if (!started)
    return present(db, store, workspace, job, target, productId, plan);
  const scope = {
    workspace_id: workspace,
    job_id: job.id,
    worker_id: job.worker_id,
    fence: job.fence,
    lease_bound: true,
  };
  const result = { panels: {}, failures: {} };
  for (const call of plan) {
    try {
      const saved =
        !refresh_key &&
        (await db.tenant(
          workspace,
          async (c) =>
            (
              await c.query(
                `SELECT a.* FROM records r JOIN invocations i ON i.job_id::text=r.data->>'job_id'
         JOIN artifacts a ON a.id=i.artifact_id WHERE r.id=$1 AND r.kind='report'
         AND i.operation_key=$2 AND i.state='succeeded' ORDER BY i.created_at DESC LIMIT 1`,
                [reportId, "data:" + digest(call)],
              )
            ).rows[0],
        ));
      const envelope = saved
        ? JSON.parse(
            (await store.read(saved.object_key, saved.sha256)).toString(),
          )
        : await callData(scope, call);
      overviewData(envelope, call, target, productId);
      result.panels[call.name] = envelope.invocation_id;
    } catch (e) {
      result.failures[call.name] = e.code || "overview_fetch_failed";
      // An uncertain purchase must be reconciled before another call is attempted.
      const pending = await db.tenant(
        workspace,
        async (c) =>
          (
            await c.query("SELECT data_inflight FROM jobs WHERE id=$1", [
              job.id,
            ])
          ).rows[0],
      );
      if (BigInt(pending.data_inflight) > 0n) break;
    }
    await db.tenant(workspace, (c) =>
      c.query(
        "UPDATE jobs SET result=$2,lease_expires_at=now()+interval '10 minutes',updated_at=now() WHERE id=$1 AND status='running'",
        [job.id, result],
      ),
    );
  }
  const completed = await db.tenant(workspace, async (c) => {
    const locked = (
      await c.query("SELECT * FROM jobs WHERE id=$1 FOR UPDATE", [job.id])
    ).rows[0];
    if (BigInt(locked.data_inflight) > 0n)
      return (
        await c.query(
          "UPDATE jobs SET status='reconciling',result=$2,lease_expires_at=NULL,error_code='overview_purchase_uncertain',updated_at=now() WHERE id=$1 RETURNING *",
          [job.id, result],
        )
      ).rows[0];
    const status = Object.keys(result.failures).length
      ? Object.keys(result.panels).length
        ? "partial"
        : "failed"
      : "succeeded";
    await finalizeJob(
      c,
      workspace,
      locked,
      status,
      result,
      status === "succeeded" ? null : "overview_data_incomplete",
    );
    return (await c.query("SELECT * FROM jobs WHERE id=$1", [job.id])).rows[0];
  });
  return present(db, store, workspace, completed, target, productId, plan);
}

export function installCandidateOverview(app, db, store, callData) {
  let pending = 0;
  app.post(
    "/api/reports/:id/candidates/:productId/overview",
    { preHandler: app.user },
    async (req) => {
      requireThat(pending < 8, "gateway_capacity", 429);
      pending++;
      try {
        return await loadCandidateOverview(db, store, callData, {
          workspace: req.workspace,
          actor: req.identity.id,
          reportId: req.params.id,
          productId: req.params.productId,
          input: req.body,
        });
      } finally {
        pending--;
      }
    },
  );
}
