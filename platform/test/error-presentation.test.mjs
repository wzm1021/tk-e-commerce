import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { errorLabel, errorText } from "../web/lib/format.mjs";
import {
  fieldLabel,
  validationFields,
  fieldErrorsText,
  nativeValidationMessage,
} from "../web/lib/validation-errors.mjs";
import { requiredTestFields } from "../web/lib/ai-test-required.mjs";
import { emptyDraft, testSpec } from "../src/ai-testing/contract.mjs";
import { providerValidationFields } from "../src/ai-testing/validation.mjs";
import { sdkCall } from "../src/ai-testing/sdk.mjs";
import { id } from "../src/common/core.mjs";

function ready() {
  const d = emptyDraft();
  Object.assign(d.arms[0].product, { name: "Synthetic rack", use: "Storage" });
  d.arms[0].pricing.current_price = 12;
  d.arms[0].url = "https://www.amazon.com/dp/B012345678";
  d.arms.forEach((a) => (a.image_id = id()));
  return d;
}
test("all display boundaries localize known, unknown, native and future errors", () => {
  for (const code of [
    "ai_invalid_spec",
    "internal_error",
    "ai_feature_disabled",
    "ai_quota_exceeded",
    "not_found",
    "future_provider_error",
    "__proto__",
    "constructor",
    "ECONNRESET",
  ])
    assert.match(errorLabel(code), /[\u3400-\u9fff]/u);
  assert.equal(errorText("Failed to fetch"), "网络连接中断，请检查网络后重试");
  assert.equal(
    errorText(new Error("HTTP 500 /private/secret")),
    errorLabel("unknown"),
  );
  assert.equal(errorText("请填写商品名称"), "请填写商品名称");
  assert.match(
    nativeValidationMessage({ validity: { valueMissing: true } }),
    /必填/,
  );
  assert.match(
    nativeValidationMessage({
      validity: { typeMismatch: true },
      type: "email",
    }),
    /邮箱/,
  );
});
test("nested Zod fields show arm, field and numeric remedy without English paths", () => {
  const d = ready();
  d.arms[1].product.name = "x".repeat(301);
  let error;
  try {
    testSpec(d);
  } catch (e) {
    error = e;
  }
  const fields = validationFields(error.issues, "ai-testing");
  assert.equal(fields[0].label, "方案 B · 商品信息 · 商品名称");
  assert.equal(fields[0].message, "请缩短至 300 个字符以内");
  assert.equal(
    fieldLabel("data.arms.0.url", "ai-testing"),
    "方案 A · 商品页面链接",
  );
  assert.equal(
    fieldErrorsText([
      {
        path: "data.arms.0.url",
        message: "Too big: expected string to have <=500 characters",
      },
    ]),
    "方案 A · 商品页面链接：请缩短至 500 个字符以内",
  );
  assert.match(
    validationFields(z.number().positive().safeParse(0).error.issues)[0]
      .message,
    /大于 0/,
  );
  assert.match(
    validationFields(z.number().int().safeParse(1.5).error.issues)[0].message,
    /整数/,
  );
});
test("flattened provider errors recover exact paths when the submitted spec proves the constraint", () => {
  const s = testSpec(ready());
  s.arms[0].change_summary = "";
  s.arms[1].pricing.shipping = "s".repeat(201);
  const fields = providerValidationFields(
    {
      fieldErrors: {
        arms: [
          "Too small: expected string to have >=1 characters",
          "Too big: expected string to have <=200 characters",
        ],
      },
    },
    s,
  );
  assert.deepEqual(
    fields.map((x) => x.path),
    ["arms.0.change_summary", "arms.1.pricing.shipping"],
  );
  assert.match(fields[0].message, /不能为空/);
  assert.equal(fields[1].label, "方案 B · 价格与配送 · 运费说明");
  assert.match(fields[1].message, /200/);
});
test("provider diagnostics never disclose raw messages, input values, unknown keys or guessed paths", () => {
  const spec = testSpec(ready());
  const fields = providerValidationFields(
    {
      fieldErrors: {
        arms: ["secret fl_private at /srv/private"],
        "/private/path": ["private"],
      },
      formErrors: ["private trace"],
    },
    spec,
  );
  assert.equal(fields[0].path, "arms");
  assert.match(fields[0].message, /只标明了此分组/);
  assert.doesNotMatch(JSON.stringify(fields), /secret|private|fl_|srv/);
  const exact = providerValidationFields(
    {
      issues: [
        {
          path: ["arms", 1, "label"],
          code: "too_big",
          origin: "string",
          maximum: 120,
          input: "secret",
        },
      ],
    },
    spec,
  );
  assert.equal(exact[0].label, "方案 B · 方案名称");
  assert.match(exact[0].message, /120/);
  assert.match(providerValidationFields({}, spec)[0].message, /未返回具体字段/);
});
test("required fields respect inheritance and conditional uses without changing draft data", () => {
  const d = ready();
  assert.deepEqual(requiredTestFields(d), []);
  const before = structuredClone(d);
  d.arms[1].other_product = true;
  d.arms[1].inherit = [];
  d.arms[1].product.use = "Drying";
  const fields = requiredTestFields(d);
  assert.ok(fields.some((x) => x.path === "arms.1.product.name"));
  assert.ok(fields.some((x) => x.path === "arms.1.pricing.current_price"));
  assert.ok(fields.some((x) => x.path === "shopper_problem"));
  d.shopper_problem = "Organize home";
  assert.ok(!requiredTestFields(d).some((x) => x.path === "shopper_problem"));
  assert.equal(before.arms[1].product.name, "");
  const empty = emptyDraft();
  assert.throws(
    () => testSpec(empty),
    (e) =>
      e.code === "ai_product_link_required" &&
      e.detail.fields.some((x) => x.path === "arms.0.image_id"),
  );
});
test("SDK subprocess preserves safe field diagnostics while keeping the machine error code", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "ai-error-")),
    exe = path.join(dir, "python"),
    prior = process.env.AI_TEST_PYTHON;
  try {
    await writeFile(
      exe,
      `#!${process.execPath}\nprocess.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({error:'invalid_spec',details:{issues:[{path:['arms',1,'label'],code:'too_big',origin:'string',maximum:120}],trace:'fl_private'}})));`,
      { mode: 0o700 },
    );
    process.env.AI_TEST_PYTHON = exe;
    await assert.rejects(
      sdkCall({
        action: "estimate",
        key: "fl_private",
        spec: testSpec(ready()),
      }),
      (e) => {
        assert.equal(e.code, "ai_invalid_spec");
        assert.equal(e.detail.fields[0].label, "方案 B · 方案名称");
        assert.doesNotMatch(JSON.stringify(e.detail), /fl_private|trace/);
        return true;
      },
    );
  } finally {
    if (prior === undefined) delete process.env.AI_TEST_PYTHON;
    else process.env.AI_TEST_PYTHON = prior;
    await rm(dir, { recursive: true, force: true });
  }
});
