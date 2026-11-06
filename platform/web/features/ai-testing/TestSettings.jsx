import { Button, Field } from "../../components/ui.jsx";
import { Select } from "../../components/Select.jsx";
import { markets, effective, filterLabels as labels } from "./model.mjs";
import {
  AI_TEST_PERSONA_MIN,
  AI_TEST_PERSONA_MAX,
  AI_TEST_PERSONA_ERROR,
  validPersonaCount,
} from "../../lib/ai-test-limits.mjs";
const spendingFields = [
  "income_min",
  "average_purchase_price",
  "median_purchase_price",
  "max_purchase_price",
  "average_monthly_spending",
  "avg_purchases_per_month",
  "total_purchases",
];
export function TestSettings({ data, change, audience, loadAudience, busy }) {
  const uses = data.arms.map((arm) => effective(data, arm).product.use.trim());
  const problemRequired = !uses[0] || !uses.every((use) => use === uses[0]);
  const update = (k, v) =>
    change((d) => {
      d[k] = v;
    });
  const options = (values) =>
    Object.entries(values).map(([value, title]) => ({ value, title }));
  const loaded = audience?.market === data.market;
  const count = Object.values(data.audience_filters).filter(
    (v) => Object.keys(v).length,
  ).length;
  const choices = (entries) =>
    entries.map(([k, groups]) => (
      <div className="ai-filter-group" key={k}>
        <strong>{labels[k] || k}</strong>
        <div className="ai-filter-options">
          {groups.map((values, i) => {
            const chosen = data.audience_filters[k] || [];
            return (
              <label className="ai-check" key={i}>
                <input
                  type="checkbox"
                  checked={values.every((v) => chosen.includes(v))}
                  onChange={(e) => {
                    const next = { ...data.audience_filters };
                    next[k] = e.target.checked
                      ? [...new Set([...chosen, ...values])]
                      : chosen.filter((v) => !values.includes(v));
                    if (!next[k].length) delete next[k];
                    update("audience_filters", next);
                  }}
                />
                {values.join(" / ")}
              </label>
            );
          })}
        </div>
      </div>
    ));
  const loadButton = (
    <Button secondary disabled={busy} onClick={loadAudience}>
      加载当前市场受众选项
    </Button>
  );
  return (
    <div className="ai-settings">
      <section className="ai-card">
        <h2>测试设置</h2>
        <div className="ai-fields">
          <Field
            label="测试名称 *"
            wide
            hint="用商品名和本次比较内容命名，方便以后查找报告。"
          >
            <input
              value={data.name}
              placeholder="例如：水槽收纳架 · 原页面与安装效果图对比"
              maxLength={200}
              onChange={(e) => update("name", e.target.value)}
            />
          </Field>
          <Field
            label="销售市场"
            required
            wide
            hint="选择商品实际销售的平台与国家。变更市场后需重新确认页面截图。"
          >
            <Select
              variant="box"
              ariaLabel="销售市场"
              value={data.market}
              options={options({
                ...(!markets[data.market]
                  ? { [data.market]: data.market + " · 暂不支持" }
                  : {}),
                ...markets,
              })}
              onChange={(market) =>
                change((d) => {
                  d.market = market;
                  const s = market.split("_")[1];
                  d.currency = { us: "USD", uk: "GBP", jp: "JPY" }[s];
                  d.material_language = {
                    us: "en-US",
                    uk: "en-GB",
                    jp: "ja-JP",
                  }[s];
                  d.audience_filters = {};
                  for (const a of d.arms) a.image_id = null;
                })
              }
            />
          </Field>
          <Field
            label="币种 *"
            hint="填写市场对应的币种代码：美国 USD、英国 GBP、日本 JPY。"
          >
            <input
              value={data.currency}
              placeholder="例如：USD"
              maxLength={3}
              onChange={(e) => update("currency", e.target.value.toUpperCase())}
            />
          </Field>
          <Field
            label="页面素材语言"
            required
            hint="填写截图中的语言代码，如 en-US（美式英语）、ja-JP（日语）或 zh-CN（简体中文）。"
          >
            <input
              value={data.material_language}
              placeholder="例如：en-US"
              onChange={(e) =>
                change((d) => {
                  d.material_language = e.target.value;
                  for (const a of d.arms) a.image_id = null;
                })
              }
            />
          </Field>
          <Field
            label="购物意图"
            required
            hint="模拟随意浏览，或已经有明确购买需求的消费者。"
          >
            <Select
              variant="box"
              ariaLabel="购物意图"
              value={data.shopper_intent}
              options={options({
                browsing: "随意浏览",
                in_market: "已有购买需求",
              })}
              onChange={(v) => update("shopper_intent", v)}
            />
          </Field>
          <Field
            label="进入页面的方式"
            required
            hint="选择消费者通过推荐、搜索、比较等方式看到商品的场景。"
          >
            <Select
              variant="box"
              ariaLabel="进入页面的方式"
              value={data.entry_point}
              options={options({
                feed_content: "内容推荐",
                search: "搜索",
                comparison: "商品比较",
                product_page: "商品页面",
              })}
              onChange={(v) => update("entry_point", v)}
            />
          </Field>
          <Field
            label="消费者要解决的问题"
            required={problemRequired}
            hint={
              problemRequired
                ? "当前为必填：各方案用途不同或尚未补齐，请填写共同的消费者问题。"
                : "各方案已填写相同用途，此项可选；可进一步说明消费者的实际困扰。"
            }
          >
            <textarea
              maxLength={300}
              value={data.shopper_problem}
              placeholder="例如：厨房台面空间小，海绵和刷子容易积水，希望收纳整齐并保持干燥。"
              onChange={(e) => update("shopper_problem", e.target.value)}
            />
          </Field>
          <Field
            label="使用场景（选填）"
            hint="描述在哪里、什么时候、如何使用商品；未知可留空。"
          >
            <textarea
              maxLength={300}
              value={data.usage_context}
              placeholder="例如：小户型厨房的水槽边，洗碗后放置海绵、刷子和洗洁精。"
              onChange={(e) => update("usage_context", e.target.value)}
            />
          </Field>
        </div>
      </section>
      <section className="ai-card ai-audience">
        <h2>目标人群</h2>
        <Field
          label="想测试的人群（可选）"
          hint="描述人群的需求、生活方式或购物习惯；留空则不额外限定人群描述。"
        >
          <input
            value={data.audience_description}
            maxLength={500}
            placeholder="例如：住在小户型、希望提升收纳效率的年轻消费者"
            onChange={(e) => update("audience_description", e.target.value)}
          />
        </Field>
        <details className="ai-disclosure">
          <summary>筛选条件（可选）</summary>
          <div className="ai-disclosure-body">
            <p className="muted">
              不同条件同时满足，同一条件可多选。选项随销售市场变化。
            </p>
            {loaded ? (
              <div className="ai-fields">
                {choices(
                  Object.entries(audience.fields || {}).filter(
                    ([k]) => k !== "income",
                  ),
                )}
              </div>
            ) : (
              loadButton
            )}
          </div>
        </details>
        <details className="ai-disclosure">
          <summary>消费与收入</summary>
          <div className="ai-disclosure-body">
            <p className="muted">
              只填写需要限制的范围，留空表示不限。金额按销售市场币种{" "}
              {data.currency} 填写。
            </p>
            {loaded
              ? choices(
                  Object.entries(audience.fields || {}).filter(
                    ([k]) => k === "income",
                  ),
                )
              : loadButton}
            <div className="ai-fields ai-range-fields">
              {spendingFields.map((k) => (
                <div className="ai-filter-group" key={k}>
                  <strong>{labels[k]}</strong>
                  <div className="ai-fields">
                    {["min", "max"].map((bound) => (
                      <Field
                        label={bound === "min" ? "最低" : "最高"}
                        key={bound}
                      >
                        <input
                          type="number"
                          aria-label={
                            labels[k] + (bound === "min" ? "最低" : "最高")
                          }
                          value={data.audience_filters[k]?.[bound] ?? ""}
                          placeholder="留空不限"
                          onChange={(e) => {
                            const next = {
                              ...data.audience_filters,
                              [k]: { ...data.audience_filters[k] },
                            };
                            if (e.target.value === "") delete next[k][bound];
                            else next[k][bound] = Number(e.target.value);
                            if (!Object.keys(next[k]).length) delete next[k];
                            update("audience_filters", next);
                          }}
                        />
                      </Field>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </details>
        {count > 0 && (
          <div className="ai-filter-summary">
            <span>已设置 {count} 项筛选条件</span>
            <Button secondary onClick={() => update("audience_filters", {})}>
              清空筛选
            </Button>
          </div>
        )}
        <div className="ai-sample-settings">
          <p className="muted">确认前将核验符合条件的虚拟消费者人数。</p>
          <div className="ai-fields">
            <Field
              label="虚拟消费者人数 *"
              hint="填写 10–20 的整数，每次最多 20 人。"
            >
              <input
                type="number"
                min={AI_TEST_PERSONA_MIN}
                max={AI_TEST_PERSONA_MAX}
                step="1"
                value={data.persona_count}
                placeholder="例如：20"
                aria-invalid={!validPersonaCount(data.persona_count)}
                onChange={(e) =>
                  update(
                    "persona_count",
                    e.target.value === "" ? "" : Number(e.target.value),
                  )
                }
              />
              {!validPersonaCount(data.persona_count) && (
                <small className="error" role="alert">
                  {AI_TEST_PERSONA_ERROR}
                </small>
              )}
            </Field>
            <Field
              label="每人每方案模拟次数 *"
              hint="填写 3–5 的整数，例如每位消费者对每个方案模拟 5 次。"
            >
              <input
                type="number"
                min="3"
                max="5"
                step="1"
                value={data.sessions_per_arm}
                placeholder="例如：5"
                onChange={(e) =>
                  update(
                    "sessions_per_arm",
                    e.target.value === "" ? "" : Number(e.target.value),
                  )
                }
              />
            </Field>
          </div>
        </div>
      </section>
      <section className="ai-card ai-questions">
        <h2>问题</h2>
        <Field
          label="主要问题（是否购买） *"
          hint="围绕是否愿意购买提问，让各方案回答同一个问题。"
        >
          <input
            maxLength={300}
            value={data.question}
            placeholder="例如：看到该商品页面和售价后，你是否愿意购买？"
            onChange={(e) => update("question", e.target.value)}
          />
        </Field>
        <Field
          label="追问（选填，最多 3 个）"
          hint="每行一个问题，最多 3 个；留空则不追加追问。"
        >
          <textarea
            rows={4}
            value={data.follow_ups.join("\n")}
            placeholder={
              "例如：\n你愿意或不愿意购买的主要原因是什么？\n购买前还需要了解哪些信息？\n页面上最让你担心的是什么？"
            }
            onChange={(e) => update("follow_ups", e.target.value.split("\n"))}
            onBlur={() =>
              update(
                "follow_ups",
                data.follow_ups.filter((x) => x.trim()),
              )
            }
          />
        </Field>
      </section>
    </div>
  );
}
