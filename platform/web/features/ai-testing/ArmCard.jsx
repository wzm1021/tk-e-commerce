import { useState } from "react";
import { Button, Field, ErrorBox, RequiredMark } from "../../components/ui.jsx";
import { Dialog } from "../../components/Dialog.jsx";
import { fields, inherited, effective, imageUrl, valueOf } from "./model.mjs";
import { productGuidance } from "./form-guidance.mjs";
import { CandidatePicker } from "./CandidatePicker.jsx";
import { candidateKey } from "./candidate-search.mjs";
import { SuggestionPanel } from "./SuggestionPanel.jsx";
import { productLinkError } from "../../lib/ai-test-limits.mjs";
export function ArmCard({
  data,
  arm,
  images,
  workspace,
  change,
  action,
  busy,
  candidates,
  suggestion,
  hasSource,
  error,
}) {
  const [candidate, setCandidate] = useState(""),
    [crop, setCrop] = useState(null),
    [upload, setUpload] = useState(null);
  const a = effective(data, arm),
    image = images.find((i) => i.id === arm.image_id),
    preview = upload?.state === "uploading" ? upload.preview : null,
    linkError = productLinkError(arm);
  const patch = (value) =>
    change((d) => {
      Object.assign(
        d.arms.find((x) => x.id === arm.id),
        value,
      );
    });
  function fact(key, value) {
    change((d) => {
      const target = d.arms.find((x) => x.id === arm.id);
      target.inherit = target.inherit.filter((k) => k !== key);
      if (key.startsWith("pricing.")) target.pricing[key.slice(8)] = value;
      else target.product[key] = value;
      if (["variant", "pricing.current_price"].includes(key)) {
        target.image_id = null;
        if (arm.id === "A")
          for (const other of d.arms.slice(1))
            if (other.inherit.includes(key)) other.image_id = null;
      }
    });
  }
  return (
    <article className="ai-card" aria-label={"方案 " + arm.id}>
      <h2>
        {arm.id}
        {arm.id === "A" ? " · 对照" : ""}
      </h2>
      <Field
        label="方案名称 *"
        hint="用简短名称说明这个方案的特点，报告中会使用此名称。"
      >
        <input
          value={arm.label}
          placeholder={
            arm.id === "A"
              ? "例如：原商品页面"
              : "例如：安装效果图 / 另一款收纳架"
          }
          maxLength={120}
          onChange={(e) => patch({ label: e.target.value })}
        />
      </Field>
      {arm.id !== "A" && (
        <label className="ai-check">
          <input
            type="checkbox"
            checked={arm.other_product}
            onChange={(e) => {
              const checked = e.target.checked;
              patch({
                other_product: checked,
                inherit: checked ? [] : inherited,
                image_id: null,
                ...(!checked ? { url: "", product_id: "" } : {}),
              });
            }}
          />
          该方案是另一款商品
        </label>
      )}
      {arm.id !== "A" && (
        <p className="muted">
          {arm.other_product
            ? "请填写另一款商品自己的链接和资料；仅在信息确实相同时勾选“沿用 A”。本方案也需要单独上传页面截图。"
            : "同款商品可沿用 A 的信息，只需修改不同之处；本方案仍需单独上传页面截图。"}
        </p>
      )}
      {(arm.id === "A" || arm.other_product) && (
        <div className="ai-import">
          <CandidatePicker
            candidates={candidates}
            value={candidate}
            onChange={setCandidate}
            arm={arm.id}
            disabled={busy}
          />
          <Button
            secondary
            disabled={
              busy || !candidates.some((c) => candidateKey(c) === candidate)
            }
            onClick={() =>
              action("/arm-import", {
                arm: arm.id,
                report_id: candidates.find((c) => candidateKey(c) === candidate)
                  .report_id,
                product_id: candidates.find(
                  (c) => candidateKey(c) === candidate,
                ).product_id,
              })
            }
          >
            导入商品并生成空白项建议
          </Button>
          <small className="muted">
            导入会替换本方案的商品资料，并清除原截图；AI 建议需确认后填入。
          </small>
        </div>
      )}
      <SuggestionPanel
        key={suggestion?.id || "empty"}
        row={suggestion}
        arm={arm}
        data={data}
        hasSource={hasSource}
        action={action}
        busy={busy}
      />
      <div className="ai-fields">
        <Field
          label={
            arm.id === "A" || arm.other_product
              ? "商品页面链接 *"
              : "商品页面链接"
          }
          hint={
            arm.id === "A"
              ? "填写商品详情页的 https:// 完整链接，用于确认商品身份和保存记录。"
              : arm.other_product
                ? "填写另一款商品自己的 https:// 详情页链接。"
                : "同款商品可留空沿用 A 的链接，也可填写该方案自己的页面链接。"
          }
        >
          <input
            type="url"
            value={arm.url}
            aria-invalid={Boolean(linkError)}
            aria-describedby={linkError ? `ai-link-error-${arm.id}` : undefined}
            placeholder={
              arm.id !== "A" && !arm.other_product
                ? "留空沿用 A 链接"
                : "粘贴商品详情页完整链接"
            }
            onChange={(e) => patch({ url: e.target.value, image_id: null })}
          />
          {linkError && (
            <span id={`ai-link-error-${arm.id}`} role="alert">
              {linkError}
            </span>
          )}
        </Field>
        <Field
          label="商品 ID / ASIN（选填）"
          hint={
            arm.id !== "A" && !arm.other_product
              ? "同款商品自动沿用 A 的商品 ID / ASIN。"
              : "填写平台商品编号；Amazon 填 ASIN，未知可留空。"
          }
        >
          <input
            value={a.product_id}
            placeholder={
              data.market.startsWith("amazon")
                ? "例如：B0XXXXXXXX"
                : "例如：商品链接中的数字编号"
            }
            disabled={arm.id !== "A" && !arm.other_product}
            onChange={(e) =>
              patch({ product_id: e.target.value, image_id: null })
            }
          />
        </Field>
        {Object.entries(fields).map(([key, label]) => {
          const array = ["key_features", "limitations"].includes(key),
            price = key === "pricing.current_price",
            value = valueOf(a, key),
            guidance = productGuidance[key];
          return (
            <div key={key}>
              <Field
                required={key === "use" && !data.shopper_problem.trim()}
                label={
                  label +
                  (guidance.required ? " *" : key === "use" ? "" : "（选填）")
                }
                hint={
                  (arm.inherit.includes(key)
                    ? "当前沿用 A；编辑后改为独立值。"
                    : "") +
                  guidance.hint +
                  (price ? ` 币种：${data.currency || "请先填写币种"}。` : "")
                }
              >
                {array ? (
                  <textarea
                    value={value.join("\n")}
                    placeholder={guidance.placeholder}
                    onChange={(e) => fact(key, e.target.value.split("\n"))}
                    onBlur={() =>
                      fact(
                        key,
                        value.filter((x) => x.trim()),
                      )
                    }
                  />
                ) : (
                  <input
                    type={price ? "number" : "text"}
                    step={price ? "0.01" : undefined}
                    min={price ? "0.01" : undefined}
                    value={value ?? ""}
                    placeholder={guidance.placeholder}
                    onChange={(e) =>
                      fact(
                        key,
                        price
                          ? e.target.value === ""
                            ? null
                            : Number(e.target.value)
                          : e.target.value,
                      )
                    }
                  />
                )}
              </Field>
              {arm.id !== "A" && (
                <label className="ai-check ai-inherit">
                  <input
                    type="checkbox"
                    checked={arm.inherit.includes(key)}
                    onChange={(e) =>
                      patch({
                        inherit: e.target.checked
                          ? [...arm.inherit.filter((k) => k !== key), key]
                          : arm.inherit.filter((k) => k !== key),
                      })
                    }
                  />
                  沿用 A 的{label}
                </label>
              )}
            </div>
          );
        })}
        <div className="ai-wide">
          <Field
            label="本方案的变化说明（选填）"
            hint={
              arm.id === "A"
                ? "说明对照页面的现状，作为其他方案的比较基准。"
                : "说明相对 A 更换了哪些图片、文案、价格或商品，便于理解比较结果。"
            }
          >
            <textarea
              value={arm.change_summary}
              placeholder={
                arm.id === "A"
                  ? "例如：当前在售页面，展示商品正面图及现有售价。"
                  : arm.other_product
                    ? "例如：改为另一品牌的收纳架，尺寸、材质和价格不同。"
                    : "例如：同一商品和售价，将主图改为安装后的使用效果图。"
              }
              onChange={(e) => patch({ change_summary: e.target.value })}
            />
          </Field>
        </div>
      </div>
      <h3 style={{ marginTop: 24 }}>
        {arm.id} · 商品页面截图 <RequiredMark />
      </h3>
      {preview ? (
        <img
          className="ai-shot"
          src={preview}
          alt={arm.id + " 商品页面截图预览，正在上传"}
        />
      ) : image ? (
        <a
          href={imageUrl(image.artifact_id, workspace)}
          target="_blank"
          rel="noreferrer"
        >
          <img
            className="ai-shot"
            src={imageUrl(image.artifact_id, workspace)}
            alt={arm.id + " 商品页面截图，点击放大"}
          />
        </a>
      ) : (
        <div className="ai-empty-shot">
          添加包含商品、规格、价格与购买区域的页面截图
        </div>
      )}
      {upload?.state === "uploading" && (
        <p className="muted" role="status">
          {preview ? "图片已预览，正在上传" : "正在读取图片"} {upload.name}
          ，尚未保存…
        </p>
      )}
      {upload?.state === "done" && image && (
        <p className="muted" role="status">
          已上传 {upload.name}
        </p>
      )}
      {upload?.state === "error" && <ErrorBox error={upload.error} />}
      <p className="muted">
        自动截图暂未开放。请在浏览器打开商品页面，截图后上传。
      </p>
      <Field
        label="上传 / 替换页面截图"
        hint="PNG、JPEG 或 WebP，最大 5 MB；不使用商品主图代替页面截图。"
      >
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={busy}
          onClick={(e) => {
            // Let the same file be selected again after a failed attempt.
            e.currentTarget.value = "";
          }}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setUpload({ state: "uploading", name: file.name });
            const uploaded = await action(
              "/image",
              async () => {
                if (!file.size) throw new Error("截图为空，请重新选择图片");
                if (file.size > 5 * 1024 * 1024)
                  throw new Error("截图不能超过 5 MB，请压缩后重新上传");
                const encoded = await new Promise((resolve, reject) => {
                  const r = new FileReader();
                  r.onload = () => {
                    const preview = String(r.result);
                    setUpload({ state: "uploading", name: file.name, preview });
                    resolve(preview.split(",")[1]);
                  };
                  r.onerror = () => reject(new Error("无法读取图片"));
                  r.onabort = () => reject(new Error("读取图片已取消，请重试"));
                  r.readAsDataURL(file);
                });
                return { arm: arm.id, data: encoded };
              },
              (e) =>
                setUpload({
                  state: "error",
                  name: file.name,
                  error: e.message,
                }),
            );
            if (uploaded) setUpload({ state: "done", name: file.name });
          }}
        />
      </Field>
      {image && (
        <>
          <p className="muted">
            {image.metadata.manual ? "手动上传" : "页面自动截图"} ·{" "}
            {image.metadata.width} × {image.metadata.height} ·{" "}
            {new Date(image.metadata.captured_at).toLocaleString()}
          </p>
          <Button
            secondary
            disabled={busy}
            onClick={() =>
              setCrop({
                left: 0,
                top: 0,
                width: image.metadata.width,
                height: image.metadata.height,
              })
            }
          >
            裁剪截图
          </Button>
        </>
      )}
      {crop && image && (
        <Dialog
          title={arm.id + " · 裁剪页面截图"}
          wide
          onClose={() => setCrop(null)}
        >
          <div className="ai-testing">
            <ErrorBox error={error} />
            <p>预览完整页面，按原图像素填写裁剪区域。裁剪后仍需重新确认。</p>
            <img
              className="ai-crop-preview"
              src={imageUrl(
                image.full_artifact_id || image.artifact_id,
                workspace,
              )}
              alt="裁剪源图"
            />
            <div className="ai-fields">
              {Object.entries({
                left: "左侧起点",
                top: "顶部起点",
                width: "宽度",
                height: "高度",
              }).map(([k, l]) => (
                <Field
                  key={k}
                  label={l}
                  hint={
                    k === "left" || k === "top"
                      ? "单位：像素；从原图左上角开始计算，0 表示不偏移。"
                      : "单位：像素；填写要保留区域的宽度或高度。"
                  }
                >
                  <input
                    type="number"
                    min={k === "width" || k === "height" ? 1 : 0}
                    value={crop[k]}
                    placeholder={
                      k === "left" || k === "top"
                        ? "例如：0"
                        : "填写裁剪区域的像素尺寸"
                    }
                    onChange={(e) =>
                      setCrop({ ...crop, [k]: Number(e.target.value) })
                    }
                  />
                </Field>
              ))}
            </div>
            <Button
              disabled={busy}
              onClick={async () => {
                if (
                  await action("/crop", {
                    arm: arm.id,
                    image_id: image.id,
                    ...crop,
                  })
                )
                  setCrop(null);
              }}
            >
              保存裁剪
            </Button>
          </div>
        </Dialog>
      )}
    </article>
  );
}
