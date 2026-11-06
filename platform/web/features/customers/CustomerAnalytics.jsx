import { useState } from "react";
import { useLoad } from "../../hooks/useLoad.mjs";
import {
  Button,
  Field,
  ErrorBox,
  Loading,
  Empty,
} from "../../components/ui.jsx";
import { PageTitle } from "../../components/PageTitle.jsx";
import { Select } from "../../components/Select.jsx";
import { datetime } from "../../lib/format.mjs";
import { FeedbackHistory, Pager } from "../feedback/FeedbackPage.jsx";
const num = (n) => Number(n || 0).toLocaleString("zh-CN");
export function CustomerAnalytics({ api }) {
  const [selected, setSelected] = useState(null),
    [period, setPeriod] = useState("days=30"),
    [range, setRange] = useState("30"),
    [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState(""),
    [revision, setRevision] = useState(0);
  return (
    <>
      {!selected && (
        <PageTitle
          eyebrow="CUSTOMER INSIGHTS"
          title="客户与使用分析"
          description="按公司名称和注册邮箱查看客户资料、使用情况与商品记录。"
        />
      )}
      <form
        className="customer-filters"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setPeriod(
            range === "custom"
              ? `start=${f.get("start")}&end=${f.get("end")}`
              : `days=${range}`,
          );
          setFilter(search);
          setPage(1);
          setRevision((v) => v + 1);
        }}
      >
        {selected && (
          <Button type="button" secondary onClick={() => setSelected(null)}>
            返回客户列表
          </Button>
        )}
        {!selected && (
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="搜索客户"
            placeholder="搜索邮箱或公司名称"
          />
        )}
        <Select
          variant="box"
          ariaLabel="统计周期"
          value={range}
          onChange={setRange}
          options={[
            { value: "7", title: "近 7 天" },
            { value: "30", title: "近 30 天" },
            { value: "custom", title: "自定义日期" },
          ]}
        />
        {range === "custom" && (
          <>
            <Field label="开始日期">
              <input name="start" type="date" required />
            </Field>
            <Field label="结束日期">
              <input name="end" type="date" required />
            </Field>
          </>
        )}
        <Button secondary>查询</Button>
      </form>
      {selected ? (
        <CustomerDetail
          key={`${selected}:${period}:${revision}`}
          api={api}
          id={selected}
          period={period}
        />
      ) : (
        <CustomerList
          key={revision}
          api={api}
          period={period}
          page={page}
          setPage={setPage}
          filter={filter}
          onSelect={setSelected}
        />
      )}
      <p className="muted customer-footnote">
        日期按北京时间统计。活跃天数与访问次数从本功能启用后开始记录；间隔 30
        分钟计为新访问，后台轮询不计入。缓存 token
        已包含在输入中；未知用量单独列出。商品记录来自已保存的选品报告与实际启动的测品任务。Token
        仅统计平台模型调用，AI 测品服务未提供 token 用量。
      </p>
    </>
  );
}
function CustomerList({ api, period, page, setPage, filter, onSelect }) {
  const { data, error } = useLoad(
    api,
    `/api/admin/customers?${period}&page=${page}&search=${encodeURIComponent(filter)}`,
    0,
  );
  return (
    <section className="panel">
      <ErrorBox error={error} />
      {!data ? (
        !error && <Loading />
      ) : !data.items.length ? (
        <Empty title="未找到客户" />
      ) : (
        <>
          <p className="muted">
            {data.period.start} — {data.period.end} · 北京时间
          </p>
          <div className="table-frame">
            <table>
              <thead>
                <tr>
                  <th>公司名称 / 邮箱</th>
                  <th>活跃天数 / 访问</th>
                  <th>Token 用量</th>
                  <th>数据调用</th>
                  <th>选品任务 / 候选条目</th>
                  <th>AI 测品</th>
                  <th>最近活跃</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <button
                        className="text-button customer-identity-button"
                        onClick={() => onSelect(u.id)}
                      >
                        <strong className="customer-company">
                          {u.profile?.company_name?.trim() || "公司名称待完善"}
                        </strong>
                        <span className="customer-email">{u.email}</span>
                      </button>
                    </td>
                    <td>
                      {u.usage.active_days} 天 / {u.usage.sessions} 次
                    </td>
                    <td>
                      {num(u.usage.total_tokens)}
                      {u.usage.unknown_token_calls > 0 && (
                        <small className="customer-cell-note">
                          另有 {u.usage.unknown_token_calls} 次待核对
                        </small>
                      )}
                    </td>
                    <td>
                      {u.usage.real_data_calls} 实时 + {u.usage.cache_hits} 快照
                    </td>
                    <td>
                      {u.usage.scouting_tasks} / {u.usage.candidate_entries}
                    </td>
                    <td>
                      {u.usage.ai_started} 次 / {u.usage.ai_unique_products} 款
                    </td>
                    <td>
                      {u.usage.last_active
                        ? datetime(u.usage.last_active)
                        : "尚无活跃记录"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} hasMore={data.has_more} onPage={setPage} />
        </>
      )}
    </section>
  );
}
function CustomerDetail({ api, id, period }) {
  const { data, error } = useLoad(
      api,
      `/api/admin/customers/${id}?${period}`,
      0,
    ),
    [tab, setTab] = useState("scouting");
  if (!data)
    return (
      <>
        <ErrorBox error={error} />
        {!error && <Loading />}
      </>
    );
  const u = data.usage,
    p = data.profile;
  return (
    <>
      <section className="panel customer-identity">
        <h1>{data.email || data.display_name}</h1>
        <p className="muted">
          {p
            ? `${p.company_name} · 联系人 ${p.contact_name} · ${p.phone}`
            : "用户资料待完善"}
        </p>
        <p className="muted">
          {data.period.start} — {data.period.end} · 北京时间
        </p>
        <div className="customer-metrics">
          <div>
            <span>活跃天数</span>
            <strong>
              {u.active_days}
              <small> 天</small>
            </strong>
            <small>{u.sessions} 次访问</small>
          </div>
          <div>
            <span>Token 总用量</span>
            <strong>{num(u.total_tokens)}</strong>
            <small>
              输入 {num(u.input_tokens)} · 输出 {num(u.output_tokens)}
            </small>
            <small>
              其中缓存 {num(u.cached_tokens)} · 未知 {u.unknown_token_calls} 次
            </small>
          </div>
          <div>
            <span>数据调用</span>
            <strong>
              {num(u.data_calls)}
              <small> 次</small>
            </strong>
            <small>
              实时 {u.real_data_calls} · 快照 {u.cache_hits}
            </small>
          </div>
          <div>
            <span>AI 测品</span>
            <strong>
              {u.ai_started}
              <small> 次</small>
            </strong>
            <small>
              完成 {u.ai_completed} · 商品 {u.ai_unique_products} 款
            </small>
          </div>
        </div>
      </section>
      <div className="customer-tabs">
        {[
          ["scouting", `选品结果 · ${u.candidate_entries}`],
          ["ai", `AI 测品 · ${u.ai_started}`],
          ["profile", "用户资料"],
          ["feedback", "客户反馈"],
        ].map(([key, label]) => (
          <button
            key={key}
            className={key === tab ? "active" : ""}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {["scouting", "ai"].includes(tab) ? (
        <ProductHistory
          key={tab}
          api={api}
          id={id}
          period={period}
          kind={tab}
        />
      ) : tab === "feedback" ? (
        <FeedbackHistory api={api} admin userId={id} />
      ) : (
        <section className="panel">
          <h2>用户资料</h2>
          {p ? (
            <dl className="customer-details">
              {[
                ["公司名称", p.company_name],
                ["联系人", p.contact_name],
                ["电话", p.phone],
                ["Email", data.email],
                ["公司规模", p.company_size],
                [
                  "年营业额",
                  `${p.revenue_year} 年 · ${p.revenue_currency} ${num(p.annual_revenue)}`,
                ],
                ["公司地址", p.address],
                ["税号", p.tax_id || "未填写"],
              ].map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <Empty title="用户尚未完善资料" />
          )}
          <p className="muted">
            注册时间：{datetime(data.created_at)} · 最近活跃：
            {u.last_active ? datetime(u.last_active) : "尚无记录"}
          </p>
          <p className="muted">
            选品任务 {u.scouting_tasks} 次 · 候选条目 {u.candidate_entries}{" "}
            条（同款商品在不同报告中可重复出现） · 待核对调用 {u.pending_calls}{" "}
            次
          </p>
        </section>
      )}
    </>
  );
}
function ProductHistory({ api, id, period, kind }) {
  const [page, setPage] = useState(1);
  const { data, error } = useLoad(
    api,
    `/api/admin/customers/${id}/products?${period}&kind=${kind}&page=${page}`,
    0,
  );
  return (
    <section className="panel">
      <ErrorBox error={error} />
      {!data ? (
        !error && <Loading />
      ) : !data.groups.length ? (
        <Empty
          title={
            kind === "ai"
              ? "此期间还没有实际启动的测品"
              : "此期间还没有选品结果"
          }
        />
      ) : (
        <>
          {data.groups.map((g) => (
            <div key={g.id} className="customer-product-group">
              <header>
                <strong>
                  {kind === "ai" ? `AI 测品 · ${g.id.slice(0, 8)}` : g.title}
                </strong>
                <span>{datetime(g.created_at)}</span>
              </header>
              {g.missing ? (
                <p className="notice">历史商品清单未保存或无法读取。</p>
              ) : (
                <div className="table-frame">
                  <table>
                    <thead>
                      <tr>
                        <th>商品</th>
                        <th>商品链接</th>
                        <th>{kind === "ai" ? "方案" : "记录类型"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.products.map((p, i) => (
                        <tr key={i}>
                          <td>
                            <div className="customer-product">
                              <ProductThumbnail
                                key={p.image || "none"}
                                src={p.image}
                                alt={
                                  kind === "ai" ? "已确认的页面截图" : p.title
                                }
                              />
                              <span>{p.title}</span>
                            </div>
                          </td>
                          <td>
                            {p.url ? (
                              <a
                                className="text-button"
                                href={p.url}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                打开商品页面 ↗
                              </a>
                            ) : (
                              <span className="muted">未保存商品链接</span>
                            )}
                          </td>
                          <td>
                            <span className="badge">
                              {kind === "ai"
                                ? `${p.arm} · ${p.arm === "A" ? "对照" : p.other_product ? "另一款商品" : "同一款商品"}`
                                : p.selected
                                  ? "已加入机会池"
                                  : "候选结果"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
          <Pager page={page} hasMore={data.has_more} onPage={setPage} />
          <p className="muted">
            每页最多 10 份报告或测试，展示其中的商品链接和图片。
            {kind === "ai" ? "图片来自提交前确认的页面截图。" : ""}
          </p>
        </>
      )}
    </section>
  );
}

function ProductThumbnail({ src, alt }) {
  const [failed, setFailed] = useState(false);
  return src && !failed ? (
    <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />
  ) : (
    <span className="customer-no-image">
      {failed ? "图片暂不可用" : "未保存图片"}
    </span>
  );
}
