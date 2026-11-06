import { useState } from "react";
import {
  ModelPicker,
  effectiveModel,
  availableModels,
} from "../accounts/ModelPicker.jsx";
import { useLoad } from "../../hooks/useLoad.mjs";
import { PageTitle } from "../../components/PageTitle.jsx";
import { ErrorBox, Loading } from "../../components/ui.jsx";
import { money, datetime } from "../../lib/format.mjs";
import { DataPricing } from "../../components/DataPricing.jsx";

export function WalletPage({ api, version }) {
  const { data, error } = useLoad(api, "/api/wallet", version);
  const { data: catalog } = useLoad(api, "/api/catalog", version);
  const [modelId, setModelId] = useState("");
  const model = data?.wallets.find((x) => x.currency === "model_micro_cny"),
    points = data?.wallets.find((x) => x.currency === "data_points"),
    tests = data?.wallets.find((x) => x.currency === "ai_test_uses");
  const price = availableModels(catalog).find(
    (x) => x.id === effectiveModel(catalog, modelId),
  )?.price;
  return (
    <>
      <PageTitle
        eyebrow="BALANCE & USAGE"
        title="余额与用量"
        description="模型按实际用量结算；TikTok 实时取数按接口档位扣费，快照命中仍为 0.3 积分。"
      />
      <ErrorBox error={error} />
      <div className="metric-grid three">
        <div>
          <small>模型可用余额</small>
          <strong>¥ {model && !error ? money(model.available) : "—"}</strong>
          <small>
            调用中预留 ¥ {model && !error ? money(model.reserved) : "—"}
          </small>
        </div>
        <div>
          <small>可用数据积分</small>
          <strong>{!error ? (points?.available ?? "—") : "—"}</strong>
          <small>
            调用中预留 {!error ? (points?.reserved ?? "—") : "—"} 积分
          </small>
        </div>
        <div>
          <small>可用测品次数</small>
          <strong>{data && !error ? (tests?.available ?? 0) : "—"} 次</strong>
          <small>
            测试中预留 {data && !error ? (tests?.reserved ?? 0) : "—"} 次
          </small>
        </div>
      </div>
      <section className="panel">
        <h2>当前计费规则</h2>
        <p>
          AI 测品每次成功测试扣 1
          次。提交时预留，失败或取消后退回；状态待核对时保持预留。
        </p>
        <ModelPicker catalog={catalog} value={modelId} onChange={setModelId} />
        {price ? (
          <>
            <div className="price-grid">
              {[
                ["input", "输入"],
                ["output", "输出"],
                ["cache_read", "缓存读取"],
                ["cache_write", "缓存写入"],
              ].map(([k, v]) => (
                <div key={k}>
                  <small>{v} / 百万 token</small>
                  <strong>¥ {Number(price.rates[k]).toFixed(3)}</strong>
                  {price.peak_rates ? (
                    <small>
                      高峰 ¥ {Number(price.peak_rates[k]).toFixed(3)} · 空闲 ¥{" "}
                      {(
                        Number(price.peak_rates[k]) *
                        Number(price.time_pricing.off_peak_discount)
                      ).toFixed(3)}
                    </small>
                  ) : null}
                </div>
              ))}
            </div>
            <p className="muted">
              人民币直接计价，单价单位为元 / 百万
              token。价格规则在任务开始时固定，缓存写入的实际计费须以已核验的供应商用量口径为准。
            </p>
            {price.time_pricing ? (
              <p className="muted">
                当前价格：
                {price.time_pricing.current_period === "peak" ? "高峰" : "空闲"}
                。北京时间{price.time_pricing.peak_hours}{" "}
                为高峰，其余为空闲；按每次请求发出时间选择时段，并按高峰价短暂预留本次调用费用。
              </p>
            ) : null}
          </>
        ) : (
          <p>模型价格表尚未配置。</p>
        )}
        <DataPricing price={catalog?.data_price} />
        <p className="muted">
          默认复用最近 15 分钟的相同查询，后台可按接口调整有效期。
        </p>
        <div className="notice">
          内测期由平台后台登记充值或测试赠送。暂未接入在线支付；请联系平台管理员。
        </div>
      </section>
      <section className="panel">
        <h2>余额流水</h2>
        {!data ? (
          <Loading />
        ) : !data.ledger.length ? (
          <p className="muted">暂无余额流水。</p>
        ) : (
          <div className="table-frame">
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>类型</th>
                  <th>金额 / 积分 / 次数</th>
                  <th>操作</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                {data.ledger.map((r) => (
                  <tr key={r.id}>
                    <td>{datetime(r.created_at)}</td>
                    <td>
                      {r.currency === "ai_test_uses"
                        ? "测品次数"
                        : r.currency === "data_points"
                          ? "数据积分"
                          : "模型余额"}
                    </td>
                    <td>
                      {r.currency === "ai_test_uses"
                        ? r.amount + " 次"
                        : r.currency === "data_points"
                          ? r.amount
                          : "¥ " + money(r.amount)}
                    </td>
                    <td>
                      {
                        {
                          credit: "入账",
                          reserve: "预留",
                          charge: "消费",
                          release: "解除预留",
                        }[r.operation]
                      }
                    </td>
                    <td>{r.detail.reason || r.reference.slice(0, 8)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
