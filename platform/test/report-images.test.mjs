import test from "node:test";
import assert from "node:assert/strict";
import {
  archiveReportImages,
  reportImageSources,
} from "../src/reports/report-images.mjs";

const candidates = [
  { product_id: "p1", image: "https://untrusted.example/model.jpg" },
  { product_id: "p2", image: null },
];

test("report images are selected from exact FastMoss product evidence and prefer details", () => {
  const sources = new Map([
    [
      "rank",
      {
        source: "FastMoss",
        tool: "product_rank_new_listed",
        decoded: [
          {
            data: {
              list: [
                {
                  product_id: "p1",
                  cover_url: "https://cdn.example/rank.jpg?width=160",
                },
                {
                  product_id: "other",
                  cover_url: "https://cdn.example/wrong.jpg",
                },
              ],
            },
          },
        ],
      },
    ],
    [
      "detail",
      {
        source: "FastMoss",
        tool: "product_detail_info",
        request: { filter: { product_id: "p1" } },
        decoded: [
          {
            data: {
              product: { cover_url: "https://cdn.example/detail.jpg" },
            },
          },
        ],
      },
    ],
  ]);
  const selected = reportImageSources(candidates, sources);
  assert.equal(selected.size, 1);
  assert.equal(selected.get("p1").url, "https://cdn.example/detail.jpg");
  assert.equal(selected.get("p1").invocation_id, "detail");
  assert.ok(!selected.has("p2"));
});

test("image archiving is bounded and keeps download failures non-fatal", async () => {
  const sources = new Map([
    [
      "rank",
      {
        source: "FastMoss",
        tool: "product_rank_new_listed",
        decoded: [
          {
            data: {
              list: candidates.map((candidate) => ({
                product_id: candidate.product_id,
                cover_url: `https://cdn.example/${candidate.product_id}.png`,
              })),
            },
          },
        ],
      },
    ],
  ]);
  const archived = await archiveReportImages(candidates, sources, {
    maxBytes: 3,
    fetchOne: async (source) =>
      source.product_id === "p1"
        ? { data_url: "data:image/png;base64,AA==", byte_length: 2 }
        : { data_url: "data:image/png;base64,AQID", byte_length: 3 },
  });
  assert.equal(archived.eligible_count, 2);
  assert.equal(archived.archived_count, 1);
  assert.equal(archived.bytes_used, 2);
  assert.deepEqual(archived.failed_product_ids, ["p2"]);
});
