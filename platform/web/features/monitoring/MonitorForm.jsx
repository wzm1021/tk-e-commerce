import { useState } from "react";
import { Dialog } from "../../components/Dialog.jsx";
import { Button, Field, ErrorBox } from "../../components/ui.jsx";
import { Select } from "../../components/Select.jsx";
import { PLATFORMS, MARKET_NAMES } from "../../lib/platforms.mjs";

export function MonitorForm({ api, catalog, item, onClose, onSaved }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const c = item?.config || {},
    rules = c.rules || {};
  const [interval, setInterval] = useState(String(c.interval_hours || 24));
  async function save(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const f = new FormData(event.currentTarget);
    const config = {
      interval_hours: Number(interval),
      model_connection_id: f.get("model") || null,
      ai_enabled: f.get("ai_enabled") === "on",
      model_budget: f.get("model_budget"),
      data_budget: Number(f.get("data_budget")),
      monthly_model_budget: f.get("monthly_model_budget"),
      monthly_data_budget: Number(f.get("monthly_data_budget")),
      rules: {
        percent: Number(f.get("percent")),
        gmv_absolute: Number(f.get("gmv_absolute")),
        units_absolute: Number(f.get("units_absolute")),
        confirm_days: Number(f.get("confirm_days")),
      },
    };
    try {
      await api(item ? `/api/monitors/${item.id}` : "/api/monitors", {
        method: item ? "PUT" : "POST",
        body: {
          name: f.get("name"),
          config,
          ...(item
            ? { version: item.version }
            : {
                seller_id: f.get("seller_id").trim(),
                market: f.get("market"),
              }),
        },
      });
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={item ? "编辑巡检规则" : "添加竞店监控"}
      onClose={onClose}
      wide
    >
      <form onSubmit={save}>
        <ErrorBox error={error} />
        <div className="form-grid">
          <Field label="监控名称">
            <input
              name="name"
              required
              maxLength={100}
              defaultValue={item?.name || ""}
              placeholder="例如：美区收纳标杆店"
            />
          </Field>
          <Field label="巡检频率">
            <Select
              name="interval"
              variant="box"
              value={interval}
              onChange={setInterval}
              options={[
                { value: "12", title: "每 12 小时" },
                { value: "24", title: "每天" },
                { value: "168", title: "每周" },
              ]}
            />
          </Field>
          <Field
            label="店铺 ID（seller_id）"
            hint="填写数据API确认的数字店铺 ID；首轮会核对市场与身份。"
          >
            <input
              name="seller_id"
              required
              pattern="[0-9]{1,40}"
              inputMode="numeric"
              defaultValue={item?.seller_id || ""}
              disabled={!!item}
              placeholder="保留完整 ID，不转换成数字"
            />
          </Field>
          <Field label="市场">
            <Select
              name="market"
              variant="box"
              disabled={!!item}
              defaultValue={item?.market || "US"}
              options={PLATFORMS.tiktok.markets.map((value) => ({
                value,
                title: MARKET_NAMES[value],
              }))}
            />
          </Field>
        </div>
        <h3>值得提醒的变化</h3>
        <p className="muted">
          GMV 与销量分别比较两个完整 7
          日，同时满足变化幅度和绝对量才触发。首次有效数据建立基线。
        </p>
        <div className="form-grid">
          <Field label="变化幅度（%）">
            <input
              type="number"
              name="percent"
              required
              min="1"
              max="1000"
              step="0.1"
              defaultValue={rules.percent ?? 30}
            />
          </Field>
          <Field label="确认方式">
            <Select
              key={interval}
              name="confirm_days"
              variant="box"
              defaultValue={
                interval === "168" ? "1" : String(rules.confirm_days || 2)
              }
              options={
                interval === "168"
                  ? [{ value: "1", title: "1 次有效巡检" }]
                  : [
                      { value: "2", title: "连续 2 个数据截止日" },
                      { value: "1", title: "1 次有效巡检" },
                    ]
              }
            />
          </Field>
          <Field label="GMV 绝对变化（店铺原币）">
            <input
              type="number"
              name="gmv_absolute"
              required
              min="1"
              max="1000000000000"
              step="0.01"
              defaultValue={rules.gmv_absolute ?? 1000}
            />
          </Field>
          <Field label="销量绝对变化（件）">
            <input
              type="number"
              name="units_absolute"
              required
              min="1"
              max="1000000000"
              defaultValue={rules.units_absolute ?? 100}
            />
          </Field>
        </div>
        <p className="muted">
          同时记录首次观察到进入近 7 日 GMV 商品前 10 的商品，不等同于新品上架。
        </p>
        <h3>预算与解读</h3>
        <div className="form-grid">
          <Field label="单次模型预算（元）">
            <input
              type="number"
              name="model_budget"
              required
              min="0.01"
              max="1000000"
              step="0.01"
              defaultValue={c.model_budget || "1"}
            />
          </Field>
          <Field label="单次数据预算（积分）">
            <input
              type="number"
              name="data_budget"
              required
              min="3"
              max="30"
              step="0.1"
              defaultValue={c.data_budget || 3}
            />
          </Field>
          <Field label="每月模型上限（元）">
            <input
              type="number"
              name="monthly_model_budget"
              required
              min="0.01"
              max="1000000"
              step="0.01"
              defaultValue={c.monthly_model_budget || "30"}
            />
          </Field>
          <Field label="每月数据上限（积分）">
            <input
              type="number"
              name="monthly_data_budget"
              required
              min="3"
              max="2400"
              step="0.1"
              defaultValue={c.monthly_data_budget || 100}
            />
          </Field>
          <Field label="解读模型">
            <Select
              name="model"
              variant="box"
              defaultValue={c.model_connection_id || ""}
              options={[
                { value: "", title: "使用账户默认模型" },
                ...(catalog?.connections || [])
                  .filter((x) => x.kind === "model" && x.ready)
                  .map((x) => ({ value: x.id, title: x.name || x.model })),
              ]}
            />
          </Field>
          <Field label="变化解释">
            <span className="monitor-check">
              <input
                type="checkbox"
                name="ai_enabled"
                defaultChecked={c.ai_enabled !== false}
              />{" "}
              有新事件时生成 AI 解读
            </span>
          </Field>
        </div>
        <p className="notice">
          每轮最多 3
          次数据调用。任务入队预留预算，结束退回未用部分；手动与自动巡检共用本监控的
          UTC 自然月预算。新建监控会启用定时巡检；规则修改在下一轮生效。
        </p>
        <div className="actions">
          <Button disabled={busy}>
            {busy ? "正在保存…" : item ? "保存规则" : "保存并启用"}
          </Button>
          <Button type="button" secondary onClick={onClose}>
            取消
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
