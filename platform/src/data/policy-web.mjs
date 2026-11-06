import { Agent, fetch } from "undici";
import sanitizeHtml from "sanitize-html";
import { z } from "zod";
import { checkedEndpoint } from "../infra/network.mjs";
import { id, digest, requireThat } from "../common/core.mjs";
import { lockedLease, jobEvent } from "../research/jobs.mjs";
import { saveArtifact } from "../files/artifacts.mjs";

export const POLICY_HOSTS = [
  "ftc.gov",
  "cpsc.gov",
  "ecfr.gov",
  "seller-us.tiktok.com",
  "seller-uk.tiktok.com",
  "sellercentral.amazon.com",
  "sellercentral.amazon.co.uk",
  "sellercentral.amazon.de",
  "sellercentral.amazon.co.jp",
];
const seeds = [
  {
    title: "FTC: Disclosures 101 for Social Media Influencers",
    url: "https://www.ftc.gov/business-guidance/resources/disclosures-101-social-media-influencers",
  },
  {
    title: "FTC: Apparel and Labeling",
    url: "https://www.ftc.gov/news-events/topics/tools-consumers/apparel-labeling",
  },
  { title: "CPSC: Recalls", url: "https://www.cpsc.gov/Recalls" },
];
const decode = (x) =>
  String(x)
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, n) =>
      String.fromCodePoint(
        Math.min(
          0x10ffff,
          n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n),
        ),
      ),
    )
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&amp;/g, "&");
export function policyUrl(value) {
  const u = new URL(value);
  requireThat(
    u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      (!u.port || u.port === "443") &&
      POLICY_HOSTS.some(
        (h) => u.hostname === h || u.hostname.endsWith("." + h),
      ),
    "policy_url_forbidden",
    400,
  );
  u.hash = "";
  return u.toString();
}
export function policyPage(html) {
  const main =
    html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ||
    [...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)].sort(
      (a, b) => b[1].length - a[1].length,
    )[0]?.[1] ||
    html;
  const clean = (x) =>
    decode(
      sanitizeHtml(x, {
        allowedTags: [],
        allowedAttributes: {},
        nonTextTags: ["script", "style", "noscript", "iframe"],
      }),
    )
      .replace(/\s+/g, " ")
      .trim();
  const title = clean(
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "",
  ).slice(0, 300);
  const text = clean(main).slice(0, 24000);
  const blocked =
    /access denied|verify you are human|captcha|just a moment/i.test(
      title + text.slice(0, 250),
    );
  return {
    title,
    text: blocked ? "" : text,
    readable: !blocked && text.length >= 300,
  };
}
async function pageFetch(value) {
  let url = new URL(value);
  const signal = AbortSignal.timeout(15000);
  for (let n = 0; n < 4; n++) {
    policyUrl(url.toString());
    const plain = new URL(url);
    plain.search = "";
    plain.hash = "";
    const { addresses } = await checkedEndpoint(plain.toString()),
      a = addresses[0];
    const dispatcher = new Agent({
      connect: {
        lookup: (_host, opts, cb) =>
          opts.all ? cb(null, [a]) : cb(null, a.address, a.family),
      },
    });
    try {
      const response = await fetch(url, {
        dispatcher,
        redirect: "manual",
        signal,
        headers: {
          "User-Agent": "TidelabPolicyResearch/1.0",
          Accept: "text/html,application/rss+xml,application/xml",
        },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const loc = response.headers.get("location");
        await response.body?.cancel();
        requireThat(loc, "policy_redirect_invalid");
        url = new URL(loc, url);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        return { url: url.toString(), status: response.status, html: "" };
      }
      const reader = response.body.getReader(),
        chunks = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 2 * 1024 * 1024) {
            await reader.cancel();
            throw Error("policy_page_too_large");
          }
          chunks.push(Buffer.from(value));
        }
      } finally {
        reader.releaseLock();
      }
      return {
        url: url.toString(),
        status: response.status,
        html: Buffer.concat(chunks).toString(),
      };
    } finally {
      await dispatcher.close();
    }
  }
  throw Error("policy_redirect_limit");
}
export async function queryPolicy(input, fetchPage = pageFetch) {
  if (input.action === "fetch") {
    const url = policyUrl(input.url);
    try {
      const page = await fetchPage(url);
      const parsed = policyPage(page.html);
      return {
        source: "Official policy web",
        tool: "policy_fetch",
        request: { url },
        url: page.url,
        http_status: page.status,
        ...parsed,
        status:
          page.status === 200 && parsed.readable ? "fetched" : "unavailable",
      };
    } catch {
      return {
        source: "Official policy web",
        tool: "policy_fetch",
        request: { url },
        url,
        status: "unavailable",
        text: "",
        reason: "website_unavailable",
      };
    }
  }
  const query = input.query.trim();
  const u = new URL("https://www.ftc.gov/legal-library/search");
  u.searchParams.set("sort_by", "search_api_relevance");
  u.searchParams.set("search", query);
  let results = [],
    status = "searched";
  try {
    const p = await fetchPage(u.toString());
    requireThat(p.status === 200, "search_unavailable");
    const body =
      p.html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] || p.html;
    for (const m of body.matchAll(
      /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    )) {
      try {
        const url = policyUrl(new URL(decode(m[1]), p.url || u).toString());
        const title = decode(
          sanitizeHtml(m[2], { allowedTags: [], allowedAttributes: {} }),
        ).trim();
        if (title) results.push({ title, url });
      } catch {}
    }
  } catch {
    status = "unavailable";
  }
  return {
    source: "Official policy web",
    tool: "policy_search",
    request: { query },
    search_method: "FTC official legal library search",
    search_url: u.toString(),
    scope:
      "FTC.gov; other official domains require policy_fetch with their exact URLs",
    status,
    results: [...new Map(results.map((r) => [r.url, r])).values()].slice(0, 10),
    catalog_suggestions: seeds,
    notice:
      "搜索标题及目录仅用于发现页面，不是已核验政策；须 policy_fetch 读取正文。",
  };
}
const Input = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("search"),
      query: z.string().trim().min(3).max(240),
    })
    .strict(),
  z
    .object({ action: z.literal("fetch"), url: z.string().url().max(2000) })
    .strict(),
]);
export function installPolicyWeb(app, db, store, fetchPage) {
  app.post(
    "/internal/job/policy",
    { preHandler: app.jobAuth, bodyLimit: 8192 },
    async (req) => {
      const input = Input.parse(req.body);
      if (input.action === "fetch") policyUrl(input.url);
      return db.tenant(req.jobScope.workspace_id, async (c) => {
        requireThat(
          (await c.query("SELECT pg_try_advisory_xact_lock(93419739) AS ok"))
            .rows[0].ok,
          "policy_busy",
          429,
        );
        // Network I/O must not hold the jobs row needed by heartbeat/cancel.
        // The global advisory lock below still bounds concurrent policy reads.
        const j = await lockedLease(c, req.jobScope, { lock: false });
        requireThat(j.kind === "scouting", "policy_task_forbidden", 403);
        const key = digest(input),
          existing = (
            await c.query(
              "SELECT data FROM job_events WHERE job_id=$1 AND kind='policy_source' AND data->>'query_key'=$2",
              [j.id, key],
            )
          ).rows[0];
        if (existing) {
          const a = (
            await c.query("SELECT * FROM artifacts WHERE id=$1", [
              existing.data.artifact_id,
            ])
          ).rows[0];
          return JSON.parse(
            (await store.read(a.object_key, a.sha256)).toString(),
          );
        }
        const count = (
          await c.query(
            "SELECT count(*)::int n FROM job_events WHERE job_id=$1 AND kind='policy_source'",
            [j.id],
          )
        ).rows[0].n;
        requireThat(count < 16, "policy_query_limit", 429);
        const envelope = {
          ...(await queryPolicy(input, fetchPage)),
          invocation_id: id(),
          captured_at: new Date().toISOString(),
          points_charged: 0,
        };
        // Revalidate cancellation, fence and lease after the external wait.
        await lockedLease(c, req.jobScope);
        const artifact = await saveArtifact(
          c,
          store,
          req.jobScope.workspace_id,
          Buffer.from(JSON.stringify(envelope)),
          { name: "policy-source.json", kind: "policy_evidence" },
        );
        await jobEvent(
          c,
          req.jobScope.workspace_id,
          j.id,
          "policy_source",
          envelope.status === "unavailable"
            ? "政策页面暂不可读取，已记录缺项"
            : input.action === "search"
              ? "已检索官方政策页面"
              : "已记录政策页面读取结果",
          {
            query_key: key,
            artifact_id: artifact.id,
            invocation_id: envelope.invocation_id,
            status: envelope.status,
          },
        );
        return envelope;
      });
    },
  );
}
export async function loadPolicySources(c, store, jobId, sources) {
  const rows = (
    await c.query(
      "SELECT e.data,a.object_key,a.sha256 FROM job_events e JOIN artifacts a ON a.id=(e.data->>'artifact_id')::uuid WHERE e.job_id=$1 AND e.kind='policy_source'",
      [jobId],
    )
  ).rows;
  for (const r of rows)
    sources.set(
      r.data.invocation_id,
      JSON.parse((await store.read(r.object_key, r.sha256)).toString()),
    );
  return sources;
}
