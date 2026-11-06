import { trendScale, trendTick } from "./trend-scale.mjs";
import { randomId } from "../../lib/client-id.mjs";
import { useEffect, useRef, useState } from "react";
import { BarChart3, ExternalLink } from "lucide-react";
import { Dialog } from "../../components/Dialog.jsx";
import { Button, ErrorBox, Loading } from "../../components/ui.jsx";
import { safeLink } from "../../lib/links.mjs";
import { datetime } from "../../lib/format.mjs";
import { TIKTOK_CURRENCIES as currencies } from "../../lib/platforms.mjs";

const sections = [
  ["overview", "商品与店铺总览"],
  ["sales", "店铺成交分析"],
  ["products", "店铺商品"],
  ["creators", "带货达人"],
  ["videos", "带货视频"],
  ["lives", "带货直播"],
  ["product_advertising", "商品投放"],
  ["advertising", "店铺投放"],
  ["sku", "商品规格"],
];
const number = (v) =>
  v == null || v === ""
    ? "—"
    : typeof v === "number"
      ? v.toLocaleString("zh-CN", { maximumFractionDigits: 2 })
      : String(v);
const percent = (v) => (v == null ? "—" : `${number(v)}%`);
const labels = {
  product_card: "商品卡",
  video: "视频",
  live: "直播",
  affiliate: "达人带货",
  shop: "店铺自营",
  self_operated: "店铺自营",
  shop_account: "店铺自营账号",
  non_ad_video_traffic: "非广告视频流量",
  ad_traffic: "广告流量",
  organic_traffic: "自然流量",
  local_shop: "本土店",
  cross_border: "跨境店",
};
const label = (v) => labels[v] || v || "未提供";
const toolLabels = {
  product_detail_info: "商品资料",
  product_overview: "商品总览",
  shop_base_info: "店铺资料",
  shop_data_trends: "店铺趋势",
  shop_sale_analysis: "成交分析",
  shop_product_analysis: "商品列表",
  shop_creator_analysis: "达人列表",
  shop_video_analysis: "视频列表",
  shop_live_analysis: "直播列表",
  product_investment: "商品投放分析",
  shop_investment_analysis: "店铺投放分析",
  product_sku: "商品规格",
};
function Metrics({ items }) {
  return (
    <div className="overview-metrics">
      {items.map(([name, value, note]) => (
        <div className="overview-metric" key={name}>
          <small>{name}</small>
          <strong>{number(value)}</strong>
          {note && <small>{note}</small>}
        </div>
      ))}
    </div>
  );
}
function Table({ columns, rows, empty = "该周期未返回明细。" }) {
  if (!rows?.length) return <p className="overview-empty">{empty}</p>;
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {columns.map(([name]) => (
              <th key={name}>{name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map(([name, render]) => (
                <td key={name}>{render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Photo({ url, title }) {
  const source = safeLink(url);
  return source ? (
    <img
      className="overview-photo"
      src={source}
      alt={title || ""}
      loading="lazy"
      onError={(e) => {
        e.currentTarget.hidden = true;
      }}
    />
  ) : null;
}
function Identity({ title, subtitle, image, url }) {
  const link = safeLink(url);
  return (
    <div className="overview-identity">
      <Photo url={image} title={title} />
      <div>
        <strong>{title || "名称待补充"}</strong>
        <small>{subtitle}</small>
        {link && (
          <a href={link} target="_blank" rel="noreferrer">
            查看详情 <ExternalLink size={12} />
          </a>
        )}
      </div>
    </div>
  );
}
function Trend({ title, rows, currency }) {
  const [metric, setMetric] = useState("daily_units_sold");
  const data = [...(rows || [])]
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date || ""))
    .sort((a, b) => a.date.localeCompare(b.date));
  const monetary = metric === "daily_gmv";
  const { top, ticks } = trendScale(
    data.map((row) => row[metric]),
    monetary,
  );
  const axisLabel = monetary ? `销售额（${currency}）` : "销量（件）";
  return (
    <section className="overview-section">
      <h3>{title}</h3>
      {!data.length ? (
        <p className="overview-empty">暂无可用每日数据；缺失值不补零。</p>
      ) : (
        <>
          <div className="overview-chart-head">
            <span>
              {data[0].date} 至 {data.at(-1).date} · {data.length} 个数据日
            </span>
            <div className="overview-switch">
              <button
                type="button"
                aria-pressed={metric === "daily_units_sold"}
                onClick={() => setMetric("daily_units_sold")}
              >
                每日销量
              </button>
              <button
                type="button"
                aria-pressed={metric === "daily_gmv"}
                onClick={() => setMetric("daily_gmv")}
              >
                每日销售额（{currency}）
              </button>
            </div>
          </div>
          <div className="overview-axis-title">{axisLabel}</div>
          <div
            className="overview-chart-grid"
            role="img"
            aria-label={`${title}，纵轴${axisLabel}，0 至 ${number(top)}；详细数值见下方每日对比表`}
          >
            <div className="overview-y-axis" aria-hidden="true">
              {ticks.map((tick) => (
                <span key={tick} style={{ bottom: `${(tick / top) * 100}%` }}>
                  {trendTick(tick)}
                </span>
              ))}
            </div>
            <div className="overview-bars">
              {ticks.map((tick) => (
                <i
                  key={tick}
                  className="overview-gridline"
                  style={{ bottom: `${(tick / top) * 100}%` }}
                  aria-hidden="true"
                />
              ))}
              {data.map((r, i) => (
                <div
                  className="overview-bar"
                  key={`${r.date}:${i}`}
                  title={`${r.date}：${number(r[metric])}${monetary ? ` ${currency}` : " 件"}`}
                >
                  <span
                    style={{
                      height: `${Number.isFinite(r[metric]) && r[metric] >= 0 ? (r[metric] / top) * 100 : 0}%`,
                    }}
                  />
                </div>
              ))}
            </div>
            <div className="overview-x-axis">
              <small>{data[0].date}</small>
              <small>{data.at(-1).date}</small>
            </div>
          </div>
          <details>
            <summary>查看每日销量对比与销售额</summary>
            <Table
              rows={data.map((r, i) => ({ ...r, previous: data[i - 1] }))}
              columns={[
                ["日期", (r) => r.date],
                ["销量", (r) => number(r.daily_units_sold)],
                [
                  "较前一日",
                  (r) => {
                    const p = r.previous;
                    return p &&
                      Date.parse(r.date) - Date.parse(p.date) === 86400000 &&
                      typeof r.daily_units_sold === "number" &&
                      typeof p.daily_units_sold === "number"
                      ? `${r.daily_units_sold - p.daily_units_sold > 0 ? "+" : ""}${number(r.daily_units_sold - p.daily_units_sold)}`
                      : "—";
                  },
                ],
                [`销售额（${currency}）`, (r) => number(r.daily_gmv)],
                ["累计销量", (r) => number(r.cumulative_units_sold)],
              ]}
            />
          </details>
        </>
      )}
    </section>
  );
}
function Distribution({ title, data, nameKey, currency }) {
  const rows =
    data?.breakdown || data?.by_gmv || (Array.isArray(data) ? data : []);
  const units = data?.by_units_sold || [];
  return (
    <section className="overview-section">
      <h3>{title}</h3>
      <Table
        rows={rows}
        columns={[
          ["类型", (r) => label(r[nameKey])],
          [`销售额（${currency}）`, (r) => number(r.gmv)],
          ["销售额占比", (r) => percent(r.gmv_share_percent)],
          [
            "销量",
            (r) =>
              number(
                r.units_sold ??
                  units.find((u) => u[nameKey] === r[nameKey])?.units_sold,
              ),
          ],
        ]}
      />
    </section>
  );
}
function Summary({ panels, candidate, days, currency }) {
  const detail = panels.product_detail_info?.data,
    product = detail?.product,
    overview = panels.product_overview?.data,
    base = panels.shop_base_info?.data,
    trend = panels.shop_data_trends?.data;
  const summary = overview?.period_summary || {},
    shop = base?.shop || {},
    perf = base?.performance_summary || {},
    service = base?.service_metrics || {},
    ranking = base?.ranking_summary || {},
    query = trend?.query_summary || {};
  return (
    <>
      <section className="overview-section">
        <p className="eyebrow">当前候选商品</p>
        <Identity
          title={product?.title || candidate.title}
          image={product?.cover_url || candidate.image_url}
          subtitle={`商品 ID ${candidate.product_id}`}
          url={product?.detail_url}
        />
        <p className="muted overview-note">
          商品统计区间：{overview?.daily_trend?.[0]?.date || "未提供"} 至{" "}
          {overview?.daily_trend?.at(-1)?.date || "未提供"} · 采集于{" "}
          {datetime(panels.product_overview?.captured_at)}
        </p>
        <Metrics
          items={[
            [`近 ${days} 天销量`, summary.period_total_units_sold],
            [`近 ${days} 天销售额`, summary.period_total_gmv, currency],
            ["累计销量", product?.total_units_sold],
            ["累计销售额", product?.total_gmv, currency],
            [
              "售价",
              product?.price_status === "unverified"
                ? "待核验"
                : (product?.floor_price ?? summary.current_price),
              currency,
            ],
            ["评分", product?.product_rating],
          ]}
        />
        <dl className="overview-facts">
          <dt>类目</dt>
          <dd>
            {[
              product?.category_l1?.name,
              product?.category_l2?.name,
              product?.category_l3?.name,
            ]
              .filter(Boolean)
              .join(" / ") || "—"}
          </dd>
          <dt>佣金率</dt>
          <dd>{percent(product?.commission_rate_percent)}</dd>
          <dt>库存</dt>
          <dd>{number(product?.stock_count)}</dd>
          <dt>累计带货达人 / 视频 / 直播</dt>
          <dd>
            {number(product?.linked_creator_count)} /{" "}
            {number(product?.linked_video_count)} /{" "}
            {number(product?.linked_live_count)}
          </dd>
        </dl>
      </section>
      <Trend
        title="商品每日趋势"
        rows={overview?.daily_trend}
        currency={currency}
      />
      <div className="overview-distributions">
        <Distribution
          title="商品成交渠道"
          data={overview?.channel_distribution}
          nameKey="sales_channel"
          currency={currency}
        />
        <Distribution
          title="商品内容成交"
          data={overview?.content_distribution}
          nameKey="content_type"
          currency={currency}
        />
        <Distribution
          title="商品投放成交"
          data={overview?.ads_distribution}
          nameKey="traffic_source"
          currency={currency}
        />
      </div>
      <section className="overview-section">
        <p className="eyebrow">所属店铺 · 全店表现</p>
        <Identity
          title={shop.shop_name || candidate.monitor_target?.name}
          image={shop.shop_avatar_url}
          subtitle={`${shop.region || candidate.monitor_target?.market} · ${label(shop.shop_type_code)} · ${shop.seller_id || candidate.monitor_target?.seller_id}`}
        />
        <p className="muted overview-note">
          店铺趋势统计区间：{query.start_date || "未提供"} 至{" "}
          {query.end_date || "未提供"}
          。商品与店铺可能使用不同时间的快照，请以各自区间为准。
        </p>
        <Metrics
          items={[
            ["全店累计销量", perf.total_units_sold],
            ["全店累计销售额", perf.total_gmv, currency],
            ["在售商品", perf.active_product_count],
            ["历史商品", perf.total_product_count],
            ["累计带货达人", perf.linked_creator_count],
            [
              "累计视频 / 直播",
              `${number(perf.linked_video_count)} / ${number(perf.linked_live_count)}`,
            ],
          ]}
        />
        <Metrics
          items={[
            [`全店近 ${days} 天销量`, query.period_units_sold],
            [`全店近 ${days} 天销售额`, query.period_gmv, currency],
            ["期间动销商品", query.period_active_product_count],
            ["新增带货达人", query.period_new_linked_creator_count],
          ]}
        />
        <dl className="overview-facts">
          <dt>主营类目</dt>
          <dd>{shop.primary_category_name || "—"}</dd>
          <dt>开店日期</dt>
          <dd>{shop.shop_created_date || "—"}</dd>
          <dt>店铺评分</dt>
          <dd>
            {number(service.shop_rating)} /{" "}
            {number(service.shop_rating_full_score)}
          </dd>
          <dt>好评率</dt>
          <dd>{percent(service.positive_feedback_rate_percent)}</dd>
          <dt>24 小时客服回复率</dt>
          <dd>{percent(service.response_rate_percent)}</dd>
          <dt>48 小时发货率</dt>
          <dd>{percent(service.delivery_rate_percent)}</dd>
          <dt>全国 / 类目排名</dt>
          <dd>
            {ranking.is_region_ranked === false
              ? "未上榜"
              : number(ranking.region_rank)}{" "}
            /{" "}
            {ranking.is_category_ranked === false
              ? "未上榜"
              : number(ranking.category_rank)}
            {ranking.ranking_period_month
              ? `（${ranking.ranking_period_month}）`
              : ""}
          </dd>
          <dt>店铺数据更新时间</dt>
          <dd>{shop.snapshot_at || "—"}</dd>
        </dl>
        {base?.category_benchmark && (
          <details>
            <summary>同类店铺参考数据</summary>
            <Metrics
              items={[
                [
                  "品类平均累计销量",
                  base.category_benchmark.category_avg_units_sold,
                ],
                [
                  "品类平均累计销售额",
                  base.category_benchmark.category_avg_gmv,
                  currency,
                ],
                [
                  "品类平均带货达人",
                  base.category_benchmark.category_avg_creator_count,
                ],
              ]}
            />
          </details>
        )}
        <p className="muted overview-note">
          独立质量分、相似店铺推荐和自营账号逐日表现暂未由当前接口提供。
        </p>
        {base?.brand_account && (
          <>
            <h3>店铺自营账号</h3>
            <Metrics
              items={[
                ["账号数", base.brand_account.count],
                ["总粉丝数", base.brand_account.follower_count_total],
              ]}
            />
            {base.brand_account.account?.nickname && (
              <Identity
                title={base.brand_account.account.nickname}
                image={base.brand_account.account.avatar_url}
                subtitle={base.brand_account.account.handle}
              />
            )}
          </>
        )}
      </section>
      <Trend
        title="全店每日趋势"
        rows={trend?.daily_trend}
        currency={currency}
      />
    </>
  );
}
function PageControl({ data, page, onPage, count, total }) {
  return (
    <div className="overview-pagination">
      <small>
        第 {page} 页 · 本页 {count} 条
        {total == null ? " · 总量未返回" : ` / 共 ${number(total)} 条`}
        。当前页不代表全店总量。
      </small>
      <div>
        <Button secondary disabled={page <= 1} onClick={() => onPage(page - 1)}>
          上一页
        </Button>
        <Button
          secondary
          disabled={
            page >= 500 || (total != null ? page * 10 >= total : count < 10)
          }
          onClick={() => onPage(page + 1)}
        >
          下一页
        </Button>
      </div>
    </div>
  );
}
function ProductAdvertising({ panel, productId, days, currency }) {
  const verification = panel?.advertising_evidence;
  const bound =
    verification?.product_id === productId && verification?.days === days;
  const status = bound ? verification.status : "unknown";
  const data = bound ? panel.data : null;
  const summary = data?.ad_performance_summary || {};
  const metricLabels = {
    estimated_ad_spend: "预估广告花费",
    ad_gmv: "广告归因销售额",
    ad_units_sold: "广告归因销量",
    ad_play_count: "广告播放量",
    ad_video_count: "广告视频数",
  };
  return (
    <>
      <section className="overview-ad-verification" role="status">
        <small>
          当前商品 · {productId} · 近 {days} 天
        </small>
        <h3>
          {status === "observed"
            ? "已发现该商品的广告投放证据"
            : status === "not_observed"
              ? "该周期未观察到商品投放"
              : "暂无法确认该商品是否投放"}
        </h3>
        <p>
          {status === "observed"
            ? "商品投放数据中存在正向广告指标，说明该周期内有投放记录；不代表此刻仍在投放。"
            : status === "not_observed"
              ? "该商品的广告花费、归因销售额、销量、播放量和视频数均返回 0；不等于从未投放。"
              : "商品投放数据尚不完整或未获取成功，不能据此判断为未投放。"}
        </p>
        {status === "observed" && (
          <p className="muted">
            依据：
            {verification.evidence
              .map(
                (item) =>
                  `${item.source === "daily" ? `${item.date} ` : ""}${metricLabels[item.field]} ${number(item.value)}${["estimated_ad_spend", "ad_gmv"].includes(item.field) ? ` ${currency}` : ""}`,
              )
              .join("；")}
            。
          </p>
        )}
      </section>
      {data && (
        <>
          <Metrics
            items={[
              ["商品预估广告花费", summary.estimated_ad_spend, currency],
              ["商品广告归因销售额", summary.ad_gmv, currency],
              ["商品 ROAS", summary.roas],
              ["广告归因销量", summary.ad_units_sold],
              ["广告播放量", summary.ad_play_count],
              ["广告视频数", summary.ad_video_count],
            ]}
          />
          <p className="muted">
            仅统计当前商品。数据API的广告花费为估算，归因销售额不等同于增量成交。
          </p>
          <Table
            rows={data.daily_ad_performance_trend}
            columns={[
              ["日期", (r) => r.date],
              [`预估花费（${currency}）`, (r) => number(r.estimated_ad_spend)],
              [`归因销售额（${currency}）`, (r) => number(r.ad_gmv)],
              ["ROAS", (r) => number(r.roas)],
              ["广告视频数", (r) => number(r.ad_video_count)],
            ]}
          />
        </>
      )}
    </>
  );
}
function DetailPanel({
  section,
  panels,
  productId,
  days,
  page,
  onPage,
  currency,
}) {
  if (section === "product_advertising")
    return (
      <ProductAdvertising
        panel={panels.product_investment}
        productId={productId}
        days={days}
        currency={currency}
      />
    );
  const data = panels[Object.keys(panels)[0]]?.data;
  if (!data) return null;
  if (section === "sales")
    return (
      <>
        <Distribution
          title="全店成交渠道占比"
          data={data.sales_channel_distribution}
          nameKey="sales_channel_label"
          currency={currency}
        />
        <Distribution
          title="全店销售方式分布"
          data={data.content_type_distribution}
          nameKey="content_type_label"
          currency={currency}
        />
        <p className="muted">
          渠道与内容是不同统计维度，不能相加作为全店总额。
        </p>
      </>
    );
  if (section === "products") {
    const rows = data.products?.list || [],
      cat = data.product_catalog_summary || {};
    return (
      <>
        <Metrics
          items={[
            ["历史上架商品", cat.historical_product_count],
            ["当前在售商品", cat.active_product_count],
            [
              "佣金区间",
              `${percent(cat.commission_rate_min_percent)} – ${percent(cat.commission_rate_max_percent)}`,
            ],
          ]}
        />
        <div className="overview-distributions">
          <Distribution
            title="一级类目销售额分布"
            data={data.category_distribution?.by_gmv?.level_1}
            nameKey="category_name"
            currency={currency}
          />
          <Distribution
            title="价格带销售额分布"
            data={data.price_band_distribution?.by_gmv}
            nameKey="price_band"
            currency={currency}
          />
        </div>
        <Table
          rows={rows}
          columns={[
            [
              "商品",
              (r) => (
                <Identity
                  title={r.product?.title}
                  image={r.product?.cover_url}
                  subtitle={r.product?.product_id}
                  url={r.product?.fastmoss_detail_url}
                />
              ),
            ],
            [`售价（${currency}）`, (r) => number(r.product?.current_price)],
            ["评分", (r) => number(r.product?.product_rating)],
            [
              `近 ${days} 天销量`,
              (r) =>
                r.performance_summary?.selected_window_days === days
                  ? number(r.performance_summary.selected_window_units_sold)
                  : "—",
            ],
            [
              `销售额（${currency}）`,
              (r) =>
                r.performance_summary?.selected_window_days === days
                  ? number(r.performance_summary.selected_window_gmv)
                  : "—",
            ],
          ]}
        />
        <PageControl
          page={page}
          onPage={onPage}
          count={rows.length}
          total={data.products?.total}
        />
      </>
    );
  }
  if (section === "creators") {
    const rows = data.linked_creators?.list || [],
      s = data.creator_summary || {};
    return (
      <>
        <Metrics
          items={[
            ["带货达人", s.linked_creator_count],
            [
              "视频 / 直播达人",
              `${number(s.video_creator_count)} / ${number(s.live_creator_count)}`,
            ],
            ["新增达人", s.newly_linked_creator_count],
            ["带货销量", s.total_units_sold],
            ["带货销售额", s.total_gmv, currency],
          ]}
        />
        <div className="overview-distributions">
          <Distribution
            title="达人粉丝量分布"
            data={data.follower_tier_distribution}
            nameKey="follower_tier"
            currency={currency}
          />
          <Distribution
            title="达人类型分布"
            data={data.creator_category_distribution}
            nameKey="creator_category"
            currency={currency}
          />
        </div>
        <Table
          rows={rows}
          columns={[
            [
              "达人",
              (r) => (
                <Identity
                  title={r.creator?.nickname}
                  image={r.creator?.avatar_url}
                  subtitle={r.creator?.creator_handle}
                />
              ),
            ],
            ["粉丝数", (r) => number(r.creator?.follower_count)],
            [
              "关联商品销量",
              (r) => number(r.product_contribution?.product_units_sold),
            ],
            [
              `关联商品销售额（${currency}）`,
              (r) => number(r.product_contribution?.product_gmv),
            ],
            [
              "视频 / 直播销量",
              (r) =>
                `${number(r.channel_contribution?.video_units_sold)} / ${number(r.channel_contribution?.live_units_sold)}`,
            ],
          ]}
        />
        <PageControl
          page={page}
          onPage={onPage}
          count={rows.length}
          total={data.linked_creators?.total}
        />
      </>
    );
  }
  if (section === "videos") {
    const rows = data.videos?.items || [],
      s = data.summary || {};
    return (
      <>
        <Metrics
          items={[
            ["视频数量", s.video_count],
            ["播放量", s.total_play_count],
            ["视频销售额", s.total_video_gmv, currency],
          ]}
        />
        <p className="muted">
          成交数据为近 {days} 天；未另设视频发布时间限制。
        </p>
        <Table
          rows={rows}
          columns={[
            [
              "视频",
              (r) => (
                <Identity
                  title={r.caption_text}
                  image={r.cover_url}
                  subtitle={r.creator_name || r.creator_handle}
                  url={
                    r.video_id && /^\d+$/.test(r.video_id) && r.creator_handle
                      ? `https://www.tiktok.com/@${encodeURIComponent(r.creator_handle)}/video/${r.video_id}`
                      : null
                  }
                />
              ),
            ],
            [
              "发布时间",
              (r) =>
                r.published_at_ts ? datetime(r.published_at_ts * 1000) : "—",
            ],
            [
              "播放 / 点赞",
              (r) =>
                `${number(r.engagement_metrics?.play_count)} / ${number(r.engagement_metrics?.like_count)}`,
            ],
            [
              "店铺商品销量",
              (r) => number(r.commerce_metrics?.video_units_sold),
            ],
            [
              `销售额（${currency}）`,
              (r) => number(r.commerce_metrics?.video_gmv),
            ],
            [
              "投流",
              (r) =>
                r.traffic_flags?.is_ad == null
                  ? "—"
                  : r.traffic_flags.is_ad
                    ? "是"
                    : "否",
            ],
          ]}
        />
        <PageControl
          page={page}
          onPage={onPage}
          count={rows.length}
          total={data.videos?.total}
        />
      </>
    );
  }
  if (section === "advertising") {
    const s = data.ad_performance_summary || {};
    return (
      <>
        <p className="overview-empty">
          以下为全店投放数据，不能证明当前商品投过广告。请查看“商品投放”栏目核验。
        </p>
        <Metrics
          items={[
            ["预估广告花费", s.estimated_ad_spend, currency],
            ["广告归因销售额", s.ad_attributed_gmv, currency],
            ["ROAS", s.roas],
            ["推广商品", s.promoted_product_count],
            ["推广达人", s.promoted_creator_count],
            ["推广视频", s.promoted_video_count],
          ]}
        />
        <p className="muted">广告花费为估算，归因销售额不等同于增量成交。</p>
        <Table
          rows={data.daily_ad_performance_trend}
          columns={[
            ["日期", (r) => r.date],
            [`预估花费（${currency}）`, (r) => number(r.estimated_ad_spend)],
            [`归因销售额（${currency}）`, (r) => number(r.ad_attributed_gmv)],
            ["ROAS", (r) => number(r.roas)],
          ]}
        />
      </>
    );
  }
  if (section === "sku")
    return (
      <>
        <p className="muted">
          规格库存快照：{data.snapshot_date || "未提供"} · 统计近 {days} 天
        </p>
        <Table
          rows={data.sku_variants}
          columns={[
            [
              "规格",
              (r) =>
                r.properties
                  ?.map((p) => `${p.dimension_name}: ${p.dimension_value}`)
                  .join(" / ") || r.sku_id,
            ],
            [`售价（${currency}）`, (r) => number(r.current_price)],
            ["库存", (r) => number(r.stock_units)],
          ]}
        />
        {data.sku_dimensions?.map((d, i) => (
          <Distribution
            key={i}
            title={d.dimension_name}
            data={d.distribution_summary}
            nameKey="dimension_value"
            currency={currency}
          />
        ))}
      </>
    );
  if (section === "lives") {
    const rows = data.lives?.list || [],
      s = data.live_performance_summary || {};
    return (
      <>
        <Metrics
          items={[
            ["带货直播场次", s.total_live_session_count],
            ["店铺商品销量", s.total_units_sold],
            ["店铺商品销售额", s.total_gmv, currency],
            ["观看人次", s.total_viewer_entries],
            ["场均观看人次", s.avg_viewer_entries_per_live],
            ["场均销量", s.avg_units_sold_per_live],
          ]}
        />
        <p className="muted">
          近 {days} 天开播的直播；成交数据为这些直播中的店铺商品表现。
        </p>
        <Table
          rows={rows}
          columns={[
            [
              "直播",
              (r) => (
                <Identity
                  title={r.live?.title || "直播"}
                  image={r.live?.cover_url}
                  subtitle={`${r.creator?.nickname || ""} · ${r.creator?.creator_handle || ""}`}
                />
              ),
            ],
            [
              "开播时间",
              (r) =>
                r.live?.started_at ? datetime(r.live.started_at * 1000) : "—",
            ],
            ["观看人次", (r) => number(r.traffic_metrics?.viewer_entries)],
            ["店铺商品销量", (r) => number(r.commerce_metrics?.units_sold)],
            [`销售额（${currency}）`, (r) => number(r.commerce_metrics?.gmv)],
            [
              "类型",
              (r) =>
                r.live?.live_type_code === 1
                  ? "店铺播"
                  : r.live?.live_type_code === 2
                    ? "达人播"
                    : "—",
            ],
          ]}
        />
        <PageControl
          page={page}
          onPage={onPage}
          count={rows.length}
          total={data.lives?.total}
        />
      </>
    );
  }
  return null;
}
export function CandidateOverview({ api, reportId, candidate, onClose }) {
  const [section, setSection] = useState("overview"),
    [days, setDays] = useState(28),
    [page, setPage] = useState(1),
    [snapshot, setResult] = useState(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [refreshKey, setRefreshKey] = useState(null);
  const cache = useRef(new Map());
  const selectionKey = `${reportId}:${candidate.product_id}:${section}:${days}:${page}`;
  const key = `${selectionKey}:${refreshKey || "saved"}`;
  const result =
    snapshot?.key === selectionKey &&
    snapshot?.value?.product_id === candidate.product_id &&
    snapshot?.value?.section === section &&
    snapshot?.value?.days === days &&
    snapshot?.value?.page === page
      ? snapshot.value
      : null;
  useEffect(() => {
    let active = true,
      timer;
    setResult({ key: selectionKey, value: cache.current.get(key) || null });
    setError("");
    setLoading(!cache.current.has(key));
    if (!cache.current.has(key)) {
      const load = async () => {
        try {
          const value = await api(
            `/api/reports/${reportId}/candidates/${encodeURIComponent(candidate.product_id)}/overview`,
            {
              method: "POST",
              body: {
                section,
                days,
                page,
                ...(refreshKey ? { refresh_key: refreshKey } : {}),
              },
            },
          );
          if (!active) return;
          setResult({ key: selectionKey, value });
          if (value.status === "running") {
            timer = setTimeout(load, 2500);
            return;
          }
          cache.current.set(key, value);
          cache.current.set(`${selectionKey}:saved`, value);
          setLoading(false);
        } catch (e) {
          if (active) {
            setError(e.message);
            setLoading(false);
          }
        }
      };
      load();
    }
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    api,
    reportId,
    candidate.product_id,
    section,
    days,
    page,
    key,
    selectionKey,
    refreshKey,
  ]);
  const currency = currencies[candidate.monitor_target?.market] || "币种待核实";
  return (
    <Dialog title="数据总览" wide onClose={onClose}>
      <div className="candidate-overview">
        <div className="overview-heading">
          <BarChart3 size={24} />
          <div>
            <h3>{candidate.monitor_target?.name}</h3>
            <p>
              {candidate.monitor_target?.market} · 商品 {candidate.product_id}
            </p>
          </div>
        </div>
        <p className="muted overview-note">
          首次查看每个栏目会补充数据；一个栏目可能调用多个接口，实时查询按接口扣
          0 / 1 / 2 / 3 积分，有效快照每次 0.3
          积分。已保存的结果可重复查看，不调用模型。
        </p>
        <nav className="overview-tabs" aria-label="数据栏目">
          {sections.map(([value, title]) => (
            <button
              type="button"
              key={value}
              aria-pressed={section === value}
              onClick={() => {
                setSection(value);
                setPage(1);
                setRefreshKey(null);
                if (value === "sku" && days === 90) setDays(28);
              }}
            >
              {title}
            </button>
          ))}
        </nav>
        <div className="overview-toolbar">
          <div className="overview-switch" aria-label="统计周期">
            {[7, 28, 90]
              .filter((d) => section !== "sku" || d !== 90)
              .map((d) => (
                <button
                  type="button"
                  key={d}
                  aria-pressed={days === d}
                  onClick={() => {
                    setDays(d);
                    setPage(1);
                    setRefreshKey(null);
                  }}
                >
                  近 {d} 天
                </button>
              ))}
          </div>
          <small>币种：{currency}</small>
          <Button
            secondary
            disabled={loading || result?.status === "reconciling"}
            onClick={() => setRefreshKey(randomId())}
          >
            更新本栏目（需消耗积分）
          </Button>
        </div>
        <ErrorBox error={error} />
        {loading && (
          <div role="status">
            <Loading />
            <p className="muted">正在读取已保存的数据并补充缺失栏目…</p>
          </div>
        )}
        {result && (
          <>
            {Object.entries(result.failures || {}).length > 0 && (
              <div className="overview-empty" role="status">
                {Object.keys(result.failures)
                  .map((k) => toolLabels[k] || "部分数据")
                  .join("、")}
                暂未获取成功；已返回的内容保留展示。
                {result.status === "reconciling"
                  ? "此次调用正在核对，请勿重复采购。"
                  : ""}
              </div>
            )}
            {Object.entries(result.panels).flatMap(([tool, panel]) =>
              (panel.warnings || []).map((warning, i) => (
                <p
                  className="overview-empty"
                  role="status"
                  key={`${tool}:${i}`}
                >
                  {warning}
                </p>
              )),
            )}
            {section === "overview" ? (
              <Summary
                panels={result.panels}
                candidate={candidate}
                days={days}
                currency={currency}
              />
            ) : (
              <DetailPanel
                section={section}
                panels={result.panels}
                productId={candidate.product_id}
                days={days}
                page={page}
                onPage={setPage}
                currency={currency}
              />
            )}
            <footer className="overview-footer">
              <p>
                本次保存结果使用 {result.data_points}{" "}
                数据积分。缺失值以“—”表示。
              </p>
              {Object.entries(result.panels).map(([tool, panel]) => (
                <small key={tool}>
                  {toolLabels[tool]} · 采集于 {datetime(panel.captured_at)}
                </small>
              ))}
            </footer>
          </>
        )}
      </div>
    </Dialog>
  );
}
