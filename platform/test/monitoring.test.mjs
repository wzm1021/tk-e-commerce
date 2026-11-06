import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Ajv from "ajv";
import {
  collectionPlan,
  normalizeSnapshot,
  inspectChanges,
  inspectionResult,
} from "../src/monitoring/engine.mjs";
import {
  MonitorInput,
  MonitorConfig,
  checkMonthlyBudget,
} from "../src/monitoring/contract.mjs";
import { ResultSchema } from "../src/reports/reports.mjs";
import { executeInspection } from "../src/agent/monitor-runner.mjs";
import { monitorSources, monitorConfig } from "./fixtures/monitoring.mjs";
const asOf = "2026-09-19T12:00:00.000Z";
const snapshot = (when = asOf, products) =>
  normalizeSnapshot(monitorSources(when, products), monitorConfig, when);
const trend = (sources) =>
  [...sources.values()].find((x) => x.tool === "shop_data_trends").decoded[0]
    .data;
const rules = {
  percent: 30,
  gmv_absolute: 1000,
  units_absolute: 100,
  confirm_days: 2,
};

test("monitor collection plan validates against actual tool schema and preserves 64-bit IDs", async () => {
  const { tools } = JSON.parse(
    await readFile(
      new URL("../../schemas/fastmoss-tools.snapshot.json", import.meta.url),
    ),
  );
  const ajv = new Ajv({ strict: false });
  for (const call of collectionPlan(monitorConfig.seller_id)) {
    const validate = ajv.compile(
      tools.find((x) => x.name === call.name).inputSchema,
    );
    assert.equal(
      validate(call.arguments),
      true,
      JSON.stringify(validate.errors),
    );
    assert.equal(call.arguments.filter.seller_id, monitorConfig.seller_id);
  }
  assert.throws(
    () => collectionPlan(Number(monitorConfig.seller_id)),
    /invalid_seller/,
  );
});

test("normalization builds complete equal nonoverlapping windows with provenance", () => {
  const s = snapshot();
  assert.deepEqual(s.issues, []);
  assert.equal(s.identity_valid, true);
  assert.equal(s.source_timezone, null);
  assert.deepEqual(s.window, {
    start: "2026-09-11",
    end: "2026-09-17",
    previous_start: "2026-09-04",
    previous_end: "2026-09-10",
    current_gmv: 2100,
    previous_gmv: 700,
    current_units: 210,
    previous_units: 70,
  });
  assert.equal(s.products[0].product_id, "7494419524321642201");
  assert.match(s.sources.shop_data_trends.path, /^\/decoded\/0\/data$/);
});

test("missing/duplicate days, invalid values, old captures and currency mismatches never become zero", () => {
  for (const mutate of [
    (s) => trend(s).daily_trend.splice(20, 1),
    (s) => trend(s).daily_trend.push({ ...trend(s).daily_trend.at(-1) }),
    (s) => {
      trend(s).daily_trend.at(-1).daily_gmv = null;
    },
    (s) => {
      trend(s).daily_trend.at(-1).daily_units_sold = -5;
    },
    (s) => {
      trend(s).daily_trend[20] = null;
    },
    (s) => {
      trend(s).daily_trend.at(-1).daily_gmv = 1e308;
    },
    (s) => {
      trend(s).shop.currency_code = "EUR";
    },
    (s) => {
      for (const e of s.values()) e.captured_at = "2026-09-01T00:00:00Z";
    },
  ]) {
    const sources = structuredClone(monitorSources());
    mutate(sources);
    const s = normalizeSnapshot(sources, monitorConfig, asOf);
    assert.equal(s.window, null);
    assert.ok(s.issues.length);
  }
});

test("identity mismatch, error envelopes and changed arguments reject evidence", () => {
  for (const mutate of [
    (e) => {
      e.decoded[0].data.shop.seller_id = "99";
    },
    (e) => {
      e.decoded[0].data.shop.region = "TH";
    },
    (e) => {
      e.result.isError = true;
    },
    (e) => {
      e.request.filter.seller_id = "99";
    },
    (e) => {
      e.source = "other";
    },
  ]) {
    const sources = monitorSources();
    mutate([...sources.values()][0]);
    const s = normalizeSnapshot(sources, monitorConfig, asOf);
    assert.equal(s.identity_valid, false);
    assert.equal(inspectChanges(s).events.length, 0);
  }
});

test("first round is a baseline; same-day polling does not count as confirmation", () => {
  const a = inspectChanges(snapshot(), {}, rules);
  assert.equal(a.events.length, 0);
  const same = inspectChanges(snapshot(), a.state, rules);
  assert.equal(same.events.length, 0);
  assert.equal(same.state.metrics.gmv.count, 1);
  const next = inspectChanges(
    snapshot("2026-09-20T12:00:00.000Z"),
    same.state,
    rules,
  );
  assert.equal(next.events.length, 2);
  assert.equal(next.events[0].facts.percent, 200);
  const continued = inspectChanges(
    snapshot("2026-09-21T12:00:00.000Z"),
    next.state,
    rules,
  );
  assert.equal(continued.events.length, 0);
});

test("missing rounds do not confirm consecutive days; valid recovery rearms a new episode", () => {
  const a = inspectChanges(snapshot(), {}, rules);
  const gap = inspectChanges(
    snapshot("2026-09-21T12:00:00.000Z"),
    a.state,
    rules,
  );
  assert.equal(gap.events.length, 0);
  const b = inspectChanges(
    snapshot("2026-09-22T12:00:00.000Z"),
    gap.state,
    rules,
  );
  assert.equal(b.events.length, 2);
  const recovered = snapshot("2026-09-23T12:00:00.000Z");
  recovered.window.current_gmv = recovered.window.previous_gmv;
  const r = inspectChanges(recovered, b.state, rules);
  assert.equal(r.state.metrics.gmv.active, false);
  const c = inspectChanges(
    snapshot("2026-09-24T12:00:00.000Z"),
    r.state,
    rules,
  );
  const d = inspectChanges(
    snapshot("2026-09-25T12:00:00.000Z"),
    c.state,
    rules,
  );
  assert.equal(d.events.length, 1);
  assert.equal(d.events[0].kind, "gmv");
});

test("zero base gives absolute change and null rate; absolute and percent gates both apply", () => {
  const a = inspectChanges(snapshot(), {}, { ...rules, confirm_days: 1 });
  const b = snapshot("2026-09-20T12:00:00.000Z");
  b.window.previous_gmv = 0;
  const out = inspectChanges(b, a.state, { ...rules, confirm_days: 1 });
  assert.equal(out.events[0].facts.percent, null);
  assert.equal(
    inspectChanges(b, a.state, {
      ...rules,
      gmv_absolute: 3000,
      units_absolute: 3000,
    }).events.length,
    0,
  );
});

test("first-observed products deduplicate forever; disappearance and empty pages do not mean delisting", () => {
  const a = inspectChanges(snapshot(), {}, rules);
  const b = inspectChanges(
    snapshot("2026-09-20T12:00:00.000Z", ["2"]),
    a.state,
    rules,
  );
  assert.equal(b.events.filter((x) => x.kind === "product").length, 1);
  const c = inspectChanges(
    snapshot("2026-09-21T12:00:00.000Z", ["7494419524321642201", "2"]),
    b.state,
    rules,
  );
  assert.equal(c.events.length, 0);
  assert.equal(snapshot(asOf, []).products, null);
});

test("threshold edits/config errors and strict monthly budgets are validated", () => {
  const c = MonitorConfig.parse({});
  assert.equal(
    MonitorInput.parse({ ...monitorConfig, name: "测试" }).config.data_budget,
    3,
  );
  assert.throws(() => MonitorConfig.parse({ data_budget: 2 }));
  assert.throws(() => MonitorConfig.parse({ interval_hours: 168 }));
  assert.throws(
    () => checkMonthlyBudget(c, { model: "30000000", data: "0" }),
    /monitor_monthly_model_budget/,
  );
  assert.throws(
    () => checkMonthlyBudget(c, { model: "0", data: "971" }),
    /monitor_monthly_data_budget/,
  );
  assert.doesNotThrow(() =>
    checkMonthlyBudget(c, { model: "29000000", data: "970" }),
  );
});

test("runner buys at most three calls, skips AI on baseline, and retains facts if AI fails", async () => {
  const request = {
    ...monitorConfig,
    config: MonitorConfig.parse({}),
    previous_state: {},
  };
  let calls = 0,
    models = 0;
  const result = await executeInspection(
    { request },
    {
      now: () => asOf,
      callData: async (call) => {
        calls++;
        return [...monitorSources().values()].find((x) => x.tool === call.name);
      },
      explain: async () => {
        models++;
      },
    },
  );
  ResultSchema.parse(result);
  assert.equal(calls, 3);
  assert.equal(models, 0);
  request.previous_state = inspectChanges(snapshot(), {}, rules).state;
  const when = "2026-09-20T12:00:00.000Z";
  const changed = await executeInspection(
    { request },
    {
      now: () => when,
      callData: async (call) =>
        [...monitorSources(when).values()].find((x) => x.tool === call.name),
      explain: async () => {
        models++;
        throw new Error("model unavailable");
      },
    },
  );
  ResultSchema.parse(changed);
  assert.equal(changed.sections.length, 2);
  assert.equal(models, 1);
  assert.ok(changed.limitations.some((x) => x.includes("AI")));
});

test("invalid identity stops data purchasing and returns a partial evidence result", async () => {
  let calls = 0;
  const result = await executeInspection(
    { request: { ...monitorConfig, config: MonitorConfig.parse({}) } },
    {
      now: () => asOf,
      callData: async () => {
        calls++;
        throw new Error("unavailable");
      },
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.status, "partial");
  ResultSchema.parse(result);
  ResultSchema.parse(inspectionResult(snapshot(), inspectChanges(snapshot())));
});
