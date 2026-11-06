import { providerFetch, readLimited } from "../infra/network.mjs";

const CANDIDATE_TOOLS = new Set([
  "product_search",
  "product_rank_new_listed",
  "product_rank_top_selling",
]);
const TOOL_PRIORITY = {
  product_rank_top_selling: 1,
  product_rank_new_listed: 1,
  product_search: 2,
  product_detail_info: 3,
};
const SINGLE_IMAGE_LIMIT = 700 * 1024;
// The HTML artifact limit is 12 MiB. The first five covers appear twice (deep
// card and catalog), so keep the downloaded binary budget below 4 MiB.
const REPORT_IMAGE_LIMIT = 4 * 1024 * 1024;

function httpsUrl(value) {
  if (typeof value !== "string" || value.length > 4000) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url
      : null;
  } catch {
    return null;
  }
}

function imageMime(bytes) {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return "image/jpeg";
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp";
  return null;
}

function sourceRows(envelope) {
  const rows = [];
  for (const [decodedIndex, decoded] of (envelope.decoded || []).entries()) {
    if (envelope.tool === "product_detail_info") {
      const product = decoded.data?.product;
      if (product && typeof product === "object")
        rows.push({
          product,
          pointer: `/decoded/${decodedIndex}/data/product/cover_url`,
        });
      continue;
    }
    if (!CANDIDATE_TOOLS.has(envelope.tool)) continue;
    for (const [rowIndex, row] of (decoded.data?.list || []).entries()) {
      const nested = row?.product && typeof row.product === "object";
      const product = nested ? row.product : row;
      if (product && typeof product === "object")
        rows.push({
          product,
          pointer: `/decoded/${decodedIndex}/data/list/${rowIndex}${nested ? "/product" : ""}/cover_url`,
        });
    }
  }
  return rows;
}

// Only URLs found in this job's archived FastMoss envelopes are eligible. The
// model-provided candidate image field is never fetched directly.
export function reportImageSources(candidates, sources) {
  const wanted = new Set(candidates.map((item) => String(item.product_id)));
  const chosen = new Map();
  for (const [invocationId, envelope] of sources) {
    if (envelope.source !== "FastMoss") continue;
    const priority = TOOL_PRIORITY[envelope.tool] || 0;
    if (!priority) continue;
    for (const { product, pointer } of sourceRows(envelope)) {
      if (
        envelope.tool === "product_detail_info" &&
        product.product_id != null &&
        String(product.product_id) !==
          String(envelope.request?.filter?.product_id ?? "")
      )
        continue;
      const productId = String(
        product.product_id ?? envelope.request?.filter?.product_id ?? "",
      );
      const url = httpsUrl(product.cover_url);
      if (!wanted.has(productId) || !url) continue;
      const previous = chosen.get(productId);
      if (!previous || priority > previous.priority)
        chosen.set(productId, {
          product_id: productId,
          url: url.href,
          invocation_id: invocationId,
          pointer,
          priority,
        });
    }
  }
  return chosen;
}

async function fetchImage(source) {
  const url = new URL(source.url);
  const endpoint = `${url.origin}${url.pathname}`;
  const query = Object.fromEntries(url.searchParams.entries());
  let connection;
  try {
    connection = await providerFetch(
      endpoint,
      {
        method: "GET",
        headers: {
          accept: "image/avif,image/webp,image/png,image/jpeg;q=0.9,*/*;q=0.1",
        },
        signal: AbortSignal.timeout(12_000),
      },
      query,
    );
    if (!connection.response.ok) return null;
    const bytes = await readLimited(connection.response, SINGLE_IMAGE_LIMIT);
    const mime = imageMime(bytes);
    if (!mime) return null;
    return {
      data_url: `data:${mime};base64,${bytes.toString("base64")}`,
      byte_length: bytes.length,
      source,
    };
  } catch {
    return null;
  } finally {
    await connection?.close();
  }
}

export async function archiveReportImages(
  candidates,
  sources,
  {
    fetchOne = fetchImage,
    maxBytes = REPORT_IMAGE_LIMIT,
    selectSources = reportImageSources,
  } = {},
) {
  const eligible = [...selectSources(candidates, sources).values()];
  const images = new Map();
  let bytesUsed = 0;
  for (
    let offset = 0;
    offset < eligible.length && bytesUsed < maxBytes;
    offset += 5
  ) {
    const batch = eligible.slice(offset, offset + 5);
    const fetched = await Promise.all(
      batch.map((source) =>
        Promise.resolve()
          .then(() => fetchOne(source))
          .catch(() => null),
      ),
    );
    for (let i = 0; i < batch.length; i++) {
      const item = fetched[i];
      if (
        !item ||
        !Number.isSafeInteger(item.byte_length) ||
        item.byte_length <= 0 ||
        bytesUsed + item.byte_length > maxBytes ||
        !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(
          item.data_url || "",
        )
      ) {
        continue;
      }
      images.set(batch[i].product_id, item.data_url);
      bytesUsed += item.byte_length;
    }
  }
  return {
    images,
    eligible_count: eligible.length,
    archived_count: images.size,
    // Covers skipped after reaching the total byte cap are missing too.
    failed_product_ids: eligible
      .filter((item) => !images.has(item.product_id))
      .map((item) => item.product_id),
    bytes_used: bytesUsed,
  };
}
