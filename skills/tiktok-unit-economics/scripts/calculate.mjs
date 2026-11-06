import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const COST_CATEGORIES = [
  'procurement', 'domestic_shipping', 'packaging', 'fulfillment',
  'duties_taxes', 'creator_commission', 'advertising', 'returns_losses', 'other',
];

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}
function number(value, label, positive = false) {
  requireValue(typeof value === 'number' && Number.isFinite(value)
    && (positive ? value > 0 : value >= 0), `${label} 必须为${positive ? '正' : '非负'}有限数值`);
  return value;
}
function nonempty(value, label) {
  requireValue(typeof value === 'string' && value.trim().length > 0, `${label} 不能为空`);
  return value;
}
function date(value, label) {
  requireValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value, `${label} 必须为有效 YYYY-MM-DD`);
  return value;
}
function scaled(value, multiplier, label, positive = false) {
  number(value, label, positive);
  const n = Math.round(value * multiplier);
  requireValue(Number.isSafeInteger(n) && Math.abs(n / multiplier - value) < 1e-9,
    `${label} 超出支持精度或安全范围`);
  return n;
}
const grams = (value, label, positive = false) => scaled(value, 1000, label, positive);
const millimeters = (value, label) => scaled(value, 10, label, true);
const ceilDiv = (n, d) => (n + d - 1n) / d;
const maxBig = (a, b) => a > b ? a : b;

// Local pricing model, not an implementation of any carrier's API.
// Weight comparisons and billing increments use exact integer/rational arithmetic.
export function quoteShipping(shipping, context) {
  requireValue(shipping && typeof shipping === 'object', 'shipping 缺失');
  const { as_of, market, units_per_order } = context;
  date(as_of, 'as_of');
  if (shipping.mode === 'manual') {
    number(shipping.amount, 'shipping.amount');
    nonempty(shipping.currency, 'shipping.currency');
    nonempty(shipping.source, 'shipping.source');
    date(shipping.quoted_at, 'shipping.quoted_at');
    date(shipping.valid_until, 'shipping.valid_until');
    requireValue(shipping.quoted_at <= as_of && shipping.valid_until >= as_of,
      '手工运费报价不在有效期内');
    requireValue(shipping.basis === 'per_order', '手工运费必须先分摊为 per_order');
    return { mode: 'manual', amount: shipping.amount, currency: shipping.currency,
      source: shipping.source, measurement_basis: null, quoted_at: shipping.quoted_at };
  }
  requireValue(shipping.mode === 'rate_card', 'shipping.mode 仅支持 rate_card/manual');
  const parcel = shipping.parcel;
  const card = shipping.rate_card;
  requireValue(parcel && card, '需要 parcel 和 rate_card');
  requireValue(parcel.units_per_parcel === units_per_order,
    '实测包裹内销售单元数必须等于每单销售单元数；不能直接放大单件尺寸');
  requireValue(['measured', 'supplier', 'assumed'].includes(parcel.basis), '无效的包装数据来源');
  nonempty(parcel.source, 'parcel.source');
  date(parcel.recorded_at, 'parcel.recorded_at');
  requireValue(parcel.recorded_at <= as_of, '包装记录日期不能晚于测算日');
  nonempty(card.name, 'rate_card.name');
  nonempty(card.source, 'rate_card.source');
  nonempty(card.currency, 'rate_card.currency');
  requireValue(card.destination === market, '报价目的国与销售市场不一致');
  date(card.valid_from, 'rate_card.valid_from');
  date(card.valid_until, 'rate_card.valid_until');
  requireValue(card.valid_from <= as_of && card.valid_until >= as_of, '物流报价不在有效期内');
  requireValue(['actual', 'max_actual_volumetric'].includes(card.weight_mode), '不支持的计重方式');

  const actual = grams(parcel.weight_kg, 'parcel.weight_kg', true);
  const dims = ['length_cm', 'width_cm', 'height_cm'].map(k => millimeters(parcel[k], `parcel.${k}`));
  const maxActual = grams(card.max_actual_kg, 'rate_card.max_actual_kg', true);
  const maxBillable = grams(card.max_billable_kg, 'rate_card.max_billable_kg', true);
  const maxSide = millimeters(card.max_side_cm, 'rate_card.max_side_cm');
  requireValue(actual <= maxActual, '超过线路实际重量上限');
  requireValue(Math.max(...dims) <= maxSide, '超过线路单边尺寸上限');
  requireValue(card.package_eligibility_confirmed === true,
    '需要确认其他尺寸、周长、货物属性及目的地区域适用条件');
  const increment = grams(card.billing_increment_kg, 'rate_card.billing_increment_kg', true);
  const minimum = grams(card.minimum_billable_kg, 'rate_card.minimum_billable_kg');
  let numerator = BigInt(actual);
  let denominator = 1n;
  let volumetricKg = null;
  if (card.weight_mode === 'max_actual_volumetric') {
    requireValue(Number.isSafeInteger(card.volumetric_divisor) && card.volumetric_divisor > 0,
      '体积系数必须为正整数，单位 cm³/kg');
    denominator = BigInt(card.volumetric_divisor);
    const volumeMm3 = dims.reduce((a, n) => a * BigInt(n), 1n);
    // mm³ / (cm³/kg) has the same numerical value as grams.
    numerator = maxBig(BigInt(actual) * denominator, volumeMm3);
    volumetricKg = Number(volumeMm3) / Number(denominator) / 1000;
  }
  numerator = maxBig(numerator, BigInt(minimum) * denominator);
  const billedBig = ceilDiv(numerator, denominator * BigInt(increment)) * BigInt(increment);
  requireValue(billedBig <= BigInt(maxBillable), '进位后超过线路计费重量上限');
  const billed = Number(billedBig);
  const pricing = card.pricing;
  requireValue(pricing && typeof pricing === 'object', '缺少运价规则');
  let base;
  if (pricing.type === 'per_kg') {
    base = billed / 1000 * number(pricing.amount_per_kg, 'amount_per_kg');
  } else if (pricing.type === 'first_then_increment') {
    const first = grams(pricing.first_weight_kg, 'first_weight_kg', true);
    const additional = grams(pricing.additional_weight_kg, 'additional_weight_kg', true);
    const steps = Number(ceilDiv(BigInt(Math.max(0, billed - first)), BigInt(additional)));
    base = number(pricing.first_amount, 'first_amount')
      + steps * number(pricing.additional_amount, 'additional_amount');
  } else if (pricing.type === 'bands') {
    requireValue(Array.isArray(pricing.bands) && pricing.bands.length > 0, '缺少重量档位');
    let previous = 0;
    let selected;
    for (const band of pricing.bands) {
      const upTo = grams(band.up_to_kg, 'band.up_to_kg', true);
      requireValue(upTo > previous, '档位必须严格递增');
      previous = upTo;
      number(band.amount, 'band.amount');
      if (selected === undefined && billed <= upTo) selected = band.amount;
    }
    requireValue(selected !== undefined, '计费重量不在报价档位覆盖内');
    base = selected;
  } else {
    throw new Error('不支持的运价规则；请按真实报价改用手工分摊运费');
  }
  const surcharges = card.surcharges;
  requireValue(surcharges && typeof surcharges === 'object', '附加费需要明确填写，包括确认为零的费用');
  const fixed = number(surcharges.fixed_per_parcel, 'fixed_per_parcel');
  const fuelRate = number(surcharges.fuel_rate, 'fuel_rate');
  requireValue(['base_freight', 'base_plus_fixed'].includes(surcharges.fuel_basis), '无效的燃油费基数');
  const fuel = (base + (surcharges.fuel_basis === 'base_plus_fixed' ? fixed : 0)) * fuelRate;
  const amount = base + fixed + fuel;
  number(amount, 'shipping.amount');
  return { mode: 'rate_card', amount, currency: card.currency, source: card.source,
    rate_card: card.name, measurement_basis: parcel.basis, actual_weight_kg: actual / 1000,
    volumetric_weight_kg: volumetricKg, billable_weight_kg: billed / 1000,
    base_freight: base, fixed_surcharge: fixed, fuel_surcharge: fuel };
}

export function calculateEconomics(input) {
  requireValue(input?.schema_version === 1, 'schema_version 必须为 1');
  nonempty(input.case_id, 'case_id');
  nonempty(input.market, 'market');
  nonempty(input.base_currency, 'base_currency');
  date(input.as_of, 'as_of');
  const precision = input.currency_decimals ?? 2;
  requireValue(Number.isInteger(precision) && precision >= 0 && precision <= 4, 'currency_decimals 范围为 0–4');
  const factor = 10 ** precision;
  const money = n => {
    requireValue(Number.isFinite(n) && Math.abs(n * factor) < Number.MAX_SAFE_INTEGER,
      '金额超出计算范围');
    return Math.round((n + Math.sign(n) * Number.EPSILON) * factor) / factor;
  };
  const blockers = [];
  const assumptions = [];
  const exclusions = [];
  const lineItems = [];
  const sales = input.sales ?? {};
  const units = sales.units_per_order;
  requireValue(Number.isSafeInteger(units) && units > 0, 'sales.units_per_order 必须为正整数');
  number(sales.item_revenue, 'sales.item_revenue', true);
  number(sales.buyer_shipping_revenue, 'sales.buyer_shipping_revenue');
  const revenue = money(sales.item_revenue + sales.buyer_shipping_revenue);
  const fee = input.platform_fee ?? {};
  const feeRate = fee.rate ?? 0.06;
  const feeBasis = fee.basis ?? 'item_revenue';
  number(feeRate, 'platform_fee.rate');
  requireValue(feeRate <= 1, '费率用小数，例如 6% 填 0.06');
  requireValue(['item_revenue', 'total_revenue', 'custom'].includes(feeBasis), '无效的平台扣费基数');
  if (fee.rate == null) assumptions.push('平台扣点使用用户约定默认值 6%，未核验平台政策');
  if (fee.basis == null) assumptions.push('平台扣费基数暂按商品成交收入，不含买家运费');
  const feeBase = feeBasis === 'custom' ? number(fee.custom_base, 'platform_fee.custom_base')
    : feeBasis === 'total_revenue' ? revenue : sales.item_revenue;
  const platformFee = money(feeBase * feeRate);

  const rates = new Map();
  requireValue(Array.isArray(input.fx_rates), 'fx_rates 必须为数组，同币种可为空');
  for (const fx of input.fx_rates) {
    nonempty(fx.currency, 'fx.currency');
    requireValue(!rates.has(fx.currency) && fx.currency !== input.base_currency, '汇率币种重复或重复定义基准币种');
    number(fx.rate_to_base, 'fx.rate_to_base', true);
    date(fx.as_of, 'fx.as_of');
    requireValue(fx.as_of <= input.as_of, '汇率日期晚于测算日期');
    nonempty(fx.source, 'fx.source');
    rates.set(fx.currency, fx);
  }
  const convert = (amount, currency) => {
    if (currency === input.base_currency) return money(amount);
    const fx = rates.get(currency);
    requireValue(fx, `缺少 ${currency} → ${input.base_currency} 汇率`);
    return money(amount * fx.rate_to_base);
  };
  requireValue(Array.isArray(input.costs), 'costs 必须为数组');
  const seen = new Set();
  for (const cost of input.costs) {
    requireValue(COST_CATEGORIES.includes(cost.category), `未知成本类目 ${cost.category}`);
    requireValue(!seen.has(cost.category), `重复成本类目 ${cost.category}`);
    seen.add(cost.category);
    requireValue(['confirmed', 'estimated', 'unknown', 'not_applicable', 'excluded'].includes(cost.status), '无效的成本状态');
    if (cost.status === 'unknown') {
      blockers.push(`${cost.category}: 成本待补`);
      continue;
    }
    nonempty(cost.source, `${cost.category}.source`);
    if (cost.status === 'excluded') {
      exclusions.push({ category: cost.category, reason: cost.source });
      continue;
    }
    if (cost.status === 'not_applicable') {
      requireValue(cost.amount === 0, '不适用费用必须明确为零');
      lineItems.push({ category: cost.category, status: cost.status, amount_base: 0, source: cost.source });
      continue;
    }
    requireValue(['per_order', 'per_sale_unit'].includes(cost.basis), '成本 basis 仅支持 per_order/per_sale_unit');
    number(cost.amount, `${cost.category}.amount`);
    nonempty(cost.currency, `${cost.category}.currency`);
    try {
      const original = cost.amount * (cost.basis === 'per_sale_unit' ? units : 1);
      lineItems.push({ ...cost, amount_base: convert(original, cost.currency) });
    } catch (error) { blockers.push(`${cost.category}: ${error.message}`); }
  }
  for (const category of COST_CATEGORIES) {
    if (!seen.has(category)) blockers.push(`${category}: 未声明成本状态`);
  }
  let shipping = null;
  try {
    shipping = quoteShipping(input.shipping, { as_of: input.as_of, market: input.market, units_per_order: units });
    shipping.amount_base = convert(shipping.amount, shipping.currency);
    lineItems.push({ category: 'shipping', amount_base: shipping.amount_base, source: shipping.source });
  } catch (error) { blockers.push(`shipping: ${error.message}`); }

  const matching = input.supply?.match_status ?? 'unresolved';
  requireValue(['unresolved', 'candidate', 'confirmed'].includes(matching), '无效的货源匹配状态');
  for (const field of ['item_id', 'tk_product_id', 'tk_sku_id', 'offer_id', 'sku_id']) {
    if (input.supply?.[field] != null) nonempty(input.supply[field], `supply.${field}`);
  }
  if (matching === 'confirmed') {
    nonempty(input.supply.confirmation_source, 'supply.confirmation_source');
    nonempty(input.supply.offer_id, 'supply.offer_id');
    nonempty(input.supply.sku_id, 'supply.sku_id');
  }
  else assumptions.push('货源与目标销售规格尚未确认，结果仅适用于所填成本假设');
  if (shipping?.measurement_basis && shipping.measurement_basis !== 'measured') {
    assumptions.push('运费使用商家标注或假设包装数据，尚未样品实测');
  }
  const knownCosts = money(lineItems.reduce((sum, item) => sum + item.amount_base, platformFee));
  const canCalculate = blockers.length === 0;
  const profit = canCalculate ? money(revenue - knownCosts) : null;
  return {
    schema_version: 1, case_id: input.case_id, as_of: input.as_of, base_currency: input.base_currency,
    status: canCalculate ? (exclusions.length ? 'calculated_with_exclusions' : 'calculated') : 'incomplete',
    result_kind: 'estimated_contribution', match_status: matching, supply: input.supply ?? null,
    measurement_basis: shipping?.measurement_basis ?? null, assumptions, exclusions, blockers,
    currency_decimals: precision, revenue_per_order: revenue, units_per_order: units,
    platform_fee: { rate: feeRate, basis: feeBasis, base: feeBase, amount: platformFee },
    fx_rates: input.fx_rates, shipping, line_items: lineItems,
    known_costs_per_order: knownCosts, total_costs_per_order: canCalculate ? knownCosts : null,
    contribution_profit_per_order: profit,
    contribution_profit_per_sale_unit: canCalculate ? money(profit / units) : null,
    contribution_margin: canCalculate ? profit / revenue : null,
  };
}

export function calculateEconomicsBatch(input) {
  requireValue(input?.schema_version === 1 && Array.isArray(input.cases), '批量输入需要 schema_version=1 和 cases 数组');
  const ids = new Set();
  for (const item of input.cases) {
    if (typeof item?.case_id === 'string' && item.case_id.trim()) {
      requireValue(!ids.has(item.case_id), `批量 case_id 重复: ${item.case_id}`);
      ids.add(item.case_id);
    }
  }
  const results = input.cases.map((item, index) => {
    try { return { case_index: index, ...calculateEconomics(item) }; }
    catch (error) {
      return { case_index: index, case_id: item?.case_id ?? null, status: 'invalid_input', error: error.message };
    }
  });
  return { schema_version: 1,
    status: results.some(r => ['incomplete', 'invalid_input'].includes(r.status)) ? 'partial' : 'completed',
    case_count: results.length,
    status_counts: results.reduce((counts, result) => {
      counts[result.status] = (counts[result.status] ?? 0) + 1; return counts;
    }, {}), results };
}

async function main() {
  const [file, ...extra] = process.argv.slice(2);
  requireValue(file && extra.length === 0, '用法: node calculate.mjs <input.json>');
  const input = JSON.parse(await readFile(file, 'utf8'));
  const result = input && Object.hasOwn(input, 'cases') ? calculateEconomicsBatch(input) : calculateEconomics(input);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (['incomplete', 'partial'].includes(result.status)) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write(JSON.stringify({ status: 'invalid_input', error: error.message }) + '\n');
    process.exitCode = 1;
  });
}
