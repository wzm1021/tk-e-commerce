// Pure, dependency-free v1 rules. No network, credentials, or implicit scheduling.
export const RULE_VERSION = 1;
const DAY = 86400000;
const number = (v) =>
  typeof v === "number" &&
  Number.isFinite(v) &&
  v >= 0 &&
  v <= Number.MAX_SAFE_INTEGER;
const ident = (v) => typeof v === "string" && /^\d{1,40}$/.test(v);
const canonical = (v) =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, x[k]]),
        )
      : x,
  );
const date = (s) =>
  typeof s === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  Number.isFinite(Date.parse(s)) &&
  new Date(s).toISOString().slice(0, 10) === s;
const day = (s, n) =>
  new Date(Date.parse(s) + n * DAY).toISOString().slice(0, 10);
const rounded = (v) => Math.round(v * 100) / 100;

export function collectionPlan(seller_id) {
  if (!ident(seller_id)) throw new Error("invalid_seller_id");
  return [
    { name: "shop_base_info", arguments: { filter: { seller_id } } },
    {
      name: "shop_data_trends",
      arguments: { filter: { seller_id, time_range_days: 28 } },
    },
    {
      name: "shop_product_analysis",
      arguments: {
        filter: { seller_id, time_range_days: 7 },
        orderby: [{ field: "day7_gmv", order: "desc" }],
        page: 1,
        pagesize: 10,
      },
    },
  ];
}

export function normalizeSnapshot(sources, config, asOf) {
  const snapshot = {
    rule_version: RULE_VERSION,
    seller_id: config.seller_id,
    market: config.market,
    shop_name: null,
    currency: null,
    identity_valid: false,
    captured_at: asOf,
    source_updated_at: null,
    source_timezone: null,
    window: null,
    products: null,
    sources: {},
    issues: [],
  };
  const plan = collectionPlan(config.seller_id);
  function read(name) {
    const expected = plan.find((x) => x.name === name);
    const matches = [...sources.entries()].filter(
      ([, e]) =>
        e?.source === "FastMoss" &&
        e.tool === name &&
        !e.result?.isError &&
        canonical(e.request) === canonical(expected.arguments),
    );
    // More than one successful call is ambiguous; never silently pick a response.
    if (matches.length !== 1) {
      snapshot.issues.push(`${name}：缺少唯一有效证据`);
      return null;
    }
    const [id, e] = matches[0];
    const age = Date.parse(asOf) - Date.parse(e.captured_at);
    if (!Number.isFinite(age) || age < -300000 || age > 2 * DAY) {
      snapshot.issues.push(`${name}：采集快照过旧或时间无效`);
      return null;
    }
    const candidates = (e.decoded || [])
      .map((x, i) => ({ value: x.data, path: `/decoded/${i}/data` }))
      .filter((x) => x.value && typeof x.value === "object" && x.value.shop);
    if (candidates.length !== 1) {
      snapshot.issues.push(`${name}：响应结构不匹配`);
      return null;
    }
    const { value: d, path } = candidates[0];
    if (
      d.shop.seller_id !== config.seller_id ||
      d.shop.region !== config.market
    ) {
      snapshot.issues.push(`${name}：店铺身份或市场不匹配`);
      return null;
    }
    snapshot.sources[name] = {
      invocation_id: id,
      captured_at: new Date(e.captured_at).toISOString(),
      path,
    };
    return d;
  }
  const base = read("shop_base_info");
  if (
    !base ||
    !/^[A-Z]{3}$/.test(base.shop.currency_code || "") ||
    typeof base.shop.shop_name !== "string"
  ) {
    snapshot.issues.push("基础身份未核验，本轮不生成业务事件");
    return snapshot;
  }
  Object.assign(snapshot, {
    identity_valid: true,
    shop_name: base.shop.shop_name.slice(0, 300),
    currency: base.shop.currency_code,
    source_updated_at:
      typeof base.shop.snapshot_at === "string"
        ? base.shop.snapshot_at.slice(0, 100)
        : null,
  });
  const trend = read("shop_data_trends");
  if (trend) {
    const rows = trend.daily_trend;
    if (
      trend.shop.currency_code !== snapshot.currency ||
      !Array.isArray(rows) ||
      !rows.length ||
      rows.some((x) => !x || !date(x.date)) ||
      new Set(rows.map((x) => x.date)).size !== rows.length
    ) {
      snapshot.issues.push("日趋势币种、日期或响应结构异常");
    } else {
      const cutoff = day(asOf.slice(0, 10), -2);
      const end = rows
        .map((x) => x.date)
        .filter((x) => x <= cutoff)
        .sort()
        .at(-1);
      if (!end || end < day(cutoff, -3))
        snapshot.issues.push("日趋势数据截止日过旧");
      else {
        const selected = Array.from({ length: 14 }, (_, i) =>
          rows.find((x) => x.date === day(end, i - 13)),
        );
        if (
          selected.some(
            (x) => !x || !number(x.daily_gmv) || !number(x.daily_units_sold),
          )
        )
          snapshot.issues.push("比较窗口存在缺日或无效指标，不补零");
        else {
          const sum = (items, key) =>
            rounded(items.reduce((n, x) => n + x[key], 0));
          snapshot.window = {
            start: day(end, -6),
            end,
            previous_start: day(end, -13),
            previous_end: day(end, -7),
            current_gmv: sum(selected.slice(7), "daily_gmv"),
            previous_gmv: sum(selected.slice(0, 7), "daily_gmv"),
            current_units: sum(selected.slice(7), "daily_units_sold"),
            previous_units: sum(selected.slice(0, 7), "daily_units_sold"),
          };
          if (
            Object.entries(snapshot.window).some(
              ([key, value]) =>
                /^(current|previous)_(gmv|units)$/.test(key) && !number(value),
            )
          ) {
            snapshot.window = null;
            snapshot.issues.push("日趋势汇总超出安全数值范围");
          }
        }
      }
    }
  }
  const products = read("shop_product_analysis");
  if (products) {
    const rows = products.products?.list;
    if (
      !Array.isArray(rows) ||
      !rows.length ||
      rows.length > 10 ||
      rows.some(
        (x) =>
          !x ||
          !ident(x.product?.product_id) ||
          typeof x.product?.title !== "string" ||
          x.performance_summary?.selected_window_days !== 7,
      ) ||
      new Set(rows.map((x) => x.product.product_id)).size !== rows.length
    )
      snapshot.issues.push("商品榜字段或统计窗不匹配");
    else
      snapshot.products = rows.map((x, i) => ({
        product_id: x.product.product_id,
        title: x.product.title.slice(0, 300),
        rank: i + 1,
      }));
  }
  return snapshot;
}

// State only advances on valid data with a newer cutoff. A failed run cannot clear alerts.
export function inspectChanges(snapshot, prior = {}, rules = {}) {
  const state = structuredClone(prior);
  state.metrics ||= {};
  state.seen_products ||= [];
  const events = [];
  if (!snapshot.identity_valid) return { events, state };
  const compatible = !state.currency || state.currency === snapshot.currency;
  if (!compatible)
    return {
      events,
      state,
      warning: "店铺币种变化，暂停比较；请重新建立监控基线",
    };
  state.currency = snapshot.currency;
  const w = snapshot.window;
  if (w) {
    for (const metric of ["gmv", "units"]) {
      const old = state.metrics[metric];
      if (old?.end && w.end <= old.end) continue;
      const current = w[`current_${metric}`],
        previous = w[`previous_${metric}`];
      const delta = rounded(current - previous),
        percent = previous === 0 ? null : rounded((delta / previous) * 100);
      const threshold =
        metric === "gmv"
          ? (rules.gmv_absolute ?? 1000)
          : (rules.units_absolute ?? 100);
      const direction =
        Math.abs(delta) >= threshold &&
        (percent === null || Math.abs(percent) >= (rules.percent ?? 30))
          ? Math.sign(delta)
          : 0;
      const same = old?.direction === direction && direction !== 0;
      const consecutive = same && day(old.end, 1) === w.end;
      const count = consecutive ? old.count + 1 : direction ? 1 : 0;
      const active = same && old.active;
      // First valid window seeds state and cannot alert, even if confirm_days=1.
      const trigger =
        !!old && direction && !active && count >= (rules.confirm_days ?? 2);
      state.metrics[metric] = {
        end: w.end,
        direction,
        count,
        active: Boolean(active || trigger),
      };
      if (trigger) {
        const source = snapshot.sources.shop_data_trends;
        const unit = metric === "gmv" ? snapshot.currency : "件";
        events.push({
          key: `v1:${metric}:${direction}:${w.end}`,
          kind: metric,
          entity_id: snapshot.seller_id,
          title: `${metric === "gmv" ? "GMV" : "销量"}${direction > 0 ? "增长" : "下降"}超过阈值`,
          body: `${w.start} 至 ${w.end}：${current} ${unit}；前 7 日 ${previous} ${unit}，变化 ${delta} ${unit}${percent === null ? "（基期为零，不计算增幅）" : `（${percent}%）`}。`,
          evidence_ids: [source.invocation_id],
          paths: [source.path + "/daily_trend"],
          facts: {
            ...w,
            metric,
            currency: snapshot.currency,
            delta,
            percent,
            confirmations: count,
            formula: "(current - previous) / previous * 100",
            source_timezone: null,
          },
        });
      }
    }
  }
  if (
    snapshot.products &&
    (!state.products_captured_at ||
      snapshot.sources.shop_product_analysis.captured_at >
        state.products_captured_at)
  ) {
    const seen = new Set(state.seen_products);
    for (const item of snapshot.products) {
      if (state.products_initialized && !seen.has(item.product_id)) {
        const source = snapshot.sources.shop_product_analysis;
        events.push({
          key: `v1:product:${item.product_id}`,
          kind: "product",
          entity_id: item.product_id,
          title: "首次观察到进入商品前 10",
          body: `${item.title}，本次排名第 ${item.rank}；不代表新品或全店上新。`,
          evidence_ids: [source.invocation_id],
          paths: [source.path + `/products/list/${item.rank - 1}/product`],
          facts: item,
        });
      }
      seen.add(item.product_id);
    }
    state.seen_products = [...seen];
    state.products_initialized = true;
    state.products_captured_at =
      snapshot.sources.shop_product_analysis.captured_at;
  }
  return { events, state };
}

export function inspectionResult(snapshot, inspection) {
  const limitations = [
    ...snapshot.issues,
    "FastMoss 来源报告值；源时区未知，趋势保守排除最近两个 UTC 日期。",
    "商品仅监测近 7 日 GMV 榜前 10；不据此判断上新、下架或缺货。",
  ];
  if (inspection.warning) limitations.push(inspection.warning);
  return {
    status:
      snapshot.issues.length || inspection.warning ? "partial" : "complete",
    summary: !snapshot.identity_valid
      ? "身份核验未通过，本轮保留问题记录。"
      : inspection.events.length
        ? `巡检发现 ${inspection.events.length} 项变化。`
        : "巡检已完成，本轮没有新增变化事件；首次有效数据用于建立基线。",
    sections: inspection.events.length
      ? inspection.events.map((x) => ({
          title: x.title,
          body: x.body,
          kind: "observed",
          evidence_ids: x.evidence_ids,
        }))
      : [
          {
            title: "巡检记录",
            body: snapshot.window
              ? `日趋势覆盖 ${snapshot.window.previous_start} 至 ${snapshot.window.end}；已按规则检查。`
              : "有效日趋势比较窗口尚不可用。",
            kind: "observed",
            evidence_ids: Object.values(snapshot.sources).map(
              (x) => x.invocation_id,
            ),
          },
        ],
    candidates: [],
    questions: [],
    limitations,
    next_actions: inspection.events.length
      ? [
          {
            title: "进入竞店研究",
            reason: "核对变化原因、商品贡献与内容线索。",
          },
        ]
      : [],
  };
}
