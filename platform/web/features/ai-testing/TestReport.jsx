import { Fragment, useEffect, useState } from "react";
import { Dialog } from "../../components/Dialog.jsx";
import { Button, ErrorBox } from "../../components/ui.jsx";
import { ReportDownload } from "./ReportDownload.jsx";
import {
  configurationFacts,
  fields,
  imageUrl,
  valueOf,
  showValue,
  effective,
} from "./model.mjs";
import {
  list,
  labelOf,
  reportText,
  reasonText,
  chineseSection,
  profileLabels,
  recommendationLabels,
  stabilityLabels,
  confidenceLevel,
} from "./report-content.mjs";
const pct = (v) => (Number.isFinite(v) ? (v * 100).toFixed(1) + "%" : "—");
const pp = (v) =>
  Number.isFinite(v) ? (v * 100).toFixed(1) + " 个百分点" : "—";
const interval = (v) => (Array.isArray(v) ? v.map(pct).join(" – ") : "未提供");
function TextList({ items, text, empty = "未提供相关反馈" }) {
  return list(items).length ? (
    <ul>
      {items.map((v, i) => (
        <li key={i}>{text(v)}</li>
      ))}
    </ul>
  ) : (
    <p className="muted">{empty}</p>
  );
}
function ReasonList({ items, concern, text, translations }) {
  return (
    <ul className="ai-feedback-list">
      {list(items).map((v, i) => {
        const share = concern ? v?.share_of_non_buy : v?.share_of_buy;
        return (
          <li key={i}>
            <span>{reasonText(v, concern, translations)}</span>
            {Number.isFinite(v?.sessions) && (
              <small>
                {v.sessions} 次{concern ? "未购买" : "购买"}反馈
                {Number.isFinite(share)
                  ? ` · 占${concern ? "未购买" : "购买"}反馈 ${pct(share)}`
                  : ""}
              </small>
            )}
          </li>
        );
      })}
      {!list(items).length && <li className="muted">未提供相关反馈</li>}
    </ul>
  );
}
export function TestReport({
  run: initialRun,
  api,
  workspace,
  onClose,
  onRetest,
}) {
  const [run, setRun] = useState(initialRun),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(Boolean(api));
  useEffect(() => {
    if (!api) return;
    let live = true,
      timer;
    const load = async (first = false) => {
      try {
        const next = await api(
          `/api/ai-tests/runs/${initialRun.id}/report`,
          first ? { method: "POST", body: {} } : {},
        );
        if (!live) return;
        setRun(next);
        setError("");
        setLoading(false);
        if (
          ["queued", "translating"].includes(
            next.result.presentation_zh?.status,
          )
        )
          timer = setTimeout(() => load(), 4000);
      } catch (e) {
        if (live) {
          setError(e.message);
          setLoading(false);
        }
      }
    };
    load(true);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [api, initialRun.id]);
  const result = run.result,
    presentation = result.presentation_zh,
    translations = presentation?.translations || [];
  const pending =
    loading || ["queued", "translating"].includes(presentation?.status);
  const text = (v) =>
    reportText(
      v,
      translations,
      pending ? "正在整理中文内容…" : "中文内容暂未准备好",
    );
  const narrative = chineseSection(result.narrative),
    arms = Object.entries(result.arms || {});
  const armName = (id) => {
    const label =
      run.configuration.arms.find((a) => a.id === id)?.label || "页面方案";
    return label.startsWith(id + " ·") ? label : `${id} · ${label}`;
  };
  const segments = list(result.segments),
    personas = list(result.personas);
  const definitions = chineseSection(result.definitions);
  return (
    <Dialog
      title={run.configuration.name + " · 测品报告"}
      wide
      onClose={onClose}
    >
      <div className="ai-testing ai-report">
        {api && (
          <ReportDownload
            api={api}
            runId={run.id}
            workspace={workspace}
            disabled={
              pending || presentation?.status === "failed" || Boolean(error)
            }
          />
        )}
        <div className="ai-note">
          <strong>AI 虚拟消费者 · 购买意向模拟</strong>
          <p>
            以下结果用于形成假设和安排真实验证，不预测实际订单或销量。不同商品或多个页面因素同时变化时，结论适用于方案整体。
          </p>
          <small>
            AI virtual-consumer intent simulation. Not a forecast of real orders
            or sales.
          </small>
        </div>
        <ErrorBox error={error} />
        {pending && (
          <p role="status" className="ai-report-status">
            正在整理中文反馈（{presentation?.completed || 0} /{" "}
            {presentation?.total || "—"} 条），完成后自动更新。
          </p>
        )}
        {presentation?.status === "failed" && (
          <p role="status" className="ai-report-status">
            部分中文反馈暂未准备好，已完成的测试指标和已有中文内容仍可查看。无需重新测品。
          </p>
        )}
        <section className="ai-card ai-report-summary" aria-label="测品结论">
          <span className="ai-report-kicker">本次结论</span>
          <h3>
            {result.decision
              ? text(result.decision.label_zh || result.decision.label_en)
              : labelOf(
                  stabilityLabels,
                  result.comparisons?.[0]?.stability,
                  "查看方案比较",
                )}
          </h3>
          {narrative.headline && (
            <p className="ai-report-lead">{text(narrative.headline)}</p>
          )}
          {narrative.summary ? (
            <p>{text(narrative.summary)}</p>
          ) : (
            result.decision?.reason_zh && (
              <p>{text(result.decision.reason_zh)}</p>
            )
          )}
          <div className="ai-report-metrics">
            <div>
              <strong>
                {result.sample?.personas_completed ?? "—"} /{" "}
                {result.sample?.personas_planned ?? "—"}
              </strong>
              <span>完成的虚拟消费者</span>
            </div>
            <div>
              <strong>
                {result.sample?.sessions_per_arm ??
                  run.configuration.sessions_per_arm ??
                  "—"}
              </strong>
              <span>每人每方案模拟次数</span>
            </div>
            <div>
              <strong>{result.sample?.personas_failed ?? 0}</strong>
              <span>失败的虚拟消费者</span>
            </div>
            <div>
              <strong>{result.sample?.sessions_unparsed ?? 0}</strong>
              <span>无法解析的模拟</span>
            </div>
          </div>
        </section>
        <section aria-label="方案结果">
          <h3>各方案表现与消费者反馈</h3>
          <div className="ai-grid">
            {arms.map(([id, a]) => (
              <article className="ai-card" key={id}>
                <h3>{armName(id)}</h3>
                <div className="ai-rate">{pct(a.buy_rate.value)}</div>
                <p>模拟购买意向 · 95% 区间 {interval(a.buy_rate.ci95)}</p>
                <dl className="ai-report-counts">
                  <dt>选择购买的模拟</dt>
                  <dd>
                    {a.buy_sessions ?? "—"} / {a.valid_sessions ?? "—"} 次
                  </dd>
                  <dt>多数模拟中选择购买的人数</dt>
                  <dd>{a.personas_majority_buy ?? "—"} 人</dd>
                </dl>
                <h4>购买理由</h4>
                <ReasonList
                  items={a.top_buy_reasons}
                  translations={translations}
                  text={text}
                />
                <h4>主要顾虑</h4>
                <ReasonList
                  items={a.top_concerns}
                  concern
                  translations={translations}
                  text={text}
                />
                <h4>常见问题</h4>
                <TextList
                  items={a.common_questions}
                  text={text}
                  empty="未提供常见问题"
                />
              </article>
            ))}
          </div>
          <p className="muted ai-report-footnote">
            购买意向按虚拟消费者汇总；反馈占比分别以购买或未购买的有效模拟为基数，同一次模拟可能涉及多个理由，不能将占比直接相加。
          </p>
        </section>
        <section aria-label="方案比较">
          <h3>方案比较</h3>
          {list(result.comparisons).map((c, i) => (
            <article className="ai-card" key={i}>
              <h3>
                {c.arm} 对比 {c.vs} ·{" "}
                {labelOf(stabilityLabels, c.stability, "待解读")}
              </h3>
              <p>
                购买意向差异：<strong>{pp(c.difference)}</strong>
              </p>
              <p>
                {confidenceLevel(c.ci_level ?? 0.95)} 区间：
                {Array.isArray(c.ci) ? c.ci.map(pp).join(" 至 ") : "未提供"}
              </p>
              <small>
                差异针对整个页面或商品方案，不代表单个元素的因果作用。区间包含 0
                时，不能据此认定某个方案更优。
              </small>
            </article>
          ))}
          {narrative.comparison && <p>{text(narrative.comparison)}</p>}
        </section>
        {(list(narrative.main_concerns).length > 0 ||
          list(narrative.audience_insights).length > 0) && (
          <section className="ai-card">
            <h3>整体反馈解读</h3>
            {list(narrative.main_concerns).length > 0 && (
              <>
                <h4>最需要解决的顾虑</h4>
                <TextList items={narrative.main_concerns} text={text} />
              </>
            )}
            {list(narrative.audience_insights).length > 0 && (
              <>
                <h4>受众观察</h4>
                <TextList items={narrative.audience_insights} text={text} />
              </>
            )}
          </section>
        )}
        <section className="ai-card">
          <h3>行动建议</h3>
          {Object.entries(result.recommendations || {})
            .filter(([, rows]) => list(rows).length)
            .map(([key, rows]) => (
              <details
                className="ai-report-disclosure"
                key={key}
                open={key === "page_optimization"}
              >
                <summary>
                  {labelOf(recommendationLabels, key, "补充建议")} ·{" "}
                  {rows.length} 条
                </summary>
                {rows.map((v, i) => (
                  <article className="ai-report-action" key={i}>
                    <h4>{text(v.title)}</h4>
                    <p>{text(v.detail)}</p>
                    {v.principle && (
                      <small>行为参考：{text(v.principle)}</small>
                    )}
                  </article>
                ))}
              </details>
            ))}
          {list(narrative.next_steps).length > 0 && (
            <details className="ai-report-disclosure">
              <summary>下一步与依据</summary>
              {narrative.next_steps.map((v, i) => (
                <article className="ai-report-action" key={i}>
                  <p>{text(v.action)}</p>
                  {v.based_on && <small>依据：{text(v.based_on)}</small>}
                </article>
              ))}
            </details>
          )}
          {!Object.values(result.recommendations || {}).some(
            (v) => list(v).length,
          ) &&
            !list(narrative.next_steps).length && (
              <p className="muted">本次未返回行动建议。</p>
            )}
        </section>
        <section className="ai-card">
          <h3>人群分组表现</h3>
          <p className="muted">
            仅展示本次测试返回的人群分组。小样本和区间重叠时，观察结果仅供参考。
          </p>
          {[...new Set(segments.map((s) => s.dimension))].map((dimension) => (
            <details className="ai-report-disclosure" key={dimension}>
              <summary>
                {labelOf(profileLabels, dimension, "其他人群维度")} ·{" "}
                {segments.filter((s) => s.dimension === dimension).length} 组
              </summary>
              {result.segment_insights?.[dimension] && (
                <p>{text(result.segment_insights[dimension])}</p>
              )}
              <div className="table-frame">
                <table>
                  <thead>
                    <tr>
                      <th>分组</th>
                      <th>人数</th>
                      {arms.map(([id]) => (
                        <th key={id}>{id} 购买意向 / 区间</th>
                      ))}
                      <th>样本提示</th>
                    </tr>
                  </thead>
                  <tbody>
                    {segments
                      .filter((s) => s.dimension === dimension)
                      .map((s, i) => (
                        <tr key={i}>
                          <td>{text(s.value)}</td>
                          <td>{s.personas ?? "—"}</td>
                          {arms.map(([id]) => (
                            <td key={id}>
                              {pct(s.buy_rate?.[id])}
                              <small className="ai-table-sub">
                                {interval(s.buy_rate_ci?.[id])}
                              </small>
                            </td>
                          ))}
                          <td>
                            {s.small_sample
                              ? "小样本，谨慎解读"
                              : "结合区间判断"}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </details>
          ))}
          {!segments.length && (
            <p className="muted">本次未返回符合人数条件的人群分组。</p>
          )}
        </section>
        <section className="ai-card">
          <h3>虚拟消费者反馈 · {personas.length} 人</h3>
          <p className="muted">
            以下为 AI
            模拟消费者的反馈，不是真实买家评价；其中的商品判断可能与事实不符，应结合页面证据核对。
          </p>
          {personas.map((p, i) => (
            <details className="ai-report-disclosure" key={p.persona_id || i}>
              <summary>
                虚拟消费者 {i + 1}
                {p.representative ? " · 代表性样本" : ""}
              </summary>
              <dl className="ai-facts ai-persona-facts">
                {Object.entries(p.profile || {})
                  .filter(([k]) => Object.hasOwn(profileLabels, k))
                  .map(([k, v]) => (
                    <Fragment key={k}>
                      <dt>{profileLabels[k]}</dt>
                      <dd>
                        {Array.isArray(v)
                          ? v.map((x) => text(x)).join("、")
                          : text(String(v))}
                      </dd>
                    </Fragment>
                  ))}
              </dl>
              <div className="ai-grid">
                {arms
                  .filter(([id]) => p.arms?.[id])
                  .map(([id]) => {
                    const a = p.arms[id];
                    return (
                      <article className="ai-card" key={id}>
                        <h4>
                          {armName(id)} · {pct(a.buy_rate)}
                        </h4>
                        <p>
                          逐次决定：
                          {list(a.decisions)
                            .map((d) =>
                              d === 1 ? "购买" : d === 0 ? "不购买" : "未解析",
                            )
                            .join(" / ") || "未提供"}
                        </p>
                        <h4>主要理由</h4>
                        <p>
                          {a.primary_reason ? text(a.primary_reason) : "未提供"}
                        </p>
                        <h4>主要顾虑</h4>
                        <p>
                          {a.primary_concern
                            ? text(a.primary_concern)
                            : "未提出具体顾虑"}
                        </p>
                        <h4>提出的问题</h4>
                        <TextList
                          items={a.questions}
                          text={text}
                          empty="未提出具体问题"
                        />
                      </article>
                    );
                  })}
              </div>
            </details>
          ))}
          {!personas.length && <p className="muted">本次未返回逐人反馈。</p>}
        </section>
        <section className="ai-card">
          <h3>数据缺口与结论限制</h3>
          <TextList
            items={[
              ...list(result.data_gaps),
              ...list(result.scope_warnings),
              ...list(narrative.limitations),
            ]}
            text={text}
            empty="本次未返回额外的数据缺口；模拟结果仍需真实市场验证。"
          />
        </section>
        <details className="ai-card ai-report-disclosure">
          <summary>如何理解这些指标</summary>
          <dl className="ai-facts">
            <dt>模拟购买意向</dt>
            <dd>
              {definitions.buy_rate
                ? text(definitions.buy_rate)
                : "先计算每位虚拟消费者在有效模拟中选择购买的比例，再对消费者求平均。"}
            </dd>
            <dt>置信区间</dt>
            <dd>
              {definitions.ci
                ? text(definitions.ci)
                : "反映样本不确定性；区间越宽，结论越不稳定。"}
            </dd>
            <dt>差异是否明确</dt>
            <dd>
              差异清晰：区间不包含
              0；存在方向性：有倾向但仍不稳定；未发现明确差异：无法判断更优方案；样本不足：不宜比较。
            </dd>
            <dt>无法解析的模拟</dt>
            <dd>
              {definitions.sessions_unparsed
                ? text(definitions.sessions_unparsed)
                : "无法读取回答的模拟，不计入任何比例。"}
            </dd>
          </dl>
        </details>
        <details>
          <summary>本次确认的信息与截图</summary>
          <p>
            确认时间：
            {run.confirmed_at
              ? new Date(run.confirmed_at).toLocaleString()
              : "—"}
          </p>
          <div className="ai-grid">
            {run.configuration.arms.map((a) => {
              const arm = effective(run.configuration, a),
                im = run.images?.find((i) => i.arm === a.id);
              return (
                <article className="ai-card" key={a.id}>
                  <h3>
                    {a.id} · {a.label}
                  </h3>
                  {im && (
                    <img
                      className="ai-shot"
                      src={imageUrl(im.artifact_id, workspace)}
                      alt={a.id + " 本次确认截图"}
                    />
                  )}
                  <dl className="ai-facts">
                    {Object.entries(fields).map(([k, l]) => (
                      <Fragment key={k}>
                        <dt>{l}</dt>
                        <dd>{showValue(valueOf(arm, k))}</dd>
                      </Fragment>
                    ))}
                  </dl>
                </article>
              );
            })}
          </div>
          <dl className="ai-facts">
            {Object.entries(configurationFacts(run.configuration)).map(
              ([k, v]) => (
                <Fragment key={k}>
                  <dt>{k}</dt>
                  <dd>{showValue(v)}</dd>
                </Fragment>
              ),
            )}
          </dl>
        </details>
        <Button onClick={onRetest}>复制为复测草稿</Button>
        <small>复测先生成草稿，修改并再次确认后才消耗额度。</small>
      </div>
    </Dialog>
  );
}
