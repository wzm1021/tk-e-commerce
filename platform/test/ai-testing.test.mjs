import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { sdkCall } from "../src/ai-testing/sdk.mjs";
import sharp from "sharp";
import { id } from "../src/common/core.mjs";
import {
  emptyDraft,
  emptyArm,
  testSpec,
  effectiveArm,
  confirmationDigest,
  creditsFor,
  captureIdentity,
  DraftInput,
} from "../src/ai-testing/contract.mjs";
import { captureTarget, publicProxy } from "../src/ai-testing/screenshot.mjs";
import { inspectImage, cropImage } from "../src/ai-testing/images.mjs";
import { publicResults } from "../src/ai-testing/engine.mjs";
import { productLinkError } from "../web/lib/ai-test-limits.mjs";
const valid = () => {
  const d = emptyDraft();
  d.arms[0].product = {
    ...d.arms[0].product,
    name: "Rack",
    use: "Storage",
    material: "Bamboo",
  };
  d.arms[0].pricing.current_price = 29.99;
  d.arms[0].url = "https://www.amazon.com/dp/B012345678";
  d.arms[0].product_id = "B012345678";
  for (const a of d.arms) a.image_id = id();
  return d;
};
test("AI contract keeps different-product unknown facts distinct and explicit inheritance visible", () => {
  const d = valid(),
    b = d.arms[1];
  b.other_product = true;
  b.url = "https://www.amazon.com/dp/B012345679";
  b.inherit = [];
  b.product.name = "Steel rack";
  b.product.use = "Storage";
  b.pricing.current_price = 19.99;
  const spec = testSpec(d);
  assert.equal(spec.product.material, undefined);
  assert.equal(spec.arms[0].product.material, "Bamboo");
  assert.equal(spec.arms[1].product.material, undefined);
  assert.equal(spec.arms[1].pricing.current_price, 19.99);
  b.inherit = ["material"];
  assert.equal(testSpec(d).arms[1].product.material, "Bamboo");
  b.inherit = [];
  b.product.use = "Drying";
  assert.throws(() => testSpec(d), /ai_problem_required/);
  d.shopper_problem = "Organize a small home";
  assert.ok(testSpec(d));
  assert.equal(creditsFor(d), 40);
});
test("same-product B inherits identity but every image remains independent", () => {
  const d = valid(),
    b = effectiveArm(d, d.arms[1]);
  assert.equal(b.url, d.arms[0].url);
  assert.equal(b.product_id, d.arms[0].product_id);
  assert.notEqual(b.image_id, d.arms[0].image_id);
  const before = captureIdentity(d, b);
  d.arms[0].product_id = "other";
  assert.notEqual(captureIdentity(d, effectiveArm(d, d.arms[1])), before);
});
test("virtual consumer count accepts 10–20 integers and rejects oversized SDK requests", () => {
  const d = valid();
  assert.equal(d.persona_count, 20);
  for (const count of [10, 20]) {
    d.persona_count = count;
    assert.equal(testSpec(d).persona_count, count);
  }
  for (const count of [9, 20.5, 21, 25, 50]) {
    d.persona_count = count;
    assert.throws(() => testSpec(d));
  }
});
test("confirmation includes revision, all fields, image contents and capture metadata", () => {
  const draft = { version: 1, data: valid() },
    images = [{ id: id(), sha256: "aaa", request: {}, metadata: {} }],
    original = confirmationDigest(draft, images);
  draft.data.arms[1].label = "Changed";
  assert.notEqual(original, confirmationDigest(draft, images));
  const next = confirmationDigest(draft, images);
  images[0].sha256 = "bbb";
  assert.notEqual(next, confirmationDigest(draft, images));
  assert.throws(() => DraftInput.parse({ ...draft.data, persona_count: 100 }));
});
test("page screenshot targets require matching product and market; private and lookalike URLs rejected", () => {
  assert.equal(
    captureTarget(
      "https://www.amazon.com/title/dp/B012345678",
      "amazon_us",
      "B012345678",
    ).hostname,
    "www.amazon.com",
  );
  assert.ok(
    captureTarget(
      "https://www.tiktok.com/shop/pdp/product-name/1729613111070136690",
      "tiktok_us",
      "1729613111070136690",
    ),
  );
  for (const url of [
    "http://www.amazon.com/dp/B012345678",
    "https://127.0.0.1/dp/B012345678",
    "https://www.amazon.com.evil.test/dp/B012345678",
    "https://name:pass@www.amazon.com/dp/B012345678",
    "https://www.amazon.co.uk/dp/B012345678",
    "https://www.amazon.com/dp/B987654321",
  ])
    assert.throws(() => captureTarget(url, "amazon_us", "B012345678"));
});
test("uploaded screenshots decode, enforce formats and crop bounds", async () => {
  const b = await sharp({
    create: { width: 400, height: 300, channels: 3, background: "#aaa" },
  })
    .png()
    .toBuffer();
  assert.equal((await inspectImage(b)).width, 400);
  const cropped = await cropImage(b, {
    left: 10,
    top: 20,
    width: 100,
    height: 80,
  });
  assert.equal((await inspectImage(cropped)).height, 80);
  await assert.rejects(
    cropImage(b, { left: 350, top: 0, width: 100, height: 100 }),
    /ai_crop_invalid/,
  );
  await assert.rejects(inspectImage(Buffer.from("<svg/>")), /ai_image_invalid/);
  await assert.rejects(
    inspectImage(Buffer.alloc(5 * 1024 * 1024 + 1)),
    /ai_image_size/,
  );
});
test("non-simulation or invalid rates never become customer reports", () => {
  assert.throws(
    () => publicResults({ schema_version: "1", is_simulation: false }, ["A"]),
    /ai_result_invalid/,
  );
  assert.throws(
    () =>
      publicResults(
        {
          schema_version: "1",
          is_simulation: true,
          arms: { A: { buy_rate: { value: 1.2, ci95: [0, 1] } } },
          comparisons: [],
        },
        ["A"],
      ),
    /ai_result_invalid/,
  );
});
test("screenshot proxy refuses loopback IP and private DNS connections", async () => {
  const proxy = await publicProxy();
  try {
    for (const host of ["127.0.0.1:443", "localhost:443", "[::1]:443"])
      await new Promise((resolve, reject) => {
        const url = new URL(proxy.url),
          req = http.request({
            host: url.hostname,
            port: url.port,
            method: "CONNECT",
            path: host,
          });
        req.on("connect", () => reject(Error("private target connected")));
        req.on("error", () => resolve());
        req.setTimeout(1500, () => {
          req.destroy();
          reject(Error("proxy did not reject promptly"));
        });
        req.end();
      });
  } finally {
    await proxy.close();
  }
});
test("SDK process uses private stdin, persists receipts before returning, and surfaces ambiguous failures", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "ai-sdk-bridge-")),
    exe = path.join(dir, "offline-python"),
    prior = process.env.AI_TEST_PYTHON;
  try {
    await writeFile(
      exe,
      "#!" +
        process.execPath +
        '\nlet s="";process.stdin.on("data",b=>s+=b);process.stdin.on("end",()=>{const p=JSON.parse(s);if(process.argv.join(" ").includes(p.key))throw Error("key leaked");if(p.action==="fail"){process.stdout.write(JSON.stringify({error:"HTTP_401"})+"\\n");return;}if(p.action==="invalid"){process.stdout.write("broken json");return;}process.stdout.write(JSON.stringify({event:"receipt",id:"pt_local",status:"queued"})+"\\n"+JSON.stringify({result:{id:"pt_local",status:"queued"}})+"\\n");});',
      { mode: 0o700 },
    );
    process.env.AI_TEST_PYTHON = exe;
    let persisted = false;
    const result = await sdkCall(
      { key: "fl_private_only", action: "create" },
      {
        onReceipt: async () => {
          await new Promise((r) => setTimeout(r, 20));
          persisted = true;
        },
      },
    );
    assert.equal(persisted, true);
    assert.equal(result.id, "pt_local");
    await assert.rejects(
      sdkCall({ key: "fl_private_only", action: "fail" }),
      /ai_http_401/,
    );
    await assert.rejects(
      sdkCall({ key: "fl_private_only", action: "invalid" }),
      /ai_sdk_invalid/,
    );
    await assert.rejects(
      sdkCall(
        { key: "fl_private_only", action: "create" },
        {
          onReceipt: () => {
            throw Error("receipt not persisted");
          },
        },
      ),
      /receipt not persisted/,
    );
  } finally {
    if (prior === undefined) delete process.env.AI_TEST_PYTHON;
    else process.env.AI_TEST_PYTHON = prior;
    await rm(dir, { recursive: true, force: true });
  }
});
test("new tests require a usable HTTPS product link for each independent product", () => {
  const d = valid();
  d.arms[0].url = "";
  assert.throws(() => testSpec(d), /ai_product_link_required/);
  d.arms[0].url = "https://www.amazon.com/dp/B012345678";
  assert.ok(testSpec(d));
  d.arms[1].other_product = true;
  assert.throws(() => testSpec(d), /ai_product_link_required/);
  for (const url of [
    "https://",
    "javascript:alert(1)",
    "https://user:pass@example.com/product",
  ]) {
    d.arms[1].url = url;
    assert.throws(() => testSpec(d), /ai_product_link_required/);
  }
  d.arms[1].url = "https://www.amazon.com/dp/B012345679";
  assert.ok(testSpec(d));
});

test("long Amazon links preserve the original while adapting SDK URLs without losing seller or variant", () => {
  const d = valid();
  d.market = "amazon_us";
  const prefix =
    "https://www.amazon.com/HAMITOR-Shower-Caddy/dp/B012345678?smid=SELLER123&th=1&psc=1&ref_=";
  const url = prefix + "x".repeat(8192 - prefix.length);
  d.arms[0].url = url;
  d.arms[1].other_product = true;
  d.arms[1].url = url.replace("B012345678", "B012345679");
  const parsed = DraftInput.parse(d);
  assert.equal(parsed.arms[0].url, url);
  assert.equal(parsed.arms[1].url, d.arms[1].url);
  assert.equal(
    testSpec(d).product.url,
    "https://www.amazon.com/dp/B012345678?smid=SELLER123&th=1&psc=1",
  );
  assert.equal(d.arms[0].url, url);
  assert.equal(productLinkError(parsed.arms[0]), "");
  parsed.arms[1].url += "x";
  const rejected = DraftInput.safeParse(parsed);
  assert.equal(rejected.success, false);
  assert.deepEqual(rejected.error.issues[0].path, ["arms", 1, "url"]);
  assert.match(rejected.error.issues[0].message, /商品页面链接过长/);
  assert.match(productLinkError(parsed.arms[1]), /^方案 B：商品页面链接过长/);
});

test("SDK URL adaptation preserves offers, rejects ambiguous identity and never truncates unknown parameters", () => {
  const d = valid();
  d.market = "amazon_us";
  const retained =
    "smid=SELLER123&th=1&psc=1&offerListingID=offer%2B1&sku=blue&language=en_US&custom=value";
  for (const [market, host, path] of [
    ["amazon_us", "www.amazon.com", "title/dp"],
    ["amazon_uk", "amazon.co.uk", "gp/product"],
    ["amazon_jp", "www.amazon.co.jp", "gp/aw/d"],
  ]) {
    d.market = market;
    d.currency = { amazon_us: "USD", amazon_uk: "GBP", amazon_jp: "JPY" }[
      market
    ];
    d.arms[0].url = `https://${host}/${path}/B012345678?${retained}&dib=${"x".repeat(900)}&utm_source=campaign`;
    assert.equal(
      testSpec(d).product.url,
      `https://${host}/dp/B012345678?${retained}`,
    );
  }
  d.market = "amazon_us";
  d.currency = "USD";
  d.arms[0].url = `https://www.amazon.com/dp/B012345679?ref_=${"x".repeat(900)}`;
  assert.throws(() => testSpec(d), /ai_product_link_identity/);
  for (const url of [
    `https://www.amazon.com.evil.test/dp/B012345678?ref_=${"x".repeat(900)}`,
    `https://www.amazon.com/search?ref_=${"x".repeat(900)}`,
    `https://www.amazon.com/dp/B012345678?offerListingID=${"x".repeat(900)}`,
    `https://www.amazon.com/dp/B012345678?unknown=${"x".repeat(900)}`,
  ]) {
    d.arms[0].url = url;
    assert.throws(() => testSpec(d), /ai_product_link_too_long/);
  }
});

test("SDK spec omits unfilled optional text while retaining provided values and local draft fields", () => {
  const d = valid();
  const spec = testSpec(d);
  assert.equal(Object.hasOwn(spec.scenario, "shopper_problem"), false);
  assert.equal(Object.hasOwn(spec.scenario, "usage_context"), false);
  assert.equal(Object.hasOwn(spec.audience, "description"), false);
  assert.ok(spec.arms.every((a) => !Object.hasOwn(a, "change_summary")));
  assert.equal(d.shopper_problem, "");
  d.shopper_problem = "Keep the room tidy";
  d.usage_context = "Small apartment";
  d.audience_description = "Adults organizing their home";
  d.arms[1].change_summary = "Show the rack dimensions";
  const filled = testSpec(d);
  assert.equal(filled.scenario.shopper_problem, d.shopper_problem);
  assert.equal(filled.scenario.usage_context, d.usage_context);
  assert.equal(filled.audience.description, d.audience_description);
  assert.equal(filled.arms[1].change_summary, d.arms[1].change_summary);
});
