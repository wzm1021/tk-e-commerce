import { scoutingProductFacts } from "./scouting-facts.mjs";
import { PRICE_UNIT_WARNING } from "./product-price.mjs";

export const SCOUTING_POLICY =
  "策略 A 是市场机会：同类市场体量、在售商家数、贡献利润率和评价；单品或店铺累计 GMV 不能代替市场规模。策略 B 是新竞品机会：观察窗内上架、最近完整 7 天订单严格超过门槛、完整 14 天日订单的后 7 天总量增加且斜率为正。销量不是订单，佣金率不是利润率。缺失或口径不明必须待核验。";
export const usesSelectionRules = (request) =>
  typeof request?.selection_rules === "string";
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const unknown = (label, reason) => ({ label, status: "unverified", reason });
const statusOf = (criteria) =>
  criteria.some((c) => c.status === "failed")
    ? "failed"
    : criteria.every((c) => c.status === "passed")
      ? "passed"
      : "unverified";
const labels = { passed: "通过", failed: "未通过", unverified: "待核验" };
const candidatePoolTools = new Set([
  "product_search",
  "product_rank_new_listed",
  "product_rank_top_selling",
]);

function sourcedUrl(value, kind) {
  if (typeof value !== "string" || value.length > 300000) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (kind === "tiktok" && !/(^|\.)tiktok\.com$/i.test(url.hostname))
      return null;
    return value;
  } catch {
    return null;
  }
}

function evidence(invocationId, pointer, value, metric) {
  return {
    invocation_id: invocationId,
    pointer,
    value,
    metric,
    unit: "source value",
    period_start: null,
    period_end: null,
    timezone: null,
  };
}

// A candidate pool is a research queue, not a claim that every hard gate
// passed. Preserve source-backed products as watch candidates when the model
// omits them merely because order, seller, or unit-economics evidence is absent.
export function ensureScoutingCandidates(result, request, sources) {
  const target = Math.min(200, Number(request.candidate_count || 5));
  if (result.candidates.length >= target) return result;
  const candidates = [...result.candidates],
    seen = new Set(candidates.map((item) => String(item.product_id)));
  const ordered = [...sources.entries()].sort(
    ([aId, a], [bId, b]) =>
      String(a.captured_at || "").localeCompare(String(b.captured_at || "")) ||
      aId.localeCompare(bId),
  );
  for (const [invocationId, envelope] of ordered) {
    if (
      envelope.source !== "FastMoss" ||
      !candidatePoolTools.has(envelope.tool)
    )
      continue;
    for (const [decodedIndex, decoded] of (envelope.decoded || []).entries()) {
      const rows = decoded.data?.list;
      if (!Array.isArray(rows)) continue;
      for (const [rowIndex, row] of rows.entries()) {
        const nested = row?.product && typeof row.product === "object";
        const product = nested ? row.product : row;
        if (!product || typeof product !== "object" || product.is_off_shelf)
          continue;
        if (
          product.region &&
          request.market &&
          String(product.region).toUpperCase() !==
            String(request.market).toUpperCase()
        )
          continue;
        const originalId = product.product_id,
          originalTitle = product.title;
        if (
          !["string", "number"].includes(typeof originalId) ||
          typeof originalTitle !== "string" ||
          !originalTitle.trim()
        )
          continue;
        const productId = String(originalId);
        if (!productId || productId.length > 300 || seen.has(productId))
          continue;
        const base = `/decoded/${decodedIndex}/data/list/${rowIndex}${nested ? "/product" : ""}`;
        const itemEvidence = [
          evidence(
            invocationId,
            `${base}/product_id`,
            originalId,
            "product_id",
          ),
          evidence(
            invocationId,
            `${base}/title`,
            originalTitle,
            "product_title",
          ),
        ];
        if (Object.hasOwn(product, "launch_time"))
          itemEvidence.push(
            evidence(
              invocationId,
              `${base}/launch_time`,
              product.launch_time,
              "launch_time",
            ),
          );
        candidates.push({
          product_id: productId,
          title: originalTitle.trim().slice(0, 300),
          tk_url: sourcedUrl(
            product.tiktok_product_url || product.detail_url,
            "tiktok",
          ),
          image: sourcedUrl(product.cover_url, "image"),
          strategy_a: "unverified",
          strategy_b: "unverified",
          decision: "watch",
          reason:
            "来自已归档 FastMoss 商品榜或搜索结果；已保存候选资料，尚未完成模型分析。",
          evidence: itemEvidence,
          limitations: [
            "候选身份和标题已有来源，仍需结合用户规则完成机会分析和测试建议。",
          ],
        });
        seen.add(productId);
        if (candidates.length >= target)
          return { ...result, candidates, status: "partial" };
      }
    }
  }
  return { ...result, candidates };
}

// Endpoint field names are deliberately explicit. Unverified endpoint contracts cannot pass a gate.
export function assessCandidate(candidate, request, sources, asOf) {
  const facts = scoutingProductFacts(candidate, sources, request.market);
  const rating = facts.product_rating;
  const ratingRule =
    rating && finite(rating.value) && rating.value >= 0 && rating.value <= 5
      ? {
          label: "商品评价",
          status: rating.value >= request.minimum_rating ? "passed" : "failed",
          reason: `来源评分 ${rating.value}，门槛 ≥ ${request.minimum_rating}`,
          evidence: rating,
        }
      : unknown("商品评价", "缺少可核验的评分字段");
  const start = Date.parse(asOf) - request.lookback_days * 86400000;
  const launch = facts.launch_time;
  const launchMs =
    launch && Number.isSafeInteger(launch.value) && launch.value > 0
      ? launch.value * 1000
      : NaN;
  const launchRule =
    Number.isFinite(launchMs) && launchMs <= Date.parse(asOf)
      ? {
          label: "上架观察窗",
          status: launchMs >= start ? "passed" : "failed",
          reason: `上架 ${new Date(launchMs).toISOString()}；按任务截点回看 ${request.lookback_days} 天（UTC）`,
          evidence: launch,
        }
      : unknown("上架观察窗", "上架时间缺失、无效或晚于研究截点");
  const A = [
    unknown(
      "同类市场体量",
      "须有明确市场范围和周期；单品累计 GMV 不能代替市场体量",
    ),
    unknown("在售商家数量", "须核验同类竞品集合及去重商家数"),
    unknown(
      "贡献利润率",
      "须关联已确认 SKU、包装测样、运价和完整费用，不能使用佣金率代替",
    ),
    ratingRule,
  ];
  const B = [
    launchRule,
    unknown(
      "最近 7 天订单",
      `需完整周期真实订单严格大于 ${request.minimum_orders_7d}；累计销量或 7 天销量不能代替订单`,
    ),
    unknown(
      "14 天日订单上升趋势",
      "需完整日订单序列核验近 7 天总量增长及正斜率",
    ),
  ];
  const a = statusOf(A),
    b = statusOf(B),
    selected = request.strategies.map((k) => (k === "A" ? a : b));
  return {
    policy_version: 1,
    as_of: asOf,
    facts,
    A: { label: "市场机会", status: a, criteria: A },
    B: { label: "新竞品机会", status: b, criteria: B },
    decision: selected.some((s) => s === "passed")
      ? "shortlist"
      : selected.every((s) => s === "failed")
        ? "reject"
        : "watch",
  };
}

export function applyScoutingPolicy(result, request, sources, asOf) {
  if (usesSelectionRules(request)) {
    const candidates = result.candidates.map((candidate) => {
      const facts = scoutingProductFacts(candidate, sources, request.market);
      // Recommendation belongs to the model. Only extract source-backed facts;
      // preferences and missing metrics never become deterministic pass/fail gates.
      const {
        strategy_a,
        strategy_b,
        proposed_strategy_a,
        proposed_strategy_b,
        assessment_summary,
        ...analysis
      } = candidate;
      return {
        ...analysis,
        limitations: [
          ...new Set([
            ...(analysis.limitations || []),
            ...(facts.unverified_floor_price ? [PRICE_UNIT_WARNING] : []),
          ]),
        ],
        assessment: {
          policy_version: 2,
          mode: "user_rules",
          as_of: asOf,
          facts,
        },
        rating: finite(facts.product_rating?.value)
          ? facts.product_rating.value
          : null,
        price: finite(facts.floor_price?.value)
          ? facts.floor_price.value
          : null,
        price_max: facts.ceiling_price?.value ?? null,
        price_currency: facts.currency_code?.value ?? null,
      };
    });
    return {
      ...result,
      analysis_mode: "user_rules",
      candidates,
      status:
        result.status === "waiting_input"
          ? "waiting_input"
          : result.status === "complete" &&
              !result.recovery &&
              candidates.length >= Number(request.candidate_count || 5)
            ? "complete"
            : "partial",
    };
  }
  const modelDraft = result.model_draft ?? {
    status: result.status,
    summary: result.summary,
    sections: result.sections,
    questions: result.questions,
    next_actions: result.next_actions,
    limitations: result.limitations,
    candidates: result.candidates.map((c) => ({
      product_id: c.product_id,
      reason: c.reason,
      strategy_a: c.strategy_a,
      strategy_b: c.strategy_b,
      decision: c.decision,
    })),
  };
  const candidates = result.candidates.map((candidate) => {
    const assessment = assessCandidate(candidate, request, sources, asOf);
    return {
      ...candidate,
      proposed_strategy_a:
        candidate.proposed_strategy_a ?? candidate.strategy_a,
      proposed_strategy_b:
        candidate.proposed_strategy_b ?? candidate.strategy_b,
      strategy_a: assessment.A.status,
      strategy_b: assessment.B.status,
      decision: assessment.decision,
      assessment,
      rating: finite(assessment.facts.product_rating?.value)
        ? assessment.facts.product_rating.value
        : null,
      price: finite(assessment.facts.floor_price?.value)
        ? assessment.facts.floor_price.value
        : null,
      price_max: assessment.facts.ceiling_price?.value ?? null,
      price_currency: assessment.facts.currency_code?.value ?? null,
      reason:
        modelDraft.candidates.find((x) => x.product_id === candidate.product_id)
          ?.reason || candidate.reason,
      assessment_summary: [assessment.A, assessment.B]
        .map(
          (s) =>
            `${s.label}：${labels[s.status]}。${s.criteria
              .filter((c) => c.status !== "passed")
              .map((c) => c.label + "：" + c.reason)
              .join("；")}`,
        )
        .join("\n"),
      limitations: [...assessment.A.criteria, ...assessment.B.criteria]
        .filter((c) => c.status === "unverified")
        .map((c) => c.reason)
        .concat("模型文字单独保留为草稿，系统不采用未核验的策略标签。")
        .concat(
          assessment.facts.unverified_floor_price ? [PRICE_UNIT_WARNING] : [],
        ),
    };
  });
  // Research completion is distinct from whether products pass investment gates.
  // Preserve explicit partial/waiting results; archived recovery is never complete.
  const complete =
    result.status === "complete" &&
    !result.recovery &&
    candidates.length >= Number(request.candidate_count || 5);
  return {
    ...result,
    status:
      result.status === "waiting_input"
        ? "waiting_input"
        : complete
          ? "complete"
          : "partial",
    candidates,
    model_draft: modelDraft,
    summary: `已收集 ${candidates.length} 个商品资料，${candidates.filter((c) => c.decision === "watch").length} 个仍待补充判定证据。策略 A 为市场机会，策略 B 为新竞品机会；程序按明确字段核验，模型文字单独供审阅。`,
    sections: [
      {
        title: "研究范围与判定口径",
        kind: "observed",
        body: `${request.market} · ${request.category} · 截点 ${asOf} · 观察窗 ${request.lookback_days} 天 · 目标 ${request.candidate_count} 个候选。\n${SCOUTING_POLICY}`,
        evidence_ids: [],
      },
      {
        title: "逐品规则核验",
        kind: "inferred",
        body:
          candidates
            .slice(0, 10)
            .map((c) => `${c.title}\n${c.reason}`)
            .join("\n\n") || "当前没有足够证据形成候选清单。",
        evidence_ids: [...sources.keys()],
      },
      {
        title: "证据边界与下一步",
        kind: "pending",
        body: "商品搜索、榜单和详情的匹配商品字段可用于基础事实核验；完整选品还需市场范围、订单周期、趋势、供货和费用证据。模型原文可能包含策略混淆或未经核验的解释，已单独保留为草稿。请按逐项规则决定后续研究。",
        evidence_ids: [],
      },
    ],
    questions:
      result.status === "waiting_input"
        ? ["请补充缺失的订单、市场或货源成本资料，或缩小研究范围。"]
        : [],
    limitations: [
      ...new Set([
        ...(result.limitations || []),
        complete
          ? "本次研究已完成；商品是否通过策略仍以逐项证据核验为准。"
          : "完整策略尚未全部核验；这是阶段研究结果。",
        "市场体量、竞争范围、订单时序和贡献利润的自动判定仍待对应数据合同验证。",
      ]),
    ],
    next_actions: [
      {
        title: "补充订单与市场证据",
        reason: "按策略 A / B 补齐缺失条件，区分销量与订单、单品与市场口径。",
      },
      {
        title: "确认货源和样品成本",
        reason: "货源、包装、运价及未知费用齐备后再计算贡献利润。",
      },
    ],
  };
}
