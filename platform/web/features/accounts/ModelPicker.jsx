import { Field } from "../../components/ui.jsx";
import { Select } from "../../components/Select.jsx";

export const availableModels = (catalog) =>
  (catalog?.connections || []).filter((x) => x.kind === "model" && x.ready);
export const effectiveModel = (catalog, chosen) =>
  availableModels(catalog).find((x) => x.id === chosen)?.id ||
  availableModels(catalog).find((x) => x.id === catalog?.default_model_id)
    ?.id ||
  availableModels(catalog)[0]?.id ||
  "";
export function ModelPicker({ catalog, value, onChange }) {
  const selected = availableModels(catalog).find((x) => x.id === effectiveModel(catalog, value));
  const rates = selected?.price?.rates;
  return (
    <Field label="使用模型">
      <Select
        variant="box"
        name="model_connection_id"
        ariaLabel="使用模型"
        value={effectiveModel(catalog, value)}
        onChange={onChange}
        options={[
          ...(!availableModels(catalog).length
            ? [{ value: "", title: "暂无可用模型，请联系平台管理员" }]
            : []),
          ...availableModels(catalog).map((x) => ({
            value: x.id,
            title: x.name || x.model,
          })),
        ]}
      />
      {rates && (
        <small className="model-rate-hint">
          {selected.model} · 元 / 百万 Token：输入 ¥{Number(rates.input)}，
          输出 ¥{Number(rates.output)}，缓存读取 ¥{Number(rates.cache_read)}
          ，缓存写入 ¥{Number(rates.cache_write)}
          {selected.price.time_pricing ? "（当前时段价格，按调用发出时间结算）" : ""}
        </small>
      )}
    </Field>
  );
}
