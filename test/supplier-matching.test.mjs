import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareBatch } from '../skills/tiktok-supplier-matching/scripts/prepare_batch.mjs';

function product() {
  return { item_id: 'item-1', tk_product_id: '9007199254740993', tk_sku_id: 'sku-a',
    region: 'US', images: ['https://example.invalid/product.jpg'], target_spec_confirmed: true };
}
function candidate() {
  return { offer_id: '9007199254740994', sku_id: 'supply-sku-a', offer_url: 'https://example.invalid/offer',
    title: '虚构测试商品', comparisons: ['sale_unit', 'material', 'dimensions', 'included_accessories'].map(field => ({
      field, tk_value: '测试值', supplier_value: '测试值', result: 'match', evidence: '离线测试记录' })) };
}
function batch() {
  return { schema_version: 1, products: [product()], supplier_results: [{ item_id: 'item-1',
    provider: 'test-only', fetched_at: '2026-09-05T00:00:00Z', status: 'ok', candidates: [candidate()] }] };
}

test('只有TK链接也能准备任务，不编造ID、图片或货源', () => {
  const result = prepareBatch({ schema_version: 1, products: ['https://example.invalid/tk-short-link'] });
  assert.equal(result.execution, 'offline_preparation');
  assert.equal(result.items[0].status, 'needs_product_details');
  assert.equal(result.items[0].tk_product_id, null);
  assert.deepEqual(result.items[0].candidates, []);
});

test('已准备商品但无供应商结果，标记待接入而非未命中', () => {
  const result = prepareBatch({ schema_version: 1, products: [product()] });
  assert.equal(result.items[0].status, 'awaiting_supplier_access');
  assert.equal(result.items[0].tk_product_id, '9007199254740993');
});

test('同身份记录完全一致才去重，不同SKU分别保留', () => {
  const p = product();
  const result = prepareBatch({ schema_version: 1, products: [p, structuredClone(p)] });
  assert.equal(result.item_count, 1); assert.equal(result.duplicate_count, 1);
  const another = { ...p, item_id: 'item-2', tk_sku_id: 'sku-b' };
  assert.equal(prepareBatch({ schema_version: 1, products: [p, another] }).item_count, 2);
  assert.throws(() => prepareBatch({ schema_version: 1, products: [p, { ...p, title: '冲突信息' }] }), /合并/);
});

test('接口失败与真实空结果保持不同状态', () => {
  const input = batch(); input.supplier_results[0].candidates = [];
  input.supplier_results[0].status = 'no_match';
  assert.equal(prepareBatch(input).items[0].status, 'no_match');
  input.supplier_results[0].status = 'error'; input.supplier_results[0].error_code = 'AUTH_REQUIRED';
  assert.equal(prepareBatch(input).items[0].status, 'supplier_error');
});

test('图搜命中和全部规格相符仍需人工确认', () => {
  const input = batch();
  assert.equal(prepareBatch(input).items[0].status, 'pending_review');
  input.supplier_results[0].candidates[0].confirmation = { status: 'confirmed', source: '测试用户确认记录' };
  const result = prepareBatch(input);
  assert.equal(result.items[0].status, 'has_confirmed_candidate');
  assert.equal(result.items[0].candidates[0].offer_id, '9007199254740994');
});

test('规格冲突剔除，不能被确认记录覆盖', () => {
  const input = batch(); const c = input.supplier_results[0].candidates[0];
  c.comparisons[0].result = 'conflict';
  assert.equal(prepareBatch(input).items[0].status, 'all_candidates_rejected');
  c.confirmation = { status: 'confirmed', source: '错误的测试确认' };
  assert.throws(() => prepareBatch(input), /规格冲突/);
});

test('确认供应SKU需要关键项覆盖、目标规格和确认来源', () => {
  for (const change of [
    i => { i.supplier_results[0].candidates[0].comparisons.pop(); },
    i => { i.products[0].target_spec_confirmed = false; },
    i => { i.supplier_results[0].candidates[0].sku_id = null; },
    i => { i.supplier_results[0].candidates[0].confirmation.source = null; },
  ]) {
    const input = batch();
    input.supplier_results[0].candidates[0].confirmation = { status: 'confirmed', source: '测试人工确认' };
    change(input); assert.throws(() => prepareBatch(input));
  }
});

test('重复候选、数值型大ID、未知任务结果与伪造成功空数组均报错', () => {
  let input = batch(); input.supplier_results[0].candidates.push(candidate());
  assert.throws(() => prepareBatch(input), /重复/);
  input = batch(); input.products[0].tk_product_id = 9007199254740992;
  assert.throws(() => prepareBatch(input), /字符串/);
  input = batch(); input.supplier_results[0].item_id = 'unknown';
  assert.throws(() => prepareBatch(input), /未知/);
  input = batch(); input.supplier_results[0].candidates = [];
  assert.throws(() => prepareBatch(input), /应含候选/);
});
