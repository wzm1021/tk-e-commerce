import { useState } from "react";
import { Field } from "../../components/ui.jsx";
import { Select } from "../../components/Select.jsx";
import { AdminForm } from "./AdminForm.jsx";

export function PriceForm({ api, connections, onSaved }) {
  const [timePricing, setTimePricing] = useState(false);
  return (
    <AdminForm
      api={api}
      path="/api/admin/prices"
      onSaved={onSaved}
      submitLabel="发布新价格版本"
      convert={(f) => ({
        connection_id: f.get("connection_id"),
        name: f.get("name"),
        data: {
          currency: "CNY",
          fx: "1",
          market: {
            input: f.get("input"),
            output: f.get("output"),
            cache_read: f.get("cache_read"),
            cache_write: f.get("cache_write"),
          },
          procurement_discount: f.get("procurement_discount"),
          sale_discount: f.get("sale_discount"),
          ...(timePricing
            ? {
                time_pricing: {
                  schedule: "deepseek_business_hours_v1",
                  off_peak_discount: f.get("off_peak_discount"),
                },
              }
            : {}),
          max_context_tokens: Number(f.get("max_context_tokens")),
          max_output_tokens: Number(f.get("max_output_tokens")),
          note: f.get("note"),
        },
      })}
    >
      <div className="form-grid">
        <Field label="模型连接" wide>
          <Select
            variant="box"
            name="connection_id"
            options={[
              { value: "", title: "选择模型" },
              ...connections
                .filter((c) => c.kind === "model")
                .map((c) => ({
                  value: c.id,
                  title: `${c.name} · ${c.config.model}`,
                })),
            ]}
          />
        </Field>
        <Field label="价格版本名称" wide>
          <input
            name="name"
            placeholder="GLM-5.2 · 采购原价 + 50% · 2026-09"
            required
          />
        </Field>
        <Field label="计费币种">
          <input value="人民币（CNY）" readOnly />
        </Field>
        <Field label="分时价格">
          <Select
            variant="box"
            value={timePricing ? "deepseek" : "fixed"}
            onChange={(v) => setTimePricing(v === "deepseek")}
            options={[
              { value: "fixed", title: "固定价格" },
              { value: "deepseek", title: "DeepSeek 工作日峰谷价" },
            ]}
          />
        </Field>
        {timePricing ? (
          <Field
            label="空闲时段价格系数"
            hint="基准填写高峰价。北京时间周一至周五 09:00–12:00、14:00–18:00 为高峰，其余为空闲。"
            wide
          >
            <input
              name="off_peak_discount"
              type="number"
              min="0.0001"
              max="1"
              step="0.0001"
              defaultValue="0.5"
              required
            />
          </Field>
        ) : null}
        {[
          ["input", "输入基准价"],
          ["output", "输出基准价"],
          ["cache_read", "缓存读基准价"],
          ["cache_write", "缓存写基准价"],
        ].map(([k, label]) => (
          <Field key={k} label={label + "（元 / 百万 token）"}>
            <input name={k} type="number" min="0" step="0.000001" required />
          </Field>
        ))}
        <Field label="采购系数" hint="已填实际采购价时用 1；市场基准四折用 0.4">
          <input
            name="procurement_discount"
            type="number"
            min="0.0001"
            max="10"
            step="0.0001"
            defaultValue="1"
            required
          />
        </Field>
        <Field label="销售系数" hint="基于实际采购价加 50% 用 1.5">
          <input
            name="sale_discount"
            type="number"
            min="0.0001"
            max="10"
            step="0.0001"
            defaultValue="1.5"
            required
          />
        </Field>
        <Field label="请求上下文上限">
          <input
            name="max_context_tokens"
            type="number"
            min="1024"
            max="1000000"
            defaultValue="64000"
            required
          />
        </Field>
        <Field label="单次输出上限">
          <input
            name="max_output_tokens"
            type="number"
            min="128"
            max="384000"
            defaultValue="4096"
            required
          />
        </Field>
        <Field label="价格来源及口径说明" wide>
          <textarea
            name="note"
            rows={3}
            required
            placeholder="注明基准是市场价还是最终采购价，避免二次折扣。"
          />
        </Field>
      </div>
      <div className="notice">
        新价格只影响之后创建的任务。已开始的任务继续使用原价格、结算汇率与技能版本。
      </div>
    </AdminForm>
  );
}
