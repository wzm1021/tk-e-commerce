import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateEconomics, calculateEconomicsBatch, quoteShipping } from '../skills/tiktok-unit-economics/scripts/calculate.mjs';

const fixture = JSON.parse(readFileSync(new URL('../skills/tiktok-unit-economics/assets/example.json', import.meta.url)));
const example = () => structuredClone(fixture);
const context = input => ({ as_of: input.as_of, market: input.market, units_per_order: input.sales.units_per_order });

test('完整虚构方案：换币、体积重、6%平台费和贡献利润可对账', () => {
  const result = calculateEconomics(example());
  assert.equal(result.status, 'calculated');
  assert.equal(result.result_kind, 'estimated_contribution');
  assert.equal(result.shipping.billable_weight_kg, 0.5);
  assert.equal(result.shipping.amount_base, 4.9);
  assert.equal(result.platform_fee.amount, 1.5);
  assert.equal(result.total_costs_per_order, 14.12);
  assert.equal(result.contribution_profit_per_order, 10.88);
  assert.ok(Math.abs(result.contribution_margin - 0.4352) < 1e-12);
  assert.ok(result.assumptions.some(x => x.includes('尚未样品实测')));
});

test('体积重正好在0.3kg时不多进位，略超临界值进到0.4kg', () => {
  const input = example();
  Object.assign(input.shipping.parcel, { weight_kg: 0.2, length_cm: 10, width_cm: 10, height_cm: 18 });
  assert.equal(quoteShipping(input.shipping, context(input)).billable_weight_kg, 0.3);
  input.shipping.parcel.height_cm = 18.1;
  assert.equal(quoteShipping(input.shipping, context(input)).billable_weight_kg, 0.4);
});

test('测样后实际重更大，重新进位并更新利润，保留初筛方案', () => {
  const original = example();
  const measured = example();
  Object.assign(measured.shipping.parcel, { weight_kg: 0.501, basis: 'measured', source: '测试实测记录' });
  const result = calculateEconomics(measured);
  assert.equal(result.shipping.billable_weight_kg, 0.6);
  assert.equal(result.contribution_profit_per_order, 10.04);
  assert.equal(result.measurement_basis, 'measured');
  assert.equal(original.shipping.parcel.basis, 'supplier');
});

test('只计实重和最低计重均使用各自报价规则', () => {
  const input = example();
  input.shipping.rate_card.weight_mode = 'actual';
  assert.equal(quoteShipping(input.shipping, context(input)).billable_weight_kg, 0.4);
  input.shipping.rate_card.minimum_billable_kg = 1;
  assert.equal(quoteShipping(input.shipping, context(input)).billable_weight_kg, 1);
});

test('首续重、燃油基数及固定附加费分别计算', () => {
  const input = example();
  input.shipping.parcel.weight_kg = 0.501;
  input.shipping.rate_card.pricing = { type: 'first_then_increment', first_weight_kg: 0.5,
    first_amount: 10, additional_weight_kg: 0.1, additional_amount: 2 };
  input.shipping.rate_card.surcharges = { fixed_per_parcel: 5, fuel_rate: 0.1, fuel_basis: 'base_plus_fixed' };
  const quote = quoteShipping(input.shipping, context(input));
  assert.equal(quote.base_freight, 12);
  assert.ok(Math.abs(quote.fuel_surcharge - 1.7) < 1e-12);
  assert.equal(quote.amount, 18.7);
  input.shipping.rate_card.surcharges.fuel_basis = 'base_freight';
  assert.equal(quoteShipping(input.shipping, context(input)).amount, 18.2);
});

test('重量档位右闭、超档不外推', () => {
  const input = example();
  input.shipping.rate_card.pricing = { type: 'bands', bands: [{ up_to_kg: 0.5, amount: 10 }, { up_to_kg: 1, amount: 20 }] };
  assert.equal(quoteShipping(input.shipping, context(input)).base_freight, 10);
  input.shipping.parcel.weight_kg = 0.501;
  assert.equal(quoteShipping(input.shipping, context(input)).base_freight, 20);
  input.shipping.parcel.weight_kg = 1.001;
  assert.equal(calculateEconomics(input).status, 'incomplete');
});

test('未知成本和漏项不被当成零，明确排除项保留范围', () => {
  const input = example();
  const advertising = input.costs.find(c => c.category === 'advertising');
  advertising.status = 'unknown'; advertising.amount = null;
  const incomplete = calculateEconomics(input);
  assert.equal(incomplete.status, 'incomplete');
  assert.equal(incomplete.contribution_margin, null);
  assert.equal(incomplete.total_costs_per_order, null);
  advertising.status = 'excluded'; advertising.source = '测试中用户明确只算广告费前贡献';
  const excluded = calculateEconomics(input);
  assert.equal(excluded.status, 'calculated_with_exclusions');
  assert.equal(excluded.contribution_profit_per_order, 12.88);
  assert.equal(excluded.exclusions[0].category, 'advertising');
  input.costs.pop();
  assert.ok(calculateEconomics(input).blockers.some(x => x.includes('other')));
});

test('缺少跨币种汇率时不产生利润', () => {
  const input = example(); input.fx_rates = [];
  const result = calculateEconomics(input);
  assert.equal(result.status, 'incomplete');
  assert.equal(result.contribution_profit_per_order, null);
  assert.ok(result.blockers.some(x => x.includes('汇率')));
});

for (const [name, edit] of [
  ['过期报价', i => { i.shipping.rate_card.valid_until = '2026-09-04'; }],
  ['目的国错配', i => { i.shipping.rate_card.destination = 'UK'; }],
  ['超实际重', i => { i.shipping.parcel.weight_kg = 2.001; }],
  ['超边长', i => { i.shipping.parcel.length_cm = 60.1; }],
  ['未确认线路适用性', i => { i.shipping.rate_card.package_eligibility_confirmed = false; }],
  ['包装重量精度超限', i => { i.shipping.parcel.weight_kg = 0.3201; }],
  ['包内销售单元数不符', i => { i.sales.units_per_order = 2; }],
]) {
  test(`${name}：停止完整测算`, () => {
    const input = example(); edit(input);
    const result = calculateEconomics(input);
    assert.equal(result.status, 'incomplete');
    assert.equal(result.contribution_margin, null);
    assert.ok(result.blockers.some(x => x.startsWith('shipping:')));
  });
}

test('多销售单元按采购单位换算，包裹不能凭空同比放大', () => {
  const input = example();
  input.sales.units_per_order = 2; input.shipping.parcel.units_per_parcel = 2;
  input.shipping.parcel.source = '两销售单元真实包裹的测试测量';
  const result = calculateEconomics(input);
  assert.equal(result.line_items.find(c => c.category === 'procurement').amount_base, 5.6);
  assert.equal(result.contribution_profit_per_order, 8.08);
  assert.equal(result.contribution_profit_per_sale_unit, 4.04);
});

test('平台费支持买家运费收入与明确的扣费基数', () => {
  const input = example(); input.sales.buyer_shipping_revenue = 5;
  assert.equal(calculateEconomics(input).platform_fee.amount, 1.5);
  input.platform_fee.basis = 'total_revenue';
  assert.equal(calculateEconomics(input).platform_fee.amount, 1.8);
  input.platform_fee = { rate: 0.06, basis: 'custom', custom_base: 20 };
  assert.equal(calculateEconomics(input).platform_fee.amount, 1.2);
});

test('手工每单总运费支持明确的头程/尾程分摊', () => {
  const input = example();
  input.shipping = { mode: 'manual', amount: 9, currency: 'USD', basis: 'per_order',
    source: '测试报价：含头程分摊和尾程，无重复费用', quoted_at: '2026-09-01', valid_until: '2026-09-30' };
  const result = calculateEconomics(input);
  assert.equal(result.status, 'calculated');
  assert.equal(result.contribution_profit_per_order, 6.78);
});

test('错误输入不被容错成合法业务数字', () => {
  let input = example(); input.costs.push(structuredClone(input.costs[0]));
  assert.throws(() => calculateEconomics(input), /重复成本/);
  input = example(); input.costs[0].amount = -1;
  assert.throws(() => calculateEconomics(input), /非负/);
  input = example(); input.sales.item_revenue = 0;
  assert.throws(() => calculateEconomics(input), /正有限/);
  input = example(); input.platform_fee.rate = 6;
  assert.throws(() => calculateEconomics(input), /小数/);
  input = example(); input.supply.offer_id = 9007199254740992;
  assert.throws(() => calculateEconomics(input), /不能为空/);
});

test('负利润原样呈现，未确认货源不会被改成已确认', () => {
  const input = example(); input.sales.item_revenue = 1;
  const result = calculateEconomics(input);
  assert.ok(result.contribution_profit_per_order < 0);
  assert.equal(result.match_status, 'candidate');
  assert.ok(result.assumptions.some(x => x.includes('货源')));
});

test('批量中缺失费用与错误输入独立报告，其他商品仍可计算', () => {
  const good = example();
  const missing = example(); missing.case_id = 'missing'; missing.costs[0].status = 'unknown';
  const invalid = example(); invalid.case_id = 'invalid'; invalid.sales.item_revenue = 0;
  const result = calculateEconomicsBatch({ schema_version: 1, cases: [good, missing, invalid] });
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.status_counts, { calculated: 1, incomplete: 1, invalid_input: 1 });
  assert.equal(result.results[0].contribution_profit_per_order, 10.88);
  assert.equal(result.results[1].contribution_margin, null);
  assert.equal(result.results[2].case_index, 2);
  assert.throws(() => calculateEconomicsBatch({ schema_version: 1, cases: [good, good] }), /重复/);
});
