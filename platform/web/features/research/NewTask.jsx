import { PLATFORMS, MARKET_NAMES } from "../../lib/platforms.mjs";
import { randomId } from "../../lib/client-id.mjs";
import { useState, useRef } from "react";
import { ArrowUpRight } from "lucide-react";
import { Button, Field, ErrorBox } from "../../components/ui.jsx";
import { Dialog } from "../../components/Dialog.jsx";
import { Select } from "../../components/Select.jsx";
import { jobLabels } from "../../lib/format.mjs";
import { ModelPicker } from "../accounts/ModelPicker.jsx";

const EXAMPLE_RULES =
  "优先研究市场需求较大、同款竞争较少、评价较好且有利润空间的商品；也关注近期上架、近 7 天订单超过 100 且趋势上升的新品。参考：同类市场 GMV 1 万美元以上、同款活跃卖家不超过 5 家、评分 4.2 以上、贡献利润率 30% 以上。结合实际证据说明机会、风险和测试建议，数据不足时说明局限。";

export function NewTask({
  api,
  catalog,
  initialKind = "scouting",
  initialPlatform = "tiktok",
  target = "",
  initialMarket = "US",
  question = "",
  onClose,
  onCreated,
}) {
  const submission = useRef(null);
  const platform = initialPlatform;
  const spec = PLATFORMS[platform];
  const [modelId, setModelId] = useState("");
  const [selectionRules, setSelectionRules] = useState("");
  const [kind, setKind] = useState(initialKind),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    const request =
      kind === "scouting"
        ? {
            platform,
            market: f.get("market"),
            category: f.get("category"),
            lookback_days: Number(f.get("lookback_days")),
            candidate_count: Number(f.get("candidate_count")),
            selection_rules: f.get("selection_rules"),
            notes: f.get("notes"),
          }
        : {
            market: f.get("market"),
            target: f.get("target"),
            lookback_days: Number(f.get("lookback_days")),
            question: f.get("question"),
            notes: f.get("notes"),
          };
    try {
      const body = {
        kind,
        title: f.get("title"),
        request,
        model_connection_id: f.get("model_connection_id"),
      };
      const fingerprint = JSON.stringify(body);
      if (submission.current?.fingerprint !== fingerprint)
        submission.current = { fingerprint, key: randomId() };
      const j = await api("/api/jobs", {
        method: "POST",
        body: {
          ...body,
          idempotency_key: submission.current.key,
        },
      });
      onCreated(j);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={`创建${spec.label}研究任务`} onClose={onClose} wide>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="研究类型">
            <Select
              variant="box"
              ariaLabel="研究类型"
              value={kind}
              onChange={setKind}
              options={Object.entries(jobLabels)
                .filter(([k]) =>
                  platform === "amazon"
                    ? k === "scouting"
                    : !["assistant", "monitoring"].includes(k),
                )
                .map(([k, v]) => ({ value: k, title: v }))}
            />
          </Field>
          <Field label="任务名称">
            <input
              key={kind}
              name="title"
              defaultValue={
                kind === "scouting"
                  ? `${spec.label} · 家居收纳选品研究`
                  : jobLabels[kind]
              }
              required
              maxLength={160}
            />
          </Field>
          <Field label="市场">
            <Select
              variant="box"
              name="market"
              ariaLabel="市场"
              defaultValue={initialMarket}
              options={spec.markets.map((value) => ({
                value,
                title: `${MARKET_NAMES[value]} · ${value}`,
              }))}
            />
          </Field>
          <Field label="研究时间范围">
            <Select
              variant="box"
              name="lookback_days"
              ariaLabel="研究时间范围"
              defaultValue={platform === "amazon" ? "30" : "28"}
              options={spec.windows.map((days) => ({
                value: String(days),
                title: `最近 ${days} 天`,
              }))}
            />
          </Field>
          {kind === "scouting" ? (
            <>
              <Field label="品类边界" wide>
                <input
                  name="category"
                  defaultValue={target || "家居收纳 / 浴室用品"}
                  required
                />
              </Field>
              <Field label="候选商品数量">
                <input
                  name="candidate_count"
                  type="number"
                  min="1"
                  max="200"
                  defaultValue="5"
                  required
                />
              </Field>
              <div className="wide">
                <Field label="选品规则（可选）">
                  <textarea
                    name="selection_rules"
                    rows={6}
                    maxLength={6000}
                    value={selectionRules}
                    onChange={(e) => setSelectionRules(e.target.value)}
                    placeholder="描述你关注的市场机会、新品特征、价格或利润预期；留空时按品类做综合机会分析。"
                  />
                  <small>
                    模型会结合你的规则与实际数据给出推荐、风险和测试建议；指标缺失会说明，不作逐项通过或淘汰判定。
                  </small>
                </Field>
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    setSelectionRules(
                      platform === "amazon"
                        ? "结合估算月销量、销量趋势、关键词需求、BSR、品牌集中度、价格带和评论痛点寻找差异化机会。父子 ASIN 去重，区分销量估算与事实；FBA、采购、广告和退货费用未核验时保留利润待测，不套用 TK 订单门槛。"
                        : EXAMPLE_RULES,
                    )
                  }
                >
                  填入示例规则
                </button>
              </div>
            </>
          ) : (
            <>
              <Field label="目标商品 / 店铺 / 视频链接或 ID" wide>
                <input
                  name="target"
                  defaultValue={target}
                  placeholder="填写要研究的明确对象"
                  required
                />
              </Field>
              <Field label="这次想解决什么问题？" wide>
                <textarea
                  name="question"
                  defaultValue={question}
                  required
                  rows={3}
                  placeholder="例如：竞店最近增长来自哪些商品和内容？有哪些可验证的动作？"
                />
              </Field>
            </>
          )}
          <Field label="补充约束" wide>
            <textarea
              name="notes"
              rows={2}
              placeholder="价格带、供货限制、已有发现等"
            />
          </Field>
        </div>
        <ModelPicker catalog={catalog} value={modelId} onChange={setModelId} />
        <p className="muted">
          按所选模型与实际数据用量从当前空间共享额度结算，用量可在设置中查看。
        </p>
        <ErrorBox error={error} />
        <div className="dialog-actions">
          <Button type="button" secondary onClick={onClose}>
            取消
          </Button>
          <Button disabled={busy}>
            {busy ? "正在提交…" : "开始研究"}
            <ArrowUpRight size={16} />
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
