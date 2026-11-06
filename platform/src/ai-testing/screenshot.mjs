import http from "node:http";
import net from "node:net";
import dns from "node:dns/promises";
import { publicAddress } from "../infra/network.mjs";
import { requireThat } from "../common/core.mjs";
import { inspectImage } from "./images.mjs";

const amazon = {
  us: "www.amazon.com",
  uk: "www.amazon.co.uk",
  jp: "www.amazon.co.jp",
};
export function captureTarget(value, market, productId = "") {
  let url;
  try {
    url = new URL(value);
  } catch {
    requireThat(false, "ai_capture_url");
  }
  const [platform, region] = market.split("_");
  requireThat(
    url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === "443"),
    "ai_capture_url",
  );
  if (platform === "amazon") {
    requireThat(
      amazon[region] &&
        [amazon[region], amazon[region].slice(4)].includes(url.hostname),
      "ai_capture_url",
    );
    const asin = url.pathname.match(
      /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/|$)/,
    )?.[1];
    requireThat(
      asin && (!productId || asin === productId),
      "ai_capture_identity",
    );
  } else {
    requireThat(
      platform === "tiktok" &&
        ["www.tiktok.com", "shop.tiktok.com"].includes(url.hostname),
      "ai_capture_url",
    );
    const pid = url.pathname.match(
      /\/(?:product|pdp)\/(?:[^/]+\/)?(\d{10,40})(?:\/|$)/,
    )?.[1];
    requireThat(
      pid && (!productId || pid === productId),
      "ai_capture_identity",
    );
  }
  return url;
}
// Pin the actual socket connection to a validated public address, including all subresources.
// Browser-side request interception alone is not a DNS-rebinding defense.
export async function publicProxy() {
  const sockets = new Set();
  const server = http.createServer((_req, res) => {
    res.writeHead(403);
    res.end();
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  server.on("connect", async (req, client, head) => {
    let upstream;
    try {
      const target = new URL("https://" + req.url);
      requireThat(
        target.port === "" || target.port === "443",
        "ai_capture_url",
      );
      requireThat(
        !net.isIP(target.hostname) && !target.username && !target.password,
        "ai_capture_url",
      );
      const addresses = await dns.lookup(target.hostname, { all: true });
      requireThat(
        addresses.length && addresses.every((a) => publicAddress(a.address)),
        "ai_capture_url",
      );
      if (client.destroyed) return;
      upstream = net.connect({ host: addresses[0].address, port: 443 });
      sockets.add(upstream);
      upstream.setTimeout(30000, () => upstream.destroy());
      upstream.on("close", () => sockets.delete(upstream));
      upstream.on("error", () => client.destroy());
      client.on("error", () => upstream.destroy());
      client.on("close", () => upstream.destroy());
      upstream.once("connect", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        upstream.pipe(client);
        client.pipe(upstream);
      });
    } catch {
      upstream?.destroy();
      client.destroy();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
export async function capturePage(request) {
  const target = captureTarget(request.url, request.market, request.product_id);
  const { chromium } = await import("playwright");
  const proxy = await publicProxy();
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.AI_TEST_BROWSER_PATH
        ? { executablePath: process.env.AI_TEST_BROWSER_PATH }
        : {}),
      proxy: { server: proxy.url, bypass: "<-loopback>" },
      args: [
        "--disable-quic",
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
        "--disable-background-networking",
      ],
    });
    const mobile = request.viewport === "mobile",
      viewport = mobile
        ? { width: 430, height: 1100 }
        : { width: 1440, height: 1100 };
    const context = await browser.newContext({
      viewport,
      locale: request.language || "en-US",
      serviceWorkers: "block",
      acceptDownloads: false,
      ignoreHTTPSErrors: false,
    });
    const page = await context.newPage();
    await context.routeWebSocket("**/*", (socket) => socket.close());
    page.setDefaultTimeout(20000);
    await page.route("**/*", async (route) => {
      const u = new URL(route.request().url());
      if (
        u.protocol !== "https:" ||
        net.isIP(u.hostname) ||
        u.hostname === "localhost" ||
        u.hostname.endsWith(".localhost") ||
        ["websocket", "media"].includes(route.request().resourceType())
      )
        return route.abort();
      return route.continue();
    });
    const response = await page.goto(target.toString(), {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    requireThat(response?.ok(), "ai_capture_unavailable", 409);
    await page.locator("body").waitFor();
    await page
      .evaluate(async () => {
        await Promise.race([
          Promise.all(
            [...document.images]
              .slice(0, 20)
              .map((i) => i.decode().catch(() => {})),
          ),
          new Promise((r) => setTimeout(r, 10000)),
        ]);
      })
      .catch(() => {});
    const text = await page.locator("body").innerText();
    requireThat(
      !/enter the characters you see|verify you are human|robot check|captcha|access denied|验证您是人类/i.test(
        text.slice(0, 6000),
      ),
      "ai_capture_blocked",
      409,
    );
    captureTarget(page.url(), request.market, request.product_id);
    requireThat(
      text.length > 200 &&
        /[$£¥￥]|USD|GBP|JPY/.test(text) &&
        /add to cart|buy now|加入购物车|立即购买|カート|購入/i.test(text),
      "ai_capture_incomplete",
      409,
    );
    const image = await page.screenshot({
      type: "jpeg",
      quality: 88,
      animations: "disabled",
      timeout: 20000,
    });
    const height = await page.evaluate(
      () => document.documentElement.scrollHeight,
    );
    const full =
      height <= 12000
        ? await page.screenshot({
            type: "jpeg",
            quality: 75,
            fullPage: true,
            animations: "disabled",
            timeout: 20000,
          })
        : image;
    const metadata = await inspectImage(image);
    return {
      image,
      full: full.length <= 5 * 1024 * 1024 ? full : image,
      metadata: {
        ...metadata,
        title: await page.title(),
        source_url: page.url(),
        requested_url: request.url,
        viewport,
        language: request.language,
        market: request.market,
        captured_at: new Date().toISOString(),
        manual: false,
        delivery_region: "页面当前配送地区，须确认",
        full_page_complete: height <= 12000 && full.length <= 5 * 1024 * 1024,
      },
    };
  } finally {
    await browser?.close();
    await proxy.close();
  }
}
