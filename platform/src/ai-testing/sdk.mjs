import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { AppError } from "../common/core.mjs";
import { providerValidationFields } from "./validation.mjs";
let active = 0;

export function sdkCall(
  payload,
  { onReceipt = async () => {}, timeout = 420000 } = {},
) {
  if (active >= 6) return Promise.reject(new AppError("ai_service_busy", 503));
  active++;
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.env.AI_TEST_PYTHON || "python3",
      [fileURLToPath(new URL("../../python/ai_testing.py", import.meta.url))],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      },
    );
    let pending = "",
      total = 0,
      result,
      problem,
      receipts = Promise.resolve();
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    const parse = (line) => {
      try {
        const v = JSON.parse(line);
        if (v.event === "receipt")
          receipts = receipts
            .then(() => onReceipt(v))
            .catch((e) => {
              problem = e;
              child.kill("SIGKILL");
            });
        else if (v.error)
          problem = new AppError(
            "ai_" +
              String(v.error)
                .toLowerCase()
                .replace(/[^a-z0-9_]/g, ""),
            502,
            v.error === "invalid_spec" || v.error === "invalid_arms"
              ? { fields: providerValidationFields(v.details, payload.spec) }
              : null,
          );
        else if (Object.hasOwn(v, "result")) result = v.result;
      } catch {
        problem = new AppError("ai_sdk_invalid", 502);
      }
    };
    child.stdout.on("data", (chunk) => {
      total += chunk.length;
      if (total > 12 * 1024 * 1024) {
        problem = new AppError("ai_result_too_large", 502);
        child.kill("SIGKILL");
        return;
      }
      pending += chunk;
      let i;
      while ((i = pending.indexOf("\n")) >= 0) {
        parse(pending.slice(0, i));
        pending = pending.slice(i + 1);
      }
    });
    child.stderr.on("data", () => {});
    child.stdin.on("error", () => {});
    child.once("error", () => {
      clearTimeout(timer);
      reject(new AppError("ai_sdk_unavailable", 503));
    });
    child.once("close", async () => {
      active--;
      clearTimeout(timer);
      if (pending.trim()) parse(pending);
      try {
        await receipts;
        if (problem) throw problem;
        if (result === undefined)
          throw new AppError("ai_transport_uncertain", 502);
        resolve(result);
      } catch (e) {
        reject(e);
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}
