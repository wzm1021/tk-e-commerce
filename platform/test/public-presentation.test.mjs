import test from "node:test";
import assert from "node:assert/strict";
import { publicReportHtml } from "../src/common/public-report.mjs";
import { customerPresentation, displayText } from "../web/lib/presentation.mjs";
import { renderScoutingReport } from "../src/reports/scouting-report.mjs";

test("archived reports show the current platform brand while retaining evidence and asset bytes", () => {
  const raw =
    '<title>Tidelab 报告</title><style>.TIDELAB{color:red}</style><header><small>TIDE LAB · 选品研究</small></header><main><p>原始证据：Tidelab</p><img src="data:image/png;base64,TIDELAB"><a href="https://tidelab.example/report">证据</a></main><footer>潮准 TideLab · 证据驱动的跨境经营研究</footer>';
  const shown = publicReportHtml(raw);
  assert.ok(shown.includes("<title>探阔 Tanviko 报告</title>"));
  assert.ok(shown.includes("<small>探阔 Tanviko · 选品研究</small>"));
  assert.ok(
    shown.includes("<footer>探阔 Tanviko · 看清机会，行动有据。</footer>"),
  );
  assert.ok(shown.includes("<p>原始证据：Tidelab</p>"));
  assert.ok(shown.includes('src="data:image/png;base64,TIDELAB"'));
  assert.ok(shown.includes('href="https://tidelab.example/report"'));
  assert.ok(shown.includes("<style>.TIDELAB{color:red}</style>"));
  assert.equal(publicReportHtml(shown), shown);
});

test("customer wording covers historical nested narrative without altering evidence or routing fields", () => {
  const original = {
    connections: [{ kind: "fastmoss", name: "FastMoss 实时数据", ready: true }],
    result: {
      answer: "依据 FASTMOSS 数据",
      limitations: ["FastMoss 单一来源"],
      citations: [
        {
          source: "FastMoss · product_detail_info",
          value: { source: "FastMoss", units: 23 },
          pointer: "/FastMoss/data",
        },
      ],
    },
    request: { selection_rules: "参考 FastMoss" },
    image: "https://fastmoss.com/image.png",
    source_kind: "fastmoss_agent_research",
  };
  original.amazon = {
    summary: "SellerSprite / 卖家精灵",
    source: "SellerSprite",
    source_kind: "sellersprite",
    value: { source: "SellerSprite" },
  };
  const before = structuredClone(original),
    shown = customerPresentation(original);
  assert.equal(shown.amazon.summary, "电商数据 / 电商数据");
  assert.equal(shown.amazon.source, "电商数据");
  assert.equal(shown.amazon.source_kind, "sellersprite");
  assert.deepEqual(shown.amazon.value, original.amazon.value);
  assert.equal(shown.connections[0].name, "数据API 实时数据");
  assert.equal(shown.connections[0].kind, "fastmoss");
  assert.equal(shown.result.answer, "依据 数据API 数据");
  assert.deepEqual(shown.result.limitations, ["数据API 单一来源"]);
  assert.equal(
    shown.result.citations[0].source,
    "数据API · product_detail_info",
  );
  assert.deepEqual(
    shown.result.citations[0].value,
    original.result.citations[0].value,
  );
  assert.equal(shown.result.citations[0].pointer, "/FastMoss/data");
  assert.equal(shown.image, original.image);
  assert.equal(shown.source_kind, original.source_kind);
  assert.deepEqual(shown.request, original.request);
  assert.deepEqual(original, before);
  assert.equal(
    displayText("数据来自 https://mcp.fastmoss.com/mcp。"),
    "数据来自 数据API。",
  );
});

test("HTML presentation changes visible branding and vendor links while preserving media, markup and escaping", () => {
  const html =
    '<!doctype html><style>.FastMoss{color:red}</style><title>FastMoss 分析</title><p>FastMoss &amp; 订单 &lt;script&gt;</p><a href="https://www.fastmoss.com/product/123" title="FastMoss">来源</a><a href="https://www.tiktok.com/shop/pdp/123">商品</a><img alt="FastMoss 商品" src="data:image/png;base64,FastMoss"><script>"FastMoss"</script>';
  const shown = publicReportHtml(html);
  assert.match(shown, /<title>数据API 分析<\/title>/);
  assert.match(shown, /<p>数据API &amp; 订单 &lt;script&gt;<\/p>/);
  assert.match(shown, /<a title="数据API">来源<\/a>/);
  assert.ok(shown.includes('href="https://www.tiktok.com/shop/pdp/123"'));
  assert.ok(
    shown.includes(
      '<img alt="数据API 商品" src="data:image/png;base64,FastMoss">',
    ),
  );
  assert.ok(shown.includes("<style>.FastMoss{color:red}</style>"));
  assert.ok(shown.includes('<script>"FastMoss"</script>'));
  const amazon = publicReportHtml(
    '<p>SellerSprite / 卖家精灵 https://mcp.sellersprite.com/mcp</p><a href="https://www.sellersprite.com/" aria-label="SELLERSPRITE">来源</a><img alt="卖家精灵" src="data:image/png;base64,SellerSprite"><a href="https://www.amazon.com/dp/B012345678">商品</a>',
  );
  assert.match(amazon, /<p>电商数据 \/ 电商数据 电商数据<\/p>/);
  assert.match(amazon, /<a aria-label="电商数据">来源<\/a>/);
  assert.ok(amazon.includes('src="data:image/png;base64,SellerSprite"'));
  assert.ok(amazon.includes('href="https://www.amazon.com/dp/B012345678"'));
  assert.equal(publicReportHtml(amazon), amazon);
  assert.equal(publicReportHtml(shown), shown);
});

test("brief conclusions retain decisions, caveats and full analysis in a closed disclosure", () => {
  const long = "完整模型分析。".repeat(300);
  const result = {
    status: "partial",
    summary: long,
    analysis_mode: "user_rules",
    candidates: [
      {
        product_id: "item-1",
        title: "浴室收纳",
        decision: "watch",
        reason: "继续验证",
        evidence: [],
        limitations: ["成本未知，不能判断利润。后续补充报价。"],
      },
    ],
    sections: [
      {
        title: "分析详情",
        kind: "inferred",
        body: "FastMoss 样本有限。",
        evidence_ids: [],
      },
    ],
    limitations: [],
    questions: [],
    next_actions: [{ title: "获取落地成本", reason: "核对利润" }],
  };
  const original = structuredClone(result);
  const html = renderScoutingReport(result, {
    request: { selection_rules: "先看机会" },
    sources: new Map(),
  });
  const conclusion = html.split('id="conclusions">')[1].split("<section")[0];
  const brief = conclusion.split("<details")[0];
  assert.match(brief, /阶段结果：1 个继续观察/);
  assert.match(brief, /成本未知，不能判断利润。/);
  assert.match(brief, /获取落地成本/);
  assert.equal((brief.match(/<dt>/g) || []).length, 3);
  assert.ok(!brief.includes(long));
  assert.ok(!html.split("</header>")[0].includes(long));
  assert.match(
    conclusion,
    /<details class="analysis-details"><summary>展开完整分析<\/summary>/,
  );
  assert.ok(conclusion.includes(long));
  assert.ok(conclusion.includes("数据API 样本有限。"));
  assert.deepEqual(result, original);
  result.candidates[0].limitations = [
    "先不要购买".repeat(40) + "，除非成本核实。",
  ];
  const fallback = renderScoutingReport(result, {
    request: { selection_rules: "" },
    sources: new Map(),
  });
  assert.match(fallback, /现有证据仍需验证，详见数据限制。/);
});
