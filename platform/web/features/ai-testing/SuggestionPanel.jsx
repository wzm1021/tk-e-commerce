import { useState } from "react";
import { Button } from "../../components/ui.jsx";
import { fields, effective } from "./model.mjs";
const shared = {
  shopper_problem: "消费者要解决的问题",
  usage_context: "使用场景",
  audience_description: "想测试的人群",
  question: "主要问题",
  follow_ups: "追问",
};
const label = (p) =>
  p.startsWith("product.") ? fields[p.slice(8)] : fields[p] || shared[p];
const blank = (v) =>
  v == null ||
  (Array.isArray(v)
    ? !v.some((x) => String(x).trim())
    : typeof v === "string" && !v.trim());
function currentValue(data, arm, path) {
  const [g, k] = path.split(".");
  return k ? effective(data, arm)[g][k] : data[path];
}
const messages = {
  ai_suggestion_output_limit:
    "模型生成达到输出上限，本次未填入任何建议。可重新生成或根据原始资料手动填写。",
  ai_suggestion_model_unavailable:
    "当前工作空间没有可用模型，请联系平台管理员配置。",
  ai_suggestion_context_large:
    "已保存的商品资料较多，本次未生成建议；可根据原始资料手动填写。",
  ai_suggestion_stale: "商品已更换，请根据当前资料重新生成建议。",
  ai_suggestion_interrupted: "生成过程被中断，可重新尝试。",
  ai_suggestion_queue_full: "建议生成队列暂时已满，请稍后重试。",
};
function SuggestionEvidence({ suggestion: s }) {
  return (
    (s.source_quote || s.source_value !== undefined) && (
      <details>
        <summary>查看依据</summary>
        {s.source_value !== undefined && (
          <>
            <small>原文内容</small>
            <blockquote>
              {Array.isArray(s.source_value)
                ? s.source_value.join("\n")
                : String(s.source_value)}
            </blockquote>
          </>
        )}
        {s.source_quote && (
          <>
            <small>原文依据</small>
            <blockquote>{s.source_quote}</blockquote>
          </>
        )}
      </details>
    )
  );
}
export function SuggestionPanel({ row, arm, data, hasSource, action, busy }) {
  const [edited, setEdited] = useState({}),
    [excluded, setExcluded] = useState([]);
  if (!hasSource || (arm.id !== "A" && !arm.other_product)) return null;
  const translating = row?.needs_translation && row?.state === "ready";
  const pending = ["queued", "generating"].includes(row?.state);
  const available = (row?.suggestions || []).filter((s) =>
    blank(currentValue(data, arm, s.path)),
  );
  return (
    <section className="ai-suggestions" aria-label={arm.id + " AI 填写建议"}>
      <div className="ai-card-heading">
        <h3>AI 填写建议</h3>
        <span className="ai-suggestion-tag">方案 {arm.id}</span>
      </div>
      <p>
        结合该商品的完整资料补充空白项。建议可修改，确认后填入；已有内容会保留。
      </p>
      {row?.stale ? (
        <p role="status">商品资料已变化，旧建议不可采用，请重新生成。</p>
      ) : pending || translating ? (
        <p role="status">
          {row.translation_of || translating
            ? "正在整理中文建议，原文会保留在查看依据中…"
            : "正在结合商品背景生成建议，你可以继续填写其他信息…"}
        </p>
      ) : row?.state === "failed" ? (
        <p role="status">
          {messages[row.error_code] ||
            "暂时未能生成建议，已导入的商品资料不受影响。请稍后重试或手动填写。"}
        </p>
      ) : row?.state === "ready" && available.length === 0 ? (
        <p role="status">
          {row.suggestions.length
            ? "建议已填写，或对应字段已有内容。请继续核对表单。"
            : "暂未找到有足够依据的补充内容，请参考填写提示手动补充。"}
        </p>
      ) : null}
      {!row?.stale &&
        !translating &&
        row?.state === "ready" &&
        available.map((s) => {
          const array = Array.isArray(s.value),
            value =
              edited[s.path] ?? (array ? s.value.join("\n") : String(s.value));
          return (
            <div className="ai-suggestion-item" key={s.path}>
              <label className="ai-check">
                <input
                  type="checkbox"
                  checked={!excluded.includes(s.path)}
                  onChange={(e) =>
                    setExcluded((old) =>
                      e.target.checked
                        ? old.filter((p) => p !== s.path)
                        : [...old, s.path],
                    )
                  }
                />
                {label(s.path)}{" "}
                <span className="ai-suggestion-tag">
                  {s.kind === "source"
                    ? "资料提取 · 待核对"
                    : "AI 建议 · 待确认"}
                </span>
              </label>
              <textarea
                aria-label={arm.id + " 建议：" + label(s.path)}
                value={value}
                maxLength={
                  array ? 2100 : s.path === "audience_description" ? 500 : 300
                }
                rows={array ? 3 : 2}
                onChange={(e) =>
                  setEdited((old) => ({ ...old, [s.path]: e.target.value }))
                }
              />
              <small>{s.reason}</small>
              <SuggestionEvidence suggestion={s} />
            </div>
          );
        })}
      {!row?.stale &&
        !translating &&
        row?.state === "ready" &&
        row.suggestions.some((s) => !available.includes(s)) && (
          <details>
            <summary>查看已填写建议的依据</summary>
            {row.suggestions
              .filter((s) => !available.includes(s))
              .map((s) => (
                <div className="ai-suggestion-item" key={s.path}>
                  <strong>{label(s.path)}</strong>
                  <p>
                    {Array.isArray(s.value)
                      ? s.value.join("；")
                      : String(s.value)}
                  </p>
                  <small>{s.reason}</small>
                  <SuggestionEvidence suggestion={s} />
                </div>
              ))}
          </details>
        )}
      <div className="ai-actions">
        {!row?.stale &&
          !translating &&
          row?.state === "ready" &&
          available.length > 0 && (
            <Button
              disabled={
                busy || !available.some((s) => !excluded.includes(s.path))
              }
              onClick={() => {
                const values = Object.fromEntries(
                  available
                    .filter((s) => !excluded.includes(s.path))
                    .map((s) => {
                      const raw = edited[s.path];
                      return [
                        s.path,
                        raw === undefined
                          ? s.value
                          : Array.isArray(s.value)
                            ? raw
                                .split("\n")
                                .map((x) => x.trim())
                                .filter(Boolean)
                            : s.path === "pricing.current_price"
                              ? Number(raw)
                              : raw,
                      ];
                    }),
                );
                action("/apply-suggestions", { suggestion_id: row.id, values });
              }}
            >
              确认并填入所选空白项
            </Button>
          )}
        {(!row || row.stale || row.state === "failed" || translating) && (
          <Button
            secondary
            disabled={busy || (pending && !row.stale)}
            onClick={() =>
              !row?.stale && (row?.translation_of || translating)
                ? action("/translate-suggestions", {
                    suggestion_id: row.translation_of || row.id,
                    retry: true,
                  })
                : action("/suggestions", { arm: arm.id })
            }
          >
            {row?.translation_of || translating
              ? "重新整理中文建议"
              : row
                ? "重新生成建议"
                : "为缺失信息生成建议"}
          </Button>
        )}
      </div>
    </section>
  );
}
