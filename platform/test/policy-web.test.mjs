import test from "node:test";
import assert from "node:assert/strict";
import { policyUrl, queryPolicy } from "../src/data/policy-web.mjs";
import {
  candidateAnalysis,
  testPlans,
  policyChecks,
} from "../src/reports/scouting-analysis.mjs";
test("policy web restricts URLs and distinguishes fetched policy from discovery or unavailable pages", async () => {
  for (const u of [
    "http://www.ftc.gov/a",
    "https://ftc.gov.evil.test/a",
    "https://user@www.ftc.gov/a",
    "https://127.0.0.1/a",
    "https://www.ftc.gov:8443/a",
  ])
    assert.throws(() => policyUrl(u));
  assert.equal(policyUrl("https://www.ftc.gov/a#x"), "https://www.ftc.gov/a");
  const page = await queryPolicy(
    { action: "fetch", url: "https://www.ftc.gov/a" },
    async (url) => ({
      url,
      status: 200,
      html:
        "<title>Disclosures</title><article>Navigation teaser</article><main>" +
        "Official guidance. ".repeat(30) +
        "</main><script>secret injection</script>",
    }),
  );
  assert.equal(page.status, "fetched");
  assert.ok(!page.text.includes("secret injection"));
  const blocked = await queryPolicy(
    { action: "fetch", url: "https://www.ftc.gov/a" },
    async (url) => ({
      url,
      status: 200,
      html: "<title>Access denied</title>" + "blocked ".repeat(80),
    }),
  );
  assert.equal(blocked.status, "unavailable");
  const search = await queryPolicy(
    { action: "search", query: "US textile" },
    async () => ({
      status: 200,
      html: '<main><a href="https://www.ftc.gov/a">Official</a><a href="https://evil.test/a">Fake</a></main>' ,
    }),
  );
  assert.equal(search.results.length, 1);
  assert.equal(search.text, undefined);
  assert.equal(
    (
      await queryPolicy({ action: "search", query: "US textile" }, async () => {
        throw Error("offline");
      })
    ).status,
    "unavailable",
  );
});
test("product-specific experiments preserve evidence, links and assumptions without canned thresholds", () => {
  const sources = new Map([
    [
      "source",
      { source: "FastMoss", video_url: "https://www.tiktok.com/@a/video/123" },
    ],
    [
      "web",
      {
        tool: "policy_fetch",
        status: "fetched",
        url: "https://www.ftc.gov/a",
        title: "FTC actual title",
        captured_at: "2026-09-12T10:00:00Z",
      },
    ],
  ]);
  const claim = (summary) => ({
    summary,
    evidence_ids: ["source"],
    limitations: [],
  });
  const c = {
    title: "Storage A",
    reason: "Product card opportunity",
    research: {
      growth: claim("86% product-card units; inferred dependence"),
      reputation: claim("Rating 4.5; 0 review samples, not zero complaints"),
      competition: claim(
        "8 shops in 10 rows; empty sample is not zero complaints",
      ),
      test_plan: {
        summary: "Test 20 units via product cards",
        rationale: "Observed channel mix",
        evidence_ids: ["source"],
        assumptions: ["20 is a hypothesis, not forecast"],
      },
      links: [
        {
          label: "Top video",
          url: "https://www.tiktok.com/@a/video/123",
          invocation_id: "source",
          pointer: "/video_url",
        },
      ],
    },
  };
  const historical = candidateAnalysis({...c,research:undefined}, sources, () => "[source]");
  assert.ok(historical.includes(c.reason));
  assert.ok(!historical.includes("尚未完成"));
  const html = candidateAnalysis(c, sources, () => "[source]");
  for (const v of ["86%", "8 shops", "Top video", "hypothesis", "0 review samples"])
    assert.ok(html.includes(v));
  const c2 = structuredClone(c);
  c2.title = "B";
  c2.research.test_plan.summary = "Measure drainage first";
  const plans = testPlans({ candidates: [c, c2] }, sources, () => "[ref]");
  assert.ok(plans.includes("Test 20"));
  assert.ok(plans.includes("Measure drainage"));
  assert.ok(!plans.includes("CTR"));
  const checks = {
    policy_checks: [
      {
        scope: "Creators",
        summary: "<script>bad</script> disclose",
        action: "Add clear disclosure",
        status: "reviewed",
        evidence_ids: ["web"],
      },
    ],
  };
  const p = policyChecks(checks, sources, () => "[ref]");
  assert.ok(p.includes("FTC actual title"));
  assert.ok(p.includes("2026-09-12"));
  assert.ok(!p.includes("<script>"));
  sources.get("web").status = "unavailable";
  assert.ok(
    !policyChecks(checks, sources, () => "").includes("FTC actual title"),
  );
});
