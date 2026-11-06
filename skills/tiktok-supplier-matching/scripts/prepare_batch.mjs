import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
function text(value, label) {
  assert(typeof value === 'string' && value.trim(), `${label} 必须为非空字符串`);
  return value.trim();
}
function webUrl(value, label) {
  const parsed = new URL(text(value, label));
  assert(['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password,
    `${label} 必须是无嵌入凭据的 HTTP(S) URL`);
  parsed.hash = '';
  return parsed.href;
}
function optionalId(value, label) {
  return value == null ? null : text(value, label);
}

// This is an offline handoff format. No network requests, API keys, or invented
// supplier results. An eventual authorized provider maps its output to this format.
export function prepareBatch(input) {
  assert(input?.schema_version === 1 && Array.isArray(input.products), '需要 schema_version=1 和 products 数组');
  const rows = [];
  const identities = new Set();
  const itemIds = new Set();
  let duplicates = 0;
  for (const raw of input.products) {
    const product = typeof raw === 'string' ? { tk_url: raw } : raw;
    assert(product && typeof product === 'object', '无效的 TK 商品记录');
    const tkUrl = product.tk_url == null ? null : webUrl(product.tk_url, 'tk_url');
    const productId = optionalId(product.tk_product_id, 'tk_product_id');
    const skuId = optionalId(product.tk_sku_id, 'tk_sku_id');
    assert(tkUrl || productId, '至少提供 TK 链接或商品 ID');
    const region = product.region == null ? null : text(product.region, 'region');
    const identity = JSON.stringify([region, productId ?? tkUrl, skuId]);
    // Duplicate identity with conflicting enrichment must be resolved explicitly.
    if (identities.has(identity)) {
      const existing = rows.find(row => row.identity === identity);
      assert(JSON.stringify(existing.original) === JSON.stringify(product),
        '同一商品/SKU 出现不同信息，请先合并并保留来源，不能静默覆盖');
      duplicates++;
      continue;
    }
    const itemId = product.item_id == null
      ? `tk-${createHash('sha256').update(identity).digest('hex').slice(0, 16)}`
      : text(product.item_id, 'item_id');
    assert(!itemIds.has(itemId), 'item_id 重复但商品身份不同');
    identities.add(identity); itemIds.add(itemId);
    assert(product.images == null || Array.isArray(product.images), 'images 必须为数组');
    const images = [...new Set((product.images ?? []).map(url => webUrl(url, 'image URL')))];
    const requiredComparisons = product.required_comparisons ?? ['sale_unit', 'material', 'dimensions', 'included_accessories'];
    assert(Array.isArray(requiredComparisons) && requiredComparisons.length > 0
      && requiredComparisons.every(field => typeof field === 'string' && field.trim()), 'required_comparisons 必须为非空字段列表');
    rows.push({ identity, original: product, item_id: itemId, tk_url: tkUrl,
      tk_product_id: productId, tk_sku_id: skuId, region,
      title: product.title ?? null, images, attributes: product.attributes ?? {},
      chinese_queries: product.chinese_queries ?? [], evidence: product.evidence ?? [],
      required_comparisons: [...new Set(requiredComparisons)],
      target_spec_confirmed: product.target_spec_confirmed === true });
  }
  const results = new Map();
  assert(input.supplier_results == null || Array.isArray(input.supplier_results), 'supplier_results 必须为数组');
  for (const result of input.supplier_results ?? []) {
    assert(itemIds.has(result.item_id), `结果指向未知 item_id: ${result.item_id}`);
    assert(!results.has(result.item_id), '同一个 item_id 的供应商结果需先合并');
    assert(['ok', 'no_match', 'error'].includes(result.status), '无效的供应商结果状态');
    text(result.provider, 'provider'); text(result.fetched_at, 'fetched_at');
    assert(!Number.isNaN(Date.parse(result.fetched_at)), 'fetched_at 必须为有效日期时间');
    assert(Array.isArray(result.candidates), 'candidates 必须为数组');
    assert(result.status === 'ok' ? result.candidates.length > 0 : result.candidates.length === 0,
      'ok 结果应含候选；no_match/error 应为空候选');
    if (result.status === 'error') text(result.error_code, 'error_code');
    results.set(result.item_id, result);
  }
  const items = rows.map(({ identity, original, ...row }) => {
    const result = results.get(row.item_id);
    const tasks = [];
    if (!row.tk_product_id || !row.region || row.images.length === 0) {
      tasks.push('通过 FastMoss 或用户资料补齐商品 ID、市场和主图；图片不可得时记录限制');
    }
    if (!row.target_spec_confirmed) tasks.push('确认 TK 目标销售规格、材质、配件与套装数量');
    const candidates = [];
    const candidateIds = new Set();
    for (const candidate of result?.candidates ?? []) {
      const offerId = text(candidate.offer_id, 'offer_id');
      const skuId = optionalId(candidate.sku_id, 'sku_id');
      const key = JSON.stringify([offerId, skuId]);
      assert(!candidateIds.has(key), '同一 offer/SKU 重复，需合并查询证据');
      candidateIds.add(key);
      const offerUrl = webUrl(candidate.offer_url, 'offer_url');
      text(candidate.title, 'candidate.title');
      assert(Array.isArray(candidate.comparisons), 'comparisons 必须为数组');
      for (const comparison of candidate.comparisons) {
        text(comparison.field, 'comparison.field');
        assert(['match', 'conflict', 'unknown'].includes(comparison.result), '无效的规格比较结果');
        text(comparison.evidence, 'comparison.evidence');
      }
      const conflict = candidate.comparisons.some(c => c.result === 'conflict');
      const unknown = candidate.comparisons.some(c => c.result === 'unknown')
        || row.required_comparisons.some(field => !candidate.comparisons.some(c => c.field === field && c.result === 'match'));
      const confirmed = candidate.confirmation?.status === 'confirmed';
      if (confirmed) {
        text(candidate.confirmation.source, 'confirmation.source');
        assert(row.target_spec_confirmed && skuId && !conflict && !unknown,
          '确认货源需要目标规格已确认、具体供应 SKU、完整比较且无规格冲突');
      }
      const status = conflict ? 'rejected_spec_conflict' : confirmed ? 'confirmed' : 'pending_review';
      candidates.push({ ...candidate, offer_id: offerId, sku_id: skuId, offer_url: offerUrl,
        match_status: status, provider: result.provider, fetched_at: result.fetched_at });
    }
    let status;
    if (!result) {
      status = tasks.some(t => t.startsWith('通过 FastMoss')) ? 'needs_product_details' : 'awaiting_supplier_access';
      tasks.push('待接入已授权的 1688 图搜/详情数据通道，或导入真实候选结果');
    } else if (result.status === 'error') {
      status = 'supplier_error'; tasks.push(`供应商查询失败: ${result.error_code}`);
    } else if (result.status === 'no_match') {
      status = 'no_match'; tasks.push('本次查询未命中；记录搜索范围，必要时换图/补关键词');
    } else if (candidates.some(c => c.match_status === 'confirmed')) {
      status = 'has_confirmed_candidate'; tasks.push('选择采购数量与具体报价，创建利润测算并安排测样');
    } else if (candidates.every(c => c.match_status === 'rejected_spec_conflict')) {
      status = 'all_candidates_rejected'; tasks.push('当前候选均有规格冲突，需要重新找货');
    } else {
      status = 'pending_review'; tasks.push('人工复核候选规格、采购单位和包装信息，再选择买样货源');
    }
    return { ...row, status, provider_status: result?.status ?? 'not_connected',
      search_plan: { image_urls: row.images.slice(0, 2), keywords: row.chinese_queries },
      candidates, manual_tasks: tasks };
  });
  return { schema_version: 1, execution: 'offline_preparation',
    input_count: input.products.length, duplicate_count: duplicates, item_count: items.length,
    status_counts: items.reduce((counts, row) => {
      counts[row.status] = (counts[row.status] ?? 0) + 1; return counts;
    }, {}), items };
}

async function main() {
  const [file, ...extra] = process.argv.slice(2);
  assert(file && extra.length === 0, '用法: node prepare_batch.mjs <batch.json>');
  process.stdout.write(JSON.stringify(prepareBatch(JSON.parse(await readFile(file, 'utf8'))), null, 2) + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write(JSON.stringify({ status: 'invalid_input', error: error.message }) + '\n');
    process.exitCode = 1;
  });
}
