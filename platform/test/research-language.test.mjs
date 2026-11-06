import test from "node:test";
import assert from "node:assert/strict";
import {
  researchDisplayText as display,
  specialistResultPresentation,
} from "../src/common/research-language.mjs";
import { publicReportHtml } from "../src/common/public-report.mjs";
import { renderSpecialistReport } from "../src/reports/specialist-report.mjs";
import {
  researchPrompt,
  specialistReviewPrompt,
} from "../src/agent/research-prompt.mjs";

test("real report paths, encoded values and query parameters become readable Chinese", () => {
  const cases = [
    ['`/decoded/0/data/shop/shop_name` = "Sigird"', "店铺名称：Sigird"],
    [
      "/decoded/0/data/product/title = &quot;Bag &amp; Pump&quot;",
      "商品名称：Bag &amp; Pump",
    ],
    [
      "/decoded/0/data/daily_trend/27/daily_units_sold",
      "逐日经营数据第28条记录的当日销量（件）",
    ],
    ["/decoded/0/data/summary/commerce/ad_attributed_gmv", "广告归因成交额"],
    ["shop\\_name=US", "店铺名称：US"],
    ["region=US，currency_code=USD", "市场：美国站，币种：美元"],
    [
      "reviews=[]、total_review_count=0",
      "评论样本：无返回记录、查询范围内的评论总数：0",
    ],
    [
      "orderby=create_time desc，pagesize=10",
      "排序方式：创建时间从近到远，每页数量：10",
    ],
    [
      "cache_hit=true；is_off_shelf=false；is_ad=false",
      "使用历史快照；在售；未标记为广告",
    ],
    ["/decoded/0/data/unknown_metric=12.50", "来源字段（含义待确认）：12.50"],
    ["/decoded/0/data/constructor", "来源字段（含义待确认）"],
  ];
  for (const [raw, expected] of cases) {
    assert.equal(display(raw), expected);
    assert.equal(display(expected), expected);
  }
  assert.equal(
    display('shop_name="Snofrid Rechargeable & Cordless Bags"'),
    "店铺名称：Snofrid Rechargeable & Cordless Bags",
  );
  assert.equal(
    display("units_sold=20；order_count=10"),
    "销量（件）：20；订单数：10",
  );
  assert.doesNotMatch(
    display("average_order_value；non_ad_video_traffic；product_card"),
    /客单价|自然流量/,
  );
});

test("presentation preserves evidence, numeric values, URLs and original scripts", () => {
  const url =
    "https://example.com/shop_name/a_b?product_id=123#decoded/0/data/shop/shop_name";
  const original = {
    status: "complete",
    summary: "shop_name=Sigird",
    sections: [
      {
        title: "广告数据",
        body: "estimated_ad_spend=14766.90；ad_gmv=49919.53",
        evidence_ids: ["source-1"],
      },
    ],
    limitations: ["cache_hit=true"],
    evidence: [
      {
        pointer: "/decoded/0/data/shop/shop_name",
        value: { shop_name: "Sigird", summary: "shop_name=Sigird" },
      },
    ],
    request: { notes: "shop_name=Sigird" },
    url,
  };
  const before = structuredClone(original),
    shown = specialistResultPresentation(original);
  assert.equal(shown.summary, "店铺名称：Sigird");
  assert.equal(
    shown.sections[0].body,
    "估算广告花费：14766.90；广告归因成交额：49919.53",
  );
  assert.deepEqual(shown.evidence, original.evidence);
  assert.deepEqual(shown.request, original.request);
  assert.equal(shown.status, "complete");
  assert.equal(display(url), url);
  const script =
    'English script: "Keep your notes and shampoo here. No drilling needed."';
  assert.equal(display(script), script);
  assert.deepEqual(original, before);
});

test("archived HTML and all five new reports use Chinese without breaking markup or evidence anchors", () => {
  const archived =
    '<meta name="report-template" content="specialist-v2"><style>.shop_name{color:red}</style><p>`/decoded/0/data/shop/shop_name` = &quot;Sigird&quot; &amp; &lt;script&gt;</p><a href="#source-1" title="product_id">[1]</a><p id="source-1">is_ad=false</p><img src="https://example.com/a_b" alt="photo">';
  const shown = publicReportHtml(archived);
  assert.ok(shown.includes("店铺名称：Sigird &amp; &lt;script&gt;"));
  assert.ok(shown.includes('href="#source-1" title="商品编号"'));
  assert.ok(shown.includes('id="source-1">未标记为广告'));
  assert.ok(shown.includes("<style>.shop_name{color:red}</style>"));
  assert.ok(shown.includes('src="https://example.com/a_b"'));
  assert.equal(publicReportHtml(shown), shown);
  assert.doesNotMatch(shown, /<script>/);
  assert.equal(
    publicReportHtml("<p>/decoded/0/data/shop/shop_name</p>"),
    "<p>/decoded/0/data/shop/shop_name</p>",
  );
  for (const kind of [
    "competitor",
    "content",
    "reviews",
    "ads",
    "diagnostics",
  ]) {
    const result = {
      status: "complete",
      summary: "shop_name=Sigird",
      sections: [
        {
          title: "商品资料",
          body: "product_rating=4.7",
          kind: "observed",
          evidence_ids: ["source-1"],
        },
      ],
      candidates: [],
      limitations: ["cache_hit=true"],
      questions: [],
      next_actions: [
        { title: "核对评论", reason: "product_review_list 近期为空" },
      ],
    };
    const html = renderSpecialistReport(result, { kind, title: "中文报告" });
    assert.match(html, /店铺名称：Sigird/);
    assert.match(html, /商品评分：4.7/);
    assert.match(html, /使用历史快照/);
    assert.match(html, /商品评论数据/);
    assert.doesNotMatch(
      html,
      /shop_name|product_rating|cache_hit|product_review_list/,
    );
    assert.match(
      researchPrompt({
        kind,
        snapshot: { skill: { skill_id: kind } },
        request: {},
      }),
      /易懂的中文经营语言/,
    );
    assert.match(
      specialistReviewPrompt(kind),
      /将接口路径与英文字段改成中文业务描述/,
    );
  }
});
