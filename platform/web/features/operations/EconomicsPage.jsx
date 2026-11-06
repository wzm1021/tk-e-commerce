import { randomId } from "../../lib/client-id.mjs";
import React, { useState } from "react";
import { Plus } from "lucide-react";

import { PageTitle } from "../../components/PageTitle.jsx";
import {
  Button,
  Field,
  Badge,
  Empty,
  ErrorBox,
  Loading,
  JsonView,
} from "../../components/ui.jsx";
import { Dialog } from "../../components/Dialog.jsx";
import { Select } from "../../components/Select.jsx";

import { today, choices } from "./helpers.mjs";
import { useRecords } from "../../hooks/useRecords.mjs";
import { SaveForm } from "./SaveForm.jsx";
const categories = [
  ["procurement", "商品采购"],
  ["domestic_shipping", "国内运费"],
  ["packaging", "包装"],
  ["fulfillment", "履约"],
  ["duties_taxes", "关税税费"],
  ["creator_commission", "达人佣金"],
  ["advertising", "广告"],
  ["returns_losses", "退货损耗"],
  ["other", "其他"],
];
function CostRow({ kind, label }) {
  const [status, setStatus] = useState("unknown");
  const active = ["confirmed", "estimated"].includes(status);
  return (
    <div className="cost-row">
      <strong>{label}</strong>
      <Select
        variant="box"
        size="sm"
        name={kind + "_status"}
        value={status}
        onChange={setStatus}
        ariaLabel={label + "状态"}
        options={[
          { value: "unknown", title: "待补" },
          { value: "confirmed", title: "已确认" },
          { value: "estimated", title: "估算" },
          { value: "not_applicable", title: "不适用" },
          { value: "excluded", title: "明确排除" },
        ]}
      />
      <input
        name={kind + "_amount"}
        type="number"
        min="0"
        step="0.01"
        disabled={!active}
        required={active}
        placeholder="金额"
        aria-label={label + "金额"}
      />
      <Select
        variant="box"
        size="sm"
        name={kind + "_currency"}
        ariaLabel={label + "币种"}
        options={[
          { value: "CNY", title: "CNY" },
          { value: "USD", title: "USD" },
        ]}
      />
      <input
        name={kind + "_source"}
        placeholder={status === "unknown" ? "待补说明" : "证据或不适用原因"}
        required={status !== "unknown"}
        aria-label={label + "来源"}
      />
    </div>
  );
}
function EconomicsForm({
  api,
  opportunities,
  suppliers,
  measurements,
  rates,
  onSaved,
}) {
  const [supplierId, setSupplierId] = useState("");
  const chosen = suppliers.find((x) => x.id === supplierId);
  return (
    <SaveForm
      api={api}
      kind="economics"
      onSaved={onSaved}
      convert={(f) => {
        if (!chosen) throw new Error("请先选择货源");
        const input = {
          schema_version: 1,
          case_id: randomId(),
          as_of: f.get("as_of"),
          market: f.get("market"),
          base_currency: "USD",
          currency_decimals: 2,
          sales: {
            item_revenue: Number(f.get("item_revenue")),
            buyer_shipping_revenue: Number(f.get("buyer_shipping_revenue")),
            units_per_order: Number(f.get("units_per_order")),
          },
          platform_fee: { rate: Number(f.get("fee")) / 100 },
          fx_rates: [
            {
              currency: "CNY",
              rate_to_base: Number(f.get("fx")),
              as_of: f.get("fx_date"),
              source: f.get("fx_source"),
            },
          ],
          costs: categories.map(([k]) => ({
            category: k,
            status: f.get(k + "_status"),
            amount: ["confirmed", "estimated"].includes(f.get(k + "_status"))
              ? Number(f.get(k + "_amount"))
              : f.get(k + "_status") === "unknown"
                ? null
                : 0,
            currency: f.get(k + "_currency"),
            basis: k === "procurement" ? "per_sale_unit" : "per_order",
            source: f.get(k + "_source") || "待补",
          })),
        };
        return {
          title: f.get("title"),
          opportunity_id: chosen.data.opportunity_id,
          supplier_id: supplierId,
          measurement_id: f.get("measurement_id"),
          rate_card_id: f.get("rate_card_id"),
          input,
        };
      }}
    >
      <div className="form-grid">
        <Field label="方案名称" wide>
          <input
            name="title"
            required
            placeholder="例如：单件款 · 实测包装 · US 标准线路"
          />
        </Field>
        <Field label="货源与 SKU" wide>
          <Select
            variant="box"
            value={supplierId}
            onChange={setSupplierId}
            options={[
              { value: "", title: "选择货源" },
              ...choices(
                suppliers,
                (r) =>
                  (opportunities.find((o) => o.id === r.data.opportunity_id)
                    ?.data.title || "商品") +
                  " · " +
                  r.data.sku_description,
              ),
            ]}
          />
        </Field>
        {chosen && (
          <p className="notice wide">
            货源报价 ¥ {chosen.data.price_cny} / 单元，起订 {chosen.data.moq}{" "}
            件；请在下方采购成本中确认本方案采用的价格与依据。
          </p>
        )}
        <Field label="发货包装记录">
          <Select
            variant="box"
            name="measurement_id"
            options={[
              { value: "", title: "选择包装版本" },
              ...choices(
                measurements.filter((m) => m.data.supplier_id === supplierId),
                (r) =>
                  r.data.packaging_version + " · " + r.data.weight_kg + " kg",
              ),
            ]}
          />
        </Field>
        <Field label="物流报价">
          <Select
            variant="box"
            name="rate_card_id"
            options={[
              { value: "", title: "选择有效线路" },
              ...choices(
                rates,
                (r) => r.data.name + " · " + r.data.valid_until,
              ),
            ]}
          />
        </Field>
        <Field label="目的国">
          <Select
            variant="box"
            name="market"
            options={[
              { value: "US", title: "美国" },
              { value: "GB", title: "英国" },
            ]}
          />
        </Field>
        <Field label="测算日期">
          <input name="as_of" type="date" defaultValue={today()} required />
        </Field>
        {[
          ["item_revenue", "商品成交收入（USD / 单）", "0.01"],
          ["buyer_shipping_revenue", "买家运费收入（USD / 单）", "0.01"],
          ["units_per_order", "每单销售单元数", "1"],
        ].map(([k, label, step]) => (
          <Field key={k} label={label}>
            <input name={k} type="number" min="0" step={step} required />
          </Field>
        ))}
        <Field label="平台扣点（%）" hint="默认使用你约定的 6%">
          <input
            name="fee"
            type="number"
            min="0"
            max="100"
            step="0.01"
            defaultValue="6"
            required
          />
        </Field>
        <Field label="1 元人民币折合美元">
          <input
            name="fx"
            type="number"
            min="0.000001"
            step="0.000001"
            required
          />
        </Field>
        <Field label="采购测算汇率日期">
          <input name="fx_date" type="date" required />
        </Field>
        <Field label="采购测算汇率来源" wide hint="与平台模型计费汇率分别记录">
          <input name="fx_source" required />
        </Field>
      </div>
      <h3>各项成本及状态</h3>
      <p className="muted">
        采购按每销售单元，其余按每订单。缺失费用保留待补；确认不适用或排除时请写明依据。
      </p>
      <div className="cost-list">
        {categories.map(([k, label]) => (
          <CostRow key={k} kind={k} label={label} />
        ))}
      </div>
    </SaveForm>
  );
}
export function EconomicsPage({ api, version, reload }) {
  const [form, setForm] = useState(false),
    [inspect, setInspect] = useState(null),
    [selected, setSelected] = useState([]);
  const { data, error } = useRecords(api, "economics", version),
    { data: op } = useRecords(api, "opportunity", version),
    { data: sup } = useRecords(api, "supplier", version),
    { data: ms } = useRecords(api, "measurement", version),
    { data: rates } = useRecords(api, "rate_card", version);
  return (
    <>
      <PageTitle
        eyebrow="UNIT ECONOMICS"
        title="利润测算"
        description="结合真实 SKU、包装和运费规则，计算预计单件贡献利润。"
      >
        <Button onClick={() => setForm(true)}>
          <Plus size={16} />
          新建成本方案
        </Button>
      </PageTitle>
      <ErrorBox error={error} />
      <div className="notice">
        完整成本缺失时只列已知成本和待补项。利润是预计贡献利润，测样与报价变化后请新增方案保留对比。
      </div>
      {!data ? (
        <Loading />
      ) : !data.items.length ? (
        <Empty title="先建立一个可复算的成本方案">
          请先在“货源与测样”中录入货源、包装记录和物流报价。
        </Empty>
      ) : (
        <>
          <div className="table-frame">
            <table>
              <thead>
                <tr>
                  <th>对比</th>
                  <th>方案</th>
                  <th>预计贡献利润 / 单</th>
                  <th>贡献利润率</th>
                  <th>状态</th>
                  <th>明细</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={"对比 " + r.data.title}
                        checked={selected.includes(r.id)}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, r.id]
                              : selected.filter((x) => x !== r.id),
                          )
                        }
                      />
                    </td>
                    <td>
                      {r.data.title}
                      <small>{r.data.input.as_of}</small>
                    </td>
                    <td>
                      {r.data.result.contribution_profit_per_order === null
                        ? "待补成本"
                        : "$ " + r.data.result.contribution_profit_per_order}
                    </td>
                    <td>
                      {r.data.result.contribution_margin === null
                        ? "—"
                        : (r.data.result.contribution_margin * 100).toFixed(1) +
                          "%"}
                    </td>
                    <td>
                      <Badge
                        value={
                          r.data.result.status === "incomplete"
                            ? "waiting_input"
                            : "succeeded"
                        }
                      />
                    </td>
                    <td>
                      <Button secondary onClick={() => setInspect(r)}>
                        查看计算依据
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selected.length > 1 && (
            <section className="panel">
              <h2>方案对比</h2>
              <div className="comparison-grid">
                {data.items
                  .filter((r) => selected.includes(r.id))
                  .map((r) => (
                    <div key={r.id}>
                      <h3>{r.data.title}</h3>
                      <strong>
                        {r.data.result.contribution_margin === null
                          ? "成本待补"
                          : (r.data.result.contribution_margin * 100).toFixed(
                              1,
                            ) + "%"}
                      </strong>
                      <p>
                        {r.data.result.blockers.join("；") || "成本已完整声明"}
                      </p>
                    </div>
                  ))}
              </div>
            </section>
          )}
        </>
      )}
      {form && (
        <Dialog title="新建利润测算方案" onClose={() => setForm(false)} wide>
          <EconomicsForm
            api={api}
            opportunities={op?.items || []}
            suppliers={sup?.items || []}
            measurements={ms?.items || []}
            rates={rates?.items || []}
            onSaved={(r) => {
              setForm(false);
              setInspect(r);
              reload();
            }}
          />
        </Dialog>
      )}
      {inspect && (
        <Dialog
          title={inspect.data.title}
          onClose={() => setInspect(null)}
          wide
        >
          <div className="metric-grid">
            <div>
              <small>预计贡献利润 / 单</small>
              <strong>
                {inspect.data.result.contribution_profit_per_order === null
                  ? "待补"
                  : "$ " + inspect.data.result.contribution_profit_per_order}
              </strong>
            </div>
            <div>
              <small>贡献利润率</small>
              <strong>
                {inspect.data.result.contribution_margin === null
                  ? "—"
                  : (inspect.data.result.contribution_margin * 100).toFixed(1) +
                    "%"}
              </strong>
            </div>
          </div>
          {inspect.data.result.blockers.length > 0 && (
            <div className="notice">
              待补：{inspect.data.result.blockers.join("；")}
            </div>
          )}
          <h3>计算明细</h3>
          <dl className="record-detail">
            {Object.entries(inspect.data.result)
              .filter(
                ([k, v]) =>
                  !["schema_version", "case_id"].includes(k) &&
                  typeof v !== "object",
              )
              .map(([k, v]) => (
                <React.Fragment key={k}>
                  <dt>
                    {{
                      status: "计算状态",
                      contribution_profit_per_order: "贡献利润 / 单",
                      contribution_profit_per_sale_unit: "贡献利润 / 销售单元",
                      contribution_margin: "贡献利润率",
                      base_currency: "基准币种",
                      measurement_basis: "包装依据",
                      total_revenue_per_order: "收入 / 单",
                      known_cost_total_per_order: "已知成本 / 单",
                      total_cost_per_order: "总成本 / 单",
                    }[k] || k}
                  </dt>
                  <dd>{String(v)}</dd>
                </React.Fragment>
              ))}
          </dl>
          <h3>假设与排除范围</h3>
          <ul>
            {inspect.data.result.assumptions
              .concat(inspect.data.result.exclusions)
              .map((v, i) => (
                <li key={i}>{typeof v === "object" ? JSON.stringify(v) : v}</li>
              ))}
          </ul>
          <details>
            <summary>可复算记录（含固定输入版本）</summary>
            <JsonView value={inspect.data} />
          </details>
        </Dialog>
      )}
    </>
  );
}
