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
} from "../../components/ui.jsx";
import { Dialog } from "../../components/Dialog.jsx";
import { Select } from "../../components/Select.jsx";
import { datetime } from "../../lib/format.mjs";
import { today, choices } from "./helpers.mjs";
import { useRecords } from "../../hooks/useRecords.mjs";
import { SaveForm } from "./SaveForm.jsx";
function SupplierForm({ api, opportunities, onSaved }) {
  return (
    <SaveForm
      api={api}
      kind="supplier"
      onSaved={onSaved}
      convert={(f) => {
        const url = f.get("offer_url");
        const match = new URL(url).pathname.match(/^\/offer\/(\d+)\.html$/);
        if (!match) throw new Error("请填写 1688 商品详情链接");
        return {
          opportunity_id: f.get("opportunity_id"),
          offer_url: url,
          offer_id: match[1],
          sku_id: f.get("sku_id"),
          sku_description: f.get("sku_description"),
          price_cny: Number(f.get("price_cny")),
          moq: Number(f.get("moq")),
          status: f.get("status"),
          source: f.get("source"),
          quoted_at: f.get("quoted_at"),
          notes: f.get("notes"),
        };
      }}
    >
      <div className="form-grid">
        <Field label="对应机会商品" wide>
          <Select
            variant="box"
            name="opportunity_id"
            options={[
              { value: "", title: "选择商品" },
              ...choices(opportunities, (r) => r.data.title),
            ]}
          />
        </Field>
        <Field label="1688 商品详情链接" wide>
          <input
            name="offer_url"
            type="url"
            placeholder="https://detail.1688.com/offer/商品ID.html"
            required
          />
        </Field>
        <Field label="供应 SKU ID">
          <input name="sku_id" required />
        </Field>
        <Field label="报价（元 / 销售单元）">
          <input name="price_cny" type="number" min="0" step="0.01" required />
        </Field>
        <Field label="SKU 规格描述" wide>
          <textarea
            name="sku_description"
            rows={2}
            placeholder="颜色、尺寸、套装数量、材料等"
            required
          />
        </Field>
        <Field label="起订量">
          <input name="moq" type="number" min="1" required />
        </Field>
        <Field label="匹配状态">
          <Select
            variant="box"
            name="status"
            options={[
              { value: "candidate", title: "候选，待核验同款和规格" },
              { value: "confirmed", title: "已人工确认" },
              { value: "rejected", title: "不匹配" },
            ]}
          />
        </Field>
        <Field label="报价日期">
          <input name="quoted_at" type="date" defaultValue={today()} required />
        </Field>
        <Field label="报价来源">
          <input
            name="source"
            placeholder="1688 页面 / 商家书面报价"
            required
          />
        </Field>
        <Field label="补充说明" wide>
          <textarea name="notes" rows={2} />
        </Field>
      </div>
    </SaveForm>
  );
}
function MeasurementForm({ api, suppliers, onSaved }) {
  return (
    <SaveForm
      api={api}
      kind="measurement"
      onSaved={onSaved}
      convert={(f) => ({
        supplier_id: f.get("supplier_id"),
        packaging_version: f.get("packaging_version"),
        weight_kg: Number(f.get("weight_kg")),
        length_cm: Number(f.get("length_cm")),
        width_cm: Number(f.get("width_cm")),
        height_cm: Number(f.get("height_cm")),
        units_per_parcel: Number(f.get("units_per_parcel")),
        basis: f.get("basis"),
        recorded_at: f.get("recorded_at"),
        source: f.get("source"),
      })}
    >
      <div className="notice">
        请测量实际发货包装的毛重和外尺寸。每个包装版本新增一条记录，避免旧测量被覆盖。
      </div>
      <div className="form-grid">
        <Field label="货源与 SKU" wide>
          <Select
            variant="box"
            name="supplier_id"
            options={[
              { value: "", title: "选择货源" },
              ...choices(
                suppliers,
                (r) => r.data.offer_id + " · " + r.data.sku_description,
              ),
            ]}
          />
        </Field>
        <Field label="包装版本">
          <input
            name="packaging_version"
            placeholder="例如：单件泡袋 v1"
            required
          />
        </Field>
        <Field label="数据来源">
          <Select
            variant="box"
            name="basis"
            options={[
              { value: "measured", title: "样品到手，人工实测" },
              { value: "supplier", title: "商家提供，待实测" },
            ]}
          />
        </Field>
        {[
          ["weight_kg", "包装毛重（kg）", "0.001"],
          ["length_cm", "长（cm）", "0.1"],
          ["width_cm", "宽（cm）", "0.1"],
          ["height_cm", "高（cm）", "0.1"],
          ["units_per_parcel", "每包销售单元数", "1"],
        ].map(([k, v, step]) => (
          <Field key={k} label={v}>
            <input name={k} type="number" min={step} step={step} required />
          </Field>
        ))}
        <Field label="记录日期">
          <input
            name="recorded_at"
            type="date"
            defaultValue={today()}
            required
          />
        </Field>
        <Field label="测量人 / 证据说明" wide>
          <input
            name="source"
            required
            placeholder="测量人、秤具或商家资料记录"
          />
        </Field>
      </div>
    </SaveForm>
  );
}
function RateForm({ api, onSaved }) {
  return (
    <SaveForm
      api={api}
      kind="rate_card"
      onSaved={onSaved}
      convert={(f) => ({
        name: f.get("name"),
        currency: f.get("currency"),
        destination: f.get("destination"),
        valid_from: f.get("valid_from"),
        valid_until: f.get("valid_until"),
        source: f.get("source"),
        weight_mode: f.get("weight_mode"),
        volumetric_divisor: Number(f.get("volumetric_divisor")),
        billing_increment_kg: Number(f.get("billing_increment_kg")),
        minimum_billable_kg: Number(f.get("minimum_billable_kg")),
        max_actual_kg: Number(f.get("max_actual_kg")),
        max_billable_kg: Number(f.get("max_billable_kg")),
        max_side_cm: Number(f.get("max_side_cm")),
        package_eligibility_confirmed:
          f.get("package_eligibility_confirmed") === "on",
        pricing: {
          type: "per_kg",
          amount_per_kg: Number(f.get("amount_per_kg")),
        },
        surcharges: {
          fixed_per_parcel: Number(f.get("fixed_per_parcel")),
          fuel_rate: Number(f.get("fuel_rate")) / 100,
          fuel_basis: f.get("fuel_basis"),
        },
      })}
    >
      <div className="notice">
        录入承运人实际提供的每公斤报价。运费按实重 /
        体积重取计费重量，再依步长向上取整。请明确填写零附加费。
      </div>
      <div className="form-grid">
        <Field label="物流线路名称">
          <input name="name" required />
        </Field>
        <Field label="目的国">
          <Select
            variant="box"
            name="destination"
            options={[
              { value: "US", title: "美国" },
              { value: "GB", title: "英国" },
            ]}
          />
        </Field>
        <Field label="报价币种">
          <Select
            variant="box"
            name="currency"
            options={[
              { value: "CNY", title: "人民币 CNY" },
              { value: "USD", title: "美元 USD" },
            ]}
          />
        </Field>
        <Field label="每公斤价格">
          <input
            name="amount_per_kg"
            type="number"
            min="0"
            step="0.01"
            required
          />
        </Field>
        <Field label="有效期开始">
          <input name="valid_from" type="date" required />
        </Field>
        <Field label="有效期结束">
          <input name="valid_until" type="date" required />
        </Field>
        <Field label="计重方式">
          <Select
            variant="box"
            name="weight_mode"
            options={[
              { value: "max_actual_volumetric", title: "实重与体积重取大" },
              { value: "actual", title: "仅实重" },
            ]}
          />
        </Field>
        <Field label="体积系数（cm³/kg）" hint="以合同约定为准">
          <input name="volumetric_divisor" type="number" min="1" required />
        </Field>
        {[
          ["billing_increment_kg", "计重步长（kg）", "0.001"],
          ["minimum_billable_kg", "最低计重（kg）", "0.001"],
          ["max_actual_kg", "最大实重（kg）", "0.001"],
          ["max_billable_kg", "最大计费重（kg）", "0.001"],
          ["max_side_cm", "最长单边（cm）", "0.1"],
          ["fixed_per_parcel", "固定附加费 / 包", "0.01"],
          ["fuel_rate", "燃油附加费（%）", "0.01"],
        ].map(([k, v, step]) => (
          <Field key={k} label={v}>
            <input name={k} type="number" min="0" step={step} required />
          </Field>
        ))}
        <Field label="燃油费基数">
          <Select
            variant="box"
            name="fuel_basis"
            options={[
              { value: "base_freight", title: "基础运费" },
              { value: "base_plus_fixed", title: "基础运费 + 固定附加费" },
            ]}
          />
        </Field>
        <Field label="报价依据" wide>
          <input
            name="source"
            required
            placeholder="报价单名称、承运人及合同版本"
          />
        </Field>
        <label className="check-row wide">
          <input
            name="package_eligibility_confirmed"
            type="checkbox"
            required
          />
          已确认该线路适用于本货物及目的区域
        </label>
      </div>
    </SaveForm>
  );
}
function SourceBatches({ api, version, reload, opportunities }) {
  const { data } = useRecords(api, "source_batch", version);
  const [open, setOpen] = useState(false),
    [selected, setSelected] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const r = await api("/api/supply/batches", {
        method: "POST",
        body: {
          title: f.get("title"),
          tk_urls: f
            .get("urls")
            .split(/\r?\n/)
            .map((x) => x.trim())
            .filter(Boolean),
        },
      });
      setOpen(false);
      setSelected(r);
      reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="section-line">
        <h2>批量 TK 链接</h2>
        <Button secondary onClick={() => setOpen(true)}>
          准备批量货源
        </Button>
      </div>
      <p className="muted">
        先保存选品链接与解析状态。1688 接入完成后，可用同一批次继续找候选货源。
      </p>
      {data?.items.map((r) => (
        <button className="job-row" key={r.id} onClick={() => setSelected(r)}>
          <strong>{r.data.title}</strong>
          <span>
            {r.data.items.length} 条链接<small>{datetime(r.created_at)}</small>
          </span>
          <Badge value="waiting_input" />
        </button>
      ))}
      {open && (
        <Dialog title="准备批量货源链接" onClose={() => setOpen(false)} wide>
          <form onSubmit={save}>
            <Field label="批次名称">
              <input
                name="title"
                defaultValue="选品候选 · 货源匹配批次"
                required
              />
            </Field>
            <Field
              label="TikTok 商品链接，每行一条"
              hint="最多 200 条；短链接会保留为待解析，不自动猜测商品 ID。"
            >
              <textarea
                name="urls"
                rows={10}
                defaultValue={opportunities
                  .map((o) => o.data.tk_url)
                  .join("\n")}
                required
              />
            </Field>
            <ErrorBox error={error} />
            <div className="dialog-actions">
              <Button disabled={busy}>{busy ? "正在保存…" : "保存批次"}</Button>
            </div>
          </form>
        </Dialog>
      )}
      {selected && (
        <Dialog
          title={selected.data.title}
          onClose={() => setSelected(null)}
          wide
        >
          <div className="notice">{selected.data.notice}</div>
          <div className="table-frame">
            <table>
              <thead>
                <tr>
                  <th>TK 链接</th>
                  <th>商品 ID</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {selected.data.items.map((x, i) => (
                  <tr key={i}>
                    <td className="break-all">{x.original}</td>
                    <td>{x.product_id || "—"}</td>
                    <td>{x.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Dialog>
      )}
    </section>
  );
}
export function SupplyPage({ api, version, reload }) {
  const [tab, setTab] = useState("supplier"),
    [form, setForm] = useState(null),
    [inspect, setInspect] = useState(null);
  const { data: op } = useRecords(api, "opportunity", version),
    { data: supply, error } = useRecords(api, "supplier", version),
    { data: measure } = useRecords(api, "measurement", version),
    { data: rates } = useRecords(api, "rate_card", version);
  const lists = {
    supplier: supply?.items,
    measurement: measure?.items,
    rate_card: rates?.items,
  };
  const onSaved = () => {
    setForm(null);
    reload();
  };
  return (
    <>
      <PageTitle
        eyebrow="SUPPLY & SAMPLES"
        title="货源与测样"
        description="把 TK 商品、1688 货源、供应 SKU 与真实发货包装逐一对齐。"
      >
        <Button onClick={() => setForm(tab)}>
          <Plus size={16} />
          {
            {
              supplier: "录入货源",
              measurement: "新增包装记录",
              rate_card: "录入物流报价",
            }[tab]
          }
        </Button>
      </PageTitle>
      <div className="notice">
        1688
        自动图片搜货及详情接口仍待完整文档和授权配置。现在可人工录入候选货源、核验
        SKU、回填测样，后续接入后沿用这些记录。
      </div>
      <div className="tabs">
        {[
          ["supplier", "候选货源"],
          ["measurement", "包装测量"],
          ["rate_card", "物流报价"],
        ].map(([k, v]) => (
          <button
            key={k}
            className={tab === k ? "active" : ""}
            onClick={() => setTab(k)}
          >
            {v}
            <span>{lists[k]?.length || 0}</span>
          </button>
        ))}
      </div>
      <ErrorBox error={error} />
      {!lists[tab] ? (
        <Loading />
      ) : !lists[tab].length ? (
        <Empty
          title={
            {
              supplier: "还没有候选货源",
              measurement: "把实测数据留下来",
              rate_card: "录入一份有效物流报价",
            }[tab]
          }
        >
          从右上角新增记录。货源需要关联机会池商品，测量需要关联供应 SKU。
        </Empty>
      ) : (
        <div className="table-frame">
          <table>
            <thead>
              <tr>
                <th>
                  {tab === "supplier"
                    ? "货源 / SKU"
                    : tab === "measurement"
                      ? "包装版本"
                      : "线路名称"}
                </th>
                <th>关键数据</th>
                <th>来源 / 状态</th>
                <th>记录</th>
              </tr>
            </thead>
            <tbody>
              {lists[tab].map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>
                      {tab === "supplier"
                        ? row.data.sku_description
                        : tab === "measurement"
                          ? row.data.packaging_version
                          : row.data.name}
                    </strong>
                    <small>
                      {tab === "supplier"
                        ? row.data.offer_id
                        : tab === "measurement"
                          ? row.data.supplier_id.slice(0, 8)
                          : row.data.destination}
                    </small>
                  </td>
                  <td>
                    {tab === "supplier" ? (
                      <>
                        ¥ {row.data.price_cny}
                        <small>起订 {row.data.moq} 件</small>
                      </>
                    ) : tab === "measurement" ? (
                      <>
                        {row.data.weight_kg} kg
                        <small>
                          {row.data.length_cm} × {row.data.width_cm} ×{" "}
                          {row.data.height_cm} cm
                        </small>
                      </>
                    ) : (
                      <>
                        {row.data.currency} {row.data.pricing.amount_per_kg} /
                        kg
                        <small>
                          {row.data.valid_from} 至 {row.data.valid_until}
                        </small>
                      </>
                    )}
                  </td>
                  <td>
                    {tab === "supplier" ? (
                      <Badge value={row.data.status} />
                    ) : tab === "measurement" ? (
                      row.data.basis === "measured" ? (
                        "人工实测"
                      ) : (
                        "商家数据"
                      )
                    ) : (
                      row.data.source
                    )}
                  </td>
                  <td>
                    <Button secondary onClick={() => setInspect(row)}>
                      查看详情
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <SourceBatches
        api={api}
        version={version}
        reload={reload}
        opportunities={op?.items || []}
      />
      {form && (
        <Dialog
          title={
            {
              supplier: "录入候选货源",
              measurement: "新增包装测量",
              rate_card: "录入物流报价",
            }[form]
          }
          onClose={() => setForm(null)}
          wide
        >
          {form === "supplier" ? (
            <SupplierForm
              api={api}
              opportunities={op?.items || []}
              onSaved={onSaved}
            />
          ) : form === "measurement" ? (
            <MeasurementForm
              api={api}
              suppliers={supply?.items || []}
              onSaved={onSaved}
            />
          ) : (
            <RateForm api={api} onSaved={onSaved} />
          )}
        </Dialog>
      )}
      {inspect && (
        <Dialog title="记录详情" onClose={() => setInspect(null)}>
          <dl className="record-detail">
            {Object.entries(inspect.data).map(([k, v]) => (
              <React.Fragment key={k}>
                <dt>
                  {{
                    offer_id: "货品 ID",
                    offer_url: "货源链接",
                    sku_id: "SKU ID",
                    sku_description: "SKU 规格",
                    price_cny: "采购价（元）",
                    moq: "起订量",
                    status: "匹配状态",
                    source: "来源",
                    quoted_at: "报价日期",
                    notes: "备注",
                    packaging_version: "包装版本",
                    weight_kg: "毛重 kg",
                    length_cm: "长 cm",
                    width_cm: "宽 cm",
                    height_cm: "高 cm",
                    basis: "测量依据",
                    recorded_at: "记录日期",
                    units_per_parcel: "每包单元数",
                  }[k] || k}
                </dt>
                <dd>{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
              </React.Fragment>
            ))}
          </dl>
        </Dialog>
      )}
    </>
  );
}
