import { randomId } from "../../lib/client-id.mjs";
import { useState } from "react";
import { Plus } from "lucide-react";
import { useLoad } from "../../hooks/useLoad.mjs";
import { Button, Field, Badge, ErrorBox } from "../../components/ui.jsx";
import { Dialog } from "../../components/Dialog.jsx";
import { Select } from "../../components/Select.jsx";
import { money, datetime } from "../../lib/format.mjs";
import { AdminForm } from "./AdminForm.jsx";

export function BillingPanel({ api, workspace, version, reload }) {
  const { data, error } = useLoad(
      api,
      "/api/admin/workspaces/" + workspace,
      version,
    ),
    { data: invocations } = useLoad(
      api,
      `/api/admin/workspaces/${workspace}/invocations`,
      version,
    );
  const [credit, setCredit] = useState(false),
    [currency, setCurrency] = useState("model_micro_cny"),
    [resolve, setResolve] = useState(null);
  return (
    <>
      <ErrorBox error={error} />
      <div className="section-line">
        <h2>租户余额</h2>
        <Button onClick={() => setCredit(true)}>
          <Plus size={16} />
          登记入账
        </Button>
      </div>
      <div className="metric-grid three">
        {["model_micro_cny", "data_points", "ai_test_uses"].map((k) => {
          const w = data?.wallets.find((x) => x.currency === k);
          return (
            <div key={k}>
              <small>
                {k === "model_micro_cny"
                  ? "模型可用余额"
                  : k === "ai_test_uses"
                    ? "可用测品次数"
                    : "可用数据积分"}
              </small>
              <strong>
                {k === "model_micro_cny"
                  ? "¥ " + money(w?.available)
                  : w?.available || 0}
              </strong>
              <small>
                预留{" "}
                {k === "model_micro_cny"
                  ? "¥ " + money(w?.reserved)
                  : w?.reserved || 0}
              </small>
            </div>
          );
        })}
      </div>
      <section className="panel">
        <h2>任务与费用</h2>
        {data?.jobs.length ? (
          <div className="table-frame">
            <table>
              <thead>
                <tr>
                  <th>任务</th>
                  <th>状态</th>
                  <th>模型费用</th>
                  <th>数据积分</th>
                </tr>
              </thead>
              <tbody>
                {data.jobs.map((j) => (
                  <tr key={j.id}>
                    <td>
                      {j.title}
                      <small>{j.id}</small>
                    </td>
                    <td>
                      <Badge value={j.status} />
                    </td>
                    <td>¥ {money(j.model_spent)}</td>
                    <td>{j.data_spent}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">暂无任务。</p>
        )}
      </section>
      <section className="panel">
        <h2>调用核对</h2>
        <p className="muted">
          调用超时或缺少用量时保留额度。核对供应商账单后，由平台登记最终费用并解除剩余预留。
        </p>
        {invocations?.items.length ? (
          <div className="table-frame">
            <table>
              <thead>
                <tr>
                  <th>调用 ID</th>
                  <th>类型 / 状态</th>
                  <th>采购成本</th>
                  <th>用户费用</th>
                  <th>处理</th>
                </tr>
              </thead>
              <tbody>
                {invocations.items.map((x) => (
                  <tr key={x.id}>
                    <td>
                      {x.id.slice(0, 8)}
                      <small>{datetime(x.created_at)}</small>
                    </td>
                    <td>
                      {x.kind} · {x.state}
                    </td>
                    <td>
                      {x.kind === "model"
                        ? "¥ " + money(x.procurement)
                        : x.procurement + " 积分"}
                    </td>
                    <td>
                      {x.kind === "model"
                        ? "¥ " + money(x.charged)
                        : x.charged + " 积分"}
                    </td>
                    <td>
                      {x.state === "reconciling" ? (
                        <Button secondary onClick={() => setResolve(x)}>
                          核对费用
                        </Button>
                      ) : (
                        "已记录"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">暂无调用。</p>
        )}
      </section>
      <section className="panel">
        <h2>余额流水</h2>
        {data?.ledger.map((r) => (
          <div className="job-row" key={r.id}>
            <span>{datetime(r.created_at)}</span>
            <strong>{r.operation}</strong>
            <span>
              {r.currency === "model_micro_cny"
                ? "¥ " + money(r.amount)
                : r.amount +
                  (r.currency === "ai_test_uses" ? " 次测品" : " 积分")}
            </span>
            <small>{r.detail.reason || r.reference.slice(0, 8)}</small>
          </div>
        ))}
      </section>
      {credit && (
        <Dialog title="登记租户入账" onClose={() => setCredit(false)}>
          <AdminForm
            api={api}
            path={`/api/admin/workspaces/${workspace}/credit`}
            onSaved={() => {
              setCredit(false);
              reload();
            }}
            convert={(f) => ({
              currency,
              amount: f.get("amount"),
              reference: f.get("reference"),
              reason: f.get("reason"),
              type: f.get("type"),
            })}
          >
            <Field label="入账类型">
              <Select
                variant="box"
                name="type"
                options={[
                  { value: "sponsored_test", title: "平台赠送 / 测试额度" },
                  { value: "manual_paid", title: "已核实的人工收款" },
                ]}
              />
            </Field>
            <Field label="余额类型">
              <Select
                variant="box"
                value={currency}
                onChange={setCurrency}
                options={[
                  { value: "model_micro_cny", title: "模型余额（元）" },
                  { value: "data_points", title: "数据积分" },
                  { value: "ai_test_uses", title: "测品次数（次）" },
                ]}
              />
            </Field>
            <Field
              label={
                currency === "model_micro_cny"
                  ? "金额（元）"
                  : currency === "ai_test_uses"
                    ? "测品次数"
                    : "积分数量"
              }
              hint={
                currency === "data_points"
                  ? "填写实际积分数，例如 100 或 100.3，最多一位小数"
                  : undefined
              }
            >
              <input
                name="amount"
                type="number"
                min={
                  currency === "ai_test_uses"
                    ? "1"
                    : currency === "model_micro_cny"
                      ? "0.01"
                      : "0.1"
                }
                max={currency !== "model_micro_cny" ? "1000000" : undefined}
                step={
                  currency === "ai_test_uses"
                    ? "1"
                    : currency === "model_micro_cny"
                      ? "0.01"
                      : "0.1"
                }
                required
              />
            </Field>
            <Field label="收款 / 赠送凭据号" hint="相同凭据号只入账一次">
              <input
                name="reference"
                defaultValue={randomId()}
                minLength={12}
                required
              />
            </Field>
            <Field label="说明">
              <textarea name="reason" minLength={3} required />
            </Field>
          </AdminForm>
        </Dialog>
      )}
      {resolve && (
        <Dialog title="核对调用费用" onClose={() => setResolve(null)}>
          <div className="notice">
            须先结束原执行租约，并有供应商账单依据。内部金额单位：1 元 =
            1,000,000 微元；数据调用使用积分。
          </div>
          <AdminForm
            api={api}
            path={`/api/admin/workspaces/${workspace}/invocations/${resolve.id}/resolve`}
            onSaved={() => {
              setResolve(null);
              reload();
            }}
            convert={(f) => Object.fromEntries(f)}
          >
            <Field label="确认向用户收取的微元 / 积分">
              <input
                name="charged"
                type="number"
                min="0"
                max={resolve.reserved}
                step={resolve.kind === "data" ? "0.1" : "1"}
                required
              />
            </Field>
            <Field label="实际采购成本（微元 / 积分）">
              <input
                name="procurement"
                type="number"
                min="0"
                step={resolve.kind === "data" ? "0.1" : "1"}
                required
              />
            </Field>
            <Field label="供应商账单 / 请求凭据">
              <input name="provider_reference" minLength={5} required />
            </Field>
            <Field label="核对说明">
              <textarea name="note" minLength={5} required />
            </Field>
          </AdminForm>
        </Dialog>
      )}
    </>
  );
}
