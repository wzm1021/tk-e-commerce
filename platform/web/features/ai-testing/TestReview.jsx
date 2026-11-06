import { useState, Fragment } from "react";
import { Button, ErrorBox } from "../../components/ui.jsx";
import { Dialog } from "../../components/Dialog.jsx";
import {
  fields,
  configurationFacts,
  imageUrl,
  valueOf,
  showValue,
  warningText,
} from "./model.mjs";
export function TestReview({
  review,
  data,
  workspace,
  busy,
  onClose,
  onSubmit,
  error,
}) {
  const [confirmed, setConfirmed] = useState(false),
    estimate = review.estimate;
  return (
    <Dialog title="确认本次 AI 测品" wide onClose={onClose}>
      <div className="ai-testing">
        <ErrorBox error={error} />
        <div className="ai-note">
          请逐项核对自动填写的信息和各方案截图，确认页面上的规格、价格、币种、配送地区一致。需要修改时返回编辑。
          <small>
            本次成功测试扣 1 次。点击“确认并开始测试”后预留，失败或取消后退回。
          </small>
        </div>
        <dl className="ai-facts">
          {Object.entries(configurationFacts(data)).map(([k, v]) => (
            <Fragment key={k}>
              <dt>{k}</dt>
              <dd>{showValue(v)}</dd>
            </Fragment>
          ))}
        </dl>
        <div className="ai-grid">
          {review.effective_arms.map((a) => (
            <article className="ai-card" key={a.id}>
              <h3>
                {a.id} · {a.label}
              </h3>
              <p>
                {a.id === "A"
                  ? "对照商品"
                  : a.other_product
                    ? "另一款商品"
                    : "同款商品的页面方案"}
              </p>
              <a
                href={imageUrl(
                  review.images.find((i) => i.arm === a.id).artifact_id,
                  workspace,
                )}
                target="_blank"
                rel="noreferrer"
              >
                <img
                  className="ai-shot"
                  src={imageUrl(
                    review.images.find((i) => i.arm === a.id).artifact_id,
                    workspace,
                  )}
                  alt={a.id + " 待确认截图"}
                />
              </a>
              <dl className="ai-facts">
                {Object.entries({
                  ...fields,
                  url: "页面链接",
                  product_id: "商品 ID",
                  change_summary: "变化说明",
                }).map(([k, l]) => (
                  <Fragment key={k}>
                    <dt>
                      {l}
                      {a.inherit.includes(k) ? "（沿用 A）" : ""}
                    </dt>
                    <dd>
                      {showValue(
                        ["url", "product_id", "change_summary"].includes(k)
                          ? a[k]
                          : valueOf(a, k),
                      )}
                    </dd>
                  </Fragment>
                ))}
              </dl>
            </article>
          ))}
        </div>
        <p>
          符合受众筛选的人数：{estimate.audience?.eligible ?? "待核验"}；预计{" "}
          {estimate.eta_minutes?.typical ?? "—"} 分钟。
        </p>
        {(estimate.data_gaps?.length > 0 ||
          estimate.scope_warnings?.length > 0) && (
          <div className="ai-note">
            <strong>信息缺口与结论范围</strong>
            <ul className="ai-warnings">
              {[
                ...(estimate.data_gaps || []),
                ...(estimate.scope_warnings || []),
              ].map((v, i) => (
                <li key={i}>{warningText(v)}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="muted">
          结果来自 AI
          虚拟消费者的意图模拟，用于提出假设与安排真实验证，不预测真实订单或销量。商品卖点与场景描述不保证进入每轮模拟。
        </p>
        <label className="ai-check">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          我已核对并确认全部信息、继承关系和页面截图，允许按当前版本开始测试。
        </label>
        <div className="ai-actions">
          <Button secondary disabled={busy} onClick={onClose}>
            返回修改
          </Button>
          <Button
            disabled={busy || !confirmed || !estimate.ready}
            onClick={onSubmit}
          >
            {busy ? "正在提交…" : "确认并开始测试"}
          </Button>
        </div>
        {!estimate.ready && (
          <p role="alert">当前信息或受众条件尚不满足要求，请返回修改。</p>
        )}
      </div>
    </Dialog>
  );
}
