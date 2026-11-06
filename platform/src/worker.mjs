import {
  readFile,
  writeFile,
  mkdir,
  rm,
  chown,
  lstat,
  readdir,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateBundle } from "./skills/skills.mjs";
import { digest, requireThat } from "./common/core.mjs";
import { RESULT_JSON_SCHEMA, ResultSchema } from "./reports/reports.mjs";
import { agentTask } from "./research/agent-task.mjs";
import { workerRetry } from "./infra/worker-retry.mjs";
import {
  ASSISTANT_JSON_SCHEMA,
  AssistantStoredResult,
} from "./assistant/assistant-contract.mjs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function runWorker() {
  const gateway = process.env.TIDELAB_GATEWAY;
  requireThat(gateway?.startsWith("https://"), "worker_https_required", 500);
  const key = (await readFile(process.env.WORKER_TOKEN_FILE)).toString(
    "base64url",
  );
  const root = path.resolve(process.env.JOBS_ROOT || "/srv/tidelab/jobs");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const baseWorkerId = process.env.WORKER_ID || "tencent-shanghai-01";
  const concurrency = Number(process.env.WORKER_CONCURRENCY || 1);
  requireThat(
    Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 32,
    "invalid_worker_concurrency",
  );
  let stopping = false;
  process.on("SIGTERM", () => {
    stopping = true;
  });
  async function request(route, body, credential = key, timeout = 30000) {
    const r = await fetch(gateway + route, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${credential}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeout),
    });
    const result = await r.json();
    requireThat(r.ok, result.error || "gateway_error", r.status);
    return result;
  }
  function docker(args) {
    return new Promise((resolve) => {
      const child = spawn("docker", args, {
        stdio: ["ignore", "ignore", "ignore"],
      });
      child.once("error", () => resolve(127));
      child.once("exit", (code) => resolve(code ?? 1));
    });
  }
  async function runSlot(slot) {
    const workerId =
      concurrency === 1 ? baseWorkerId : `${baseWorkerId}-${slot}`;
    while (!stopping) {
      let claim;
      try {
        claim = await request("/internal/worker/claim", {
          worker_id: workerId,
        });
      } catch {
        console.warn("Worker gateway unavailable");
        await sleep(10000);
        continue;
      }
      if (!claim.job) {
        await sleep(5000);
        continue;
      }
      const task = claim.job,
        jobToken = claim.job_token,
        dir = path.join(root, task.id),
        container = "tidelab-job-" + task.id;
      let heartbeat,
        submitting = false,
        preserveWorkspace = false;
      try {
        const bundle = validateBundle(
          await request("/internal/job/bundle", null, jobToken),
        );
        requireThat(
          digest(bundle) === task.snapshot.skill.digest,
          "skill_integrity_failure",
        );
        await mkdir(dir, { mode: 0o700 });
        for (const [relative, text] of Object.entries(bundle.files)) {
          const file = path.join(dir, relative);
          await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
          await writeFile(file, text, { mode: 0o600, flag: "wx" });
        }
        await mkdir(path.join(dir, "home"), { mode: 0o700 });
        await writeFile(
          path.join(dir, "task.json"),
          JSON.stringify(agentTask(task)),
          {
            mode: 0o600,
          },
        );
        await writeFile(
          path.join(dir, "result.schema.json"),
          JSON.stringify(
            task.kind === "assistant"
              ? ASSISTANT_JSON_SCHEMA
              : RESULT_JSON_SCHEMA,
          ),
          { mode: 0o600 },
        );
        await writeFile(
          path.join(dir, "result.template.json"),
          JSON.stringify(
            ResultSchema.parse({
              status: "partial",
              summary: "研究尚未完成，等待采集和核验必要证据。",
              sections: [],
              candidates: [],
              questions: [],
              limitations: ["阶段草稿，尚不构成选品或经营建议。"],
              next_actions: [],
            }),
          ),
          { mode: 0o600 },
        );
        if (task.kind !== "assistant")
          await writeFile(
            path.join(dir, "result.json"),
            await readFile(path.join(dir, "result.template.json")),
            { mode: 0o600, flag: "wx" },
          );
        async function own(p) {
          await chown(p, 10001, 10001);
          if ((await lstat(p)).isDirectory())
            for (const name of await readdir(p)) await own(path.join(p, name));
        }
        await own(dir);
        let checking = false;
        heartbeat = setInterval(async () => {
          if (checking) return;
          checking = true;
          try {
            const r = await workerRetry(
              () => request("/internal/job/heartbeat", {}, jobToken, 10000),
              { heartbeat: true },
            );
            if (r.cancel_requested || stopping)
              await docker(["kill", container]);
          } catch {
            await docker(["kill", container]);
          } finally {
            checking = false;
          }
        }, 20000);
        await request(
          "/internal/job/event",
          {
            stage: "research",
            summary: "正在读取任务固定的技能版本并采集证据",
          },
          jobToken,
        );
        // A healthy research task has no wall-clock deadline. Heartbeats still
        // stop the container on cancellation, shutdown, or loss of its lease.
        const code = await docker([
          "run",
          "--name",
          container,
          "--rm",
          "--read-only",
          "--cap-drop=ALL",
          "--security-opt=no-new-privileges",
          "--pids-limit=128",
          "--memory=2g",
          "--cpus=2",
          "--user=10001:10001",
          "--network=tidelab-agent",
          "--dns=127.0.0.1",
          "--tmpfs=/tmp:rw,nosuid,nodev,size=128m",
          "--mount",
          `type=bind,source=${dir},target=/work`,
          "--mount",
          `type=bind,source=${process.env.WORKER_CA_FILE},target=/app/ca.crt,readonly`,
          "--env",
          `TIDELAB_JOB_TOKEN=${jobToken}`,
          "--env",
          `TIDELAB_GATEWAY=${gateway}`,
          "--env",
          "NODE_EXTRA_CA_CERTS=/app/ca.crt",
          process.env.AGENT_IMAGE || "tidelab-agent:0.4.0",
        ]);
        if (code !== 0)
          console.warn(
            JSON.stringify({
              event: "agent_exit",
              job_id: task.id,
              exit_code: code,
            }),
          );
        let result;
        let failure = "agent_execution_failed";
        try {
          const completionFile = path.join(dir, "completion.json"),
            info = await lstat(completionFile);
          if (info.isFile() && !info.isSymbolicLink() && info.size < 4096) {
            const completion = JSON.parse(
              await readFile(completionFile, "utf8"),
            );
            if (
              [
                "model_context_budget_exceeded",
                "model_output_limit_reached",
                "task_budget_exhausted",
                "model_usage_missing",
                "usage_unavailable",
                "remote_tools_forbidden",
                "unsupported_tool_namespace",
                "assistant_output_invalid",
                "research_output_invalid",
                "assistant_compaction_limit",
                "assistant_compaction_invalid",
                "assistant_compaction_insufficient",
              ].includes(completion.error_code)
            )
              failure = completion.error_code;
          }
        } catch {}
        try {
          const file = path.join(dir, "result.json");
          const info = await lstat(file);
          requireThat(
            info.isFile() &&
              !info.isSymbolicLink() &&
              info.size < 3 * 1024 * 1024,
            "invalid_result_file",
          );
          result = (
            task.kind === "assistant" ? AssistantStoredResult : ResultSchema
          ).parse(JSON.parse(await readFile(file, "utf8")));
          if (code !== 0) {
            result.status = "partial";
            result.limitations?.push(
              "执行提前结束，已保留有效的阶段草稿及归档证据。",
            );
          }
        } catch (error) {
          // A malformed result is a delivery error, not missing analysis.
          // Keep the private files and exact field errors for recovery.
          preserveWorkspace = true;
          if (code === 0) failure = "research_output_invalid";
          await writeFile(
            path.join(dir, "worker-result-validation.json"),
            JSON.stringify({
              error_code: failure,
              issues: error.issues || [{ code: error.code || error.name }],
            }),
            { mode: 0o600 },
          );
          console.warn(
            JSON.stringify({
              event: "result_validation_failed",
              job_id: task.id,
              error_code: failure,
            }),
          );
        }
        if (code !== 0) preserveWorkspace = true;
        submitting = true;
        await workerRetry(() =>
          request(
            "/internal/job/finish",
            result
              ? { result, ...(code !== 0 ? { error_code: failure } : {}) }
              : {
                  error_code: failure,
                },
            jobToken,
          ),
        );
      } catch (error) {
        // Never replace a valid result with a generic failure after submission
        // failed. Keep the private workspace for explicit recovery instead.
        preserveWorkspace = submitting;
        console.warn(
          JSON.stringify({
            event: "worker_failure",
            job_id: task.id,
            error_code: error.code || error.name,
            result_preserved: preserveWorkspace,
          }),
        );
        if (!submitting)
          try {
            await request(
              "/internal/job/finish",
              { error_code: "worker_execution_failed" },
              jobToken,
            );
          } catch {}
        console.warn("Task failed; details retained in task ledger");
      } finally {
        clearInterval(heartbeat);
        await docker(["rm", "-f", container]);
        if (!preserveWorkspace) await rm(dir, { recursive: true, force: true });
      }
    }
  }
  await Promise.all(
    Array.from({ length: concurrency }, (_, i) => runSlot(i + 1)),
  );
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  runWorker().catch((e) => {
    console.error("Worker startup failed:", e.code || e.name);
    process.exitCode = 1;
  });
