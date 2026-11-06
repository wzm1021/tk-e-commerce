import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const nginx = process.env.NGINX_BIN;
const templates = process.env.INGRESS_TEMPLATE_DIR
  ? new URL("file://" + path.resolve(process.env.INGRESS_TEMPLATE_DIR) + "/")
  : new URL("../deploy/", import.meta.url);
const upload = JSON.stringify({
  version: 1,
  arm: "A",
  data: Buffer.alloc(5 * 1024 * 1024).toString("base64"),
});

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function request(port, route, body, secure = false) {
  return new Promise((resolve, reject) => {
    const req = (secure ? https : http).request(
      {
        hostname: "127.0.0.1",
        port,
        path: route,
        method: "POST",
        headers: {
          host: secure ? "upload.qa.invalid" : "127.0.0.1",
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
        ...(secure
          ? { servername: "upload.qa.invalid", rejectUnauthorized: false }
          : {}),
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, data }),
        );
      },
    );
    req.on("error", reject);
    req.setTimeout(10000, () => req.destroy(Error("Ingress test timed out")));
    req.end(body);
  });
}

for (const template of ["public-http", "public-domain"]) {
  test(
    template + " accepts 5 MiB uploads and preserves other ingress protections",
    {
      skip: !nginx && "Set NGINX_BIN to run the real reverse-proxy regression",
    },
    async (t) => {
      const root = await mkdtemp(path.join(tmpdir(), "upload-ingress-test-"));
      t.after(() => rm(root, { recursive: true, force: true }));
      const upstream = http.createServer(async (req, res) => {
        let size = 0;
        for await (const chunk of req) size += chunk.length;
        res.setHeader("content-type", "application/json");
        res.setHeader("set-cookie", "qa=value; HttpOnly; SameSite=Strict");
        res.end(
          JSON.stringify({
            size,
            route: req.url,
            ingress: req.headers["x-tidelab-public-ingress"],
            proto: req.headers["x-forwarded-proto"],
            host: req.headers.host,
          }),
        );
      });
      await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
      t.after(() => new Promise((resolve) => upstream.close(resolve)));
      const httpPort = await freePort(),
        tlsPort = await freePort(),
        redirectPort = await freePort();
      await mkdir(root + "/body");
      await mkdir(root + "/proxy");
      if (template === "public-domain")
        execFileSync(
          "openssl",
          [
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-days",
            "1",
            "-subj",
            "/CN=upload.qa.invalid",
            "-keyout",
            root + "/key.pem",
            "-out",
            root + "/cert.pem",
          ],
          { stdio: "ignore" },
        );
      const config = (
        await readFile(
          new URL(template + ".nginx.conf.template", templates),
          "utf8",
        )
      )
        .replace("user www-data;", process.getuid?.() === 0 ? "user root;" : "")
        .replace("/run/tidelab-public/nginx.pid", root + "/nginx.pid")
        .replace("/var/log/tidelab-public/error.log", root + "/error.log")
        .replace("/var/lib/nginx/tidelab-body", root + "/body")
        .replace("/var/lib/nginx/tidelab-proxy", root + "/proxy")
        .replaceAll("0.0.0.0:4310", "127.0.0.1:" + httpPort)
        .replaceAll("0.0.0.0:443", "127.0.0.1:" + tlsPort)
        .replaceAll("0.0.0.0:80", "127.0.0.1:" + redirectPort)
        .replaceAll("127.0.0.1:9080", "127.0.0.1:" + upstream.address().port)
        .replaceAll("__PUBLIC_IP__", "127.0.0.1")
        .replaceAll("__PUBLIC_DOMAIN__", "upload.qa.invalid")
        .replaceAll("__TLS_CERT_FILE__", root + "/cert.pem")
        .replaceAll("__TLS_KEY_FILE__", root + "/key.pem");
      const configPath = root + "/nginx.conf";
      await writeFile(configPath, config);
      execFileSync(nginx, ["-t", "-p", root, "-c", configPath], {
        stdio: "pipe",
      });
      const child = spawn(
        nginx,
        ["-p", root, "-c", configPath, "-g", "daemon off;"],
        { stdio: "ignore" },
      );
      t.after(async () => {
        if (child.exitCode !== null || child.signalCode) return;
        const stopped = once(child, "exit");
        child.kill("SIGTERM");
        await stopped;
      });
      for (let attempt = 0; ; attempt++) {
        try {
          await request(httpPort, "/ready", "{}");
          break;
        } catch (e) {
          if (attempt >= 50) throw e;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
      for (const secure of template === "public-domain"
        ? [false, true]
        : [false]) {
        const port = secure ? tlsPort : httpPort;
        for (const route of [
          "/api/ai-tests/11111111-1111-4111-8111-111111111111/image?workspace=qa",
          "/api/feedback/files",
        ]) {
          const res = await request(port, route, upload, secure);
          assert.equal(
            res.status,
            200,
            `${template} ${secure ? "HTTPS" : "HTTP"} ${route}: ${res.data}`,
          );
          assert.deepEqual(JSON.parse(res.data), {
            size: Buffer.byteLength(upload),
            route,
            ingress: "1",
            proto: secure ? "https" : "http",
            host: secure ? "upload.qa.invalid" : "127.0.0.1",
          });
          assert.equal(/; secure/i.test(res.headers["set-cookie"][0]), secure);
          assert.equal(
            (
              await request(
                port,
                route,
                "x".repeat(8 * 1024 * 1024 + 1),
                secure,
              )
            ).status,
            413,
          );
        }
        assert.equal(
          (await request(port, "/api/ai-tests", upload, secure)).status,
          413,
        );
        assert.equal(
          (await request(port, "/api/feedback/files/other", upload, secure))
            .status,
          413,
        );
        assert.equal(
          (await request(port, "/internal/job", "{}", secure)).status,
          404,
        );
      }
    },
  );
}
