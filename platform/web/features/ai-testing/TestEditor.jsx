import { useState, useEffect, useRef } from "react";
import { Button, ErrorBox, Loading } from "../../components/ui.jsx";
import { requiredTestFields } from "../../lib/ai-test-required.mjs";
import { fieldErrorsText } from "../../lib/validation-errors.mjs";
import { ArmCard } from "./ArmCard.jsx";
import { TestSettings } from "./TestSettings.jsx";
import { TestReview } from "./TestReview.jsx";
import { inherited, markets } from "./model.mjs";
import {
  AI_TEST_PERSONA_ERROR,
  validPersonaCount,
  productLinkError,
} from "../../lib/ai-test-limits.mjs";
export function TestEditor({ id, api, workspace, onBack, onSubmitted }) {
  const [loaded, setLoaded] = useState(null),
    [data, setData] = useState(null),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [candidates, setCandidates] = useState([]),
    [audience, setAudience] = useState(null),
    [review, setReview] = useState(null);
  const translations = useRef(new Map());
  const guard = useRef(0),
    base = "/api/ai-tests/" + id;
  function accept(x) {
    setLoaded(x);
    setData(x.draft.data);
    setDirty(false);
    setReview(null);
  }
  async function load() {
    const x = await api(base);
    accept(x);
    return x;
  }
  useEffect(() => {
    let live = true;
    Promise.all([api(base), api("/api/ai-tests/candidates")])
      .then(([x, c]) => {
        if (live) {
          accept(x);
          setCandidates(c.items);
        }
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [api, base]);
  useEffect(() => {
    if (
      dirty ||
      busy ||
      review ||
      !loaded?.images.some((i) => ["queued", "processing"].includes(i.state))
    )
      return;
    let live = true;
    const generation = guard.current;
    const t = setInterval(
      () =>
        api(base)
          .then((x) => {
            if (live && generation === guard.current) accept(x);
          })
          .catch(() => {}),
      2500,
    );
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [api, base, dirty, busy, review, loaded]);
  useEffect(() => {
    if (
      !loaded?.suggestions?.some((s) =>
        ["queued", "generating"].includes(s.state),
      )
    )
      return;
    let live = true;
    const timer = setInterval(
      () =>
        api(base)
          .then((x) => {
            if (live)
              setLoaded((old) => ({ ...old, suggestions: x.suggestions }));
          })
          .catch(() => {}),
      2500,
    );
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [api, base, loaded?.suggestions]);
  useEffect(() => {
    let live = true;
    for (const row of loaded?.suggestions || []) {
      if (row.state !== "ready" || row.stale || !row.needs_translation)
        continue;
      const key = base + ":" + row.id;
      if (!translations.current.has(key))
        translations.current.set(
          key,
          api(base + "/translate-suggestions", {
            method: "POST",
            body: { suggestion_id: row.id },
          }),
        );
      translations.current
        .get(key)
        .then((result) => {
          if (live)
            setLoaded((old) => ({ ...old, suggestions: result.suggestions }));
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    }
    return () => {
      live = false;
    };
  }, [api, base, loaded?.suggestions]);
  function change(fn) {
    guard.current++;
    setData((old) => {
      const next = structuredClone(old);
      fn(next);
      return next;
    });
    setDirty(true);
    setReview(null);
    setNotice("");
  }
  async function save() {
    if (!validPersonaCount(data.persona_count))
      throw new Error(AI_TEST_PERSONA_ERROR);
    const linkError = data.arms.map(productLinkError).find(Boolean);
    if (linkError) throw new Error(linkError);
    if (!dirty) return loaded.draft;
    const result = await api(base, {
      method: "PUT",
      body: { version: loaded.draft.version, data },
    });
    setLoaded((old) => ({ ...old, draft: result }));
    setData(result.data);
    setDirty(false);
    return result;
  }
  async function task(fn, onError) {
    setError("");
    setNotice("");
    setBusy(true);
    guard.current++;
    try {
      return await fn();
    } catch (e) {
      setError(e.message);
      onError?.(e);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function action(suffix, body, onError) {
    return task(async () => {
      const payload = typeof body === "function" ? await body() : body,
        d = await save();
      const result = await api(base + suffix, {
        method: "POST",
        body: { version: d.version, ...payload },
      });
      await load();
      setNotice(
        suffix === "/apply-suggestions"
          ? `已填入 ${Object.keys(result.applied || {}).length} 项建议，请继续核对；已有内容已保留。`
          : suffix === "/arm-import"
            ? "商品已导入，正在为缺失信息生成建议。"
            : "草稿已更新，请核对信息。",
      );
      return true;
    }, onError);
  }
  if (!loaded) return error ? <ErrorBox error={error} /> : <Loading />;
  return (
    <div className="ai-testing">
      <div className="ai-toolbar">
        <Button
          secondary
          disabled={busy}
          onClick={() =>
            task(async () => {
              await save();
              onBack();
            })
          }
        >
          保存并返回列表
        </Button>
        <span>
          {dirty ? "有未保存的修改" : "草稿已保存"} · 版本{" "}
          {loaded.draft.version}
        </span>
        <Button
          secondary
          disabled={busy}
          onClick={() =>
            task(async () => {
              await save();
              setNotice("已保存草稿。");
            })
          }
        >
          保存草稿
        </Button>
      </div>
      <ErrorBox error={error} focus />
      {error && (
        <Button
          secondary
          disabled={busy}
          onClick={() =>
            task(async () => {
              await load();
              setNotice("已重新载入最新草稿。");
            })
          }
        >
          重新载入（放弃未保存修改）
        </Button>
      )}
      {notice && (
        <p className="ai-note" role="status">
          {notice}
        </p>
      )}
      <div className="ai-note">
        先核对商品信息，再比较页面方案。导入、编辑、截图和预检均不消耗测品次数。
        <small>
          数据来源保留原始记录；下面的可编辑内容才会进入本次测试。缺少的事实请补充，或保留未知。
        </small>
        <small>
          标有“*
          必填”的内容需在预检前补齐，保存草稿可暂时留空。商品用途与消费者问题的条件要求见对应提示。选填内容不确定时可留空。
        </small>
      </div>
      <fieldset disabled={busy}>
        <TestSettings
          data={data}
          change={change}
          audience={audience}
          busy={busy}
          loadAudience={() =>
            task(async () => {
              const d = await save();
              setAudience(
                await api(base + "/audience", {
                  method: "POST",
                  body: { market: d.data.market },
                }),
              );
            })
          }
        />
        <div className="ai-grid" style={{ marginTop: 20 }}>
          {data.arms.map((arm) => (
            <ArmCard
              key={arm.id}
              data={data}
              arm={arm}
              images={loaded.images}
              suggestion={loaded.suggestions?.find((s) => s.arm === arm.id)}
              hasSource={Boolean(loaded.draft.sources[arm.id])}
              workspace={workspace}
              change={change}
              action={action}
              busy={busy}
              error={error}
              candidates={candidates.filter((c) => {
                const region = { US: "us", GB: "uk", UK: "uk", JP: "jp" }[
                  c.market
                ];
                return !region || c.platform + "_" + region === data.market;
              })}
            />
          ))}
        </div>
        <div className="ai-actions">
          {data.arms.length < 6 && (
            <Button
              secondary
              onClick={() =>
                change((d) => {
                  const next = structuredClone(d.arms[0]);
                  next.id = String.fromCharCode(65 + d.arms.length);
                  next.label = "对比方案 " + next.id;
                  next.other_product = false;
                  next.inherit = inherited;
                  next.url = "";
                  next.image_id = null;
                  next.change_summary = "";
                  d.arms.push(next);
                })
              }
            >
              增加对比方案
            </Button>
          )}
          {data.arms.length > 2 && (
            <Button
              secondary
              onClick={() =>
                change((d) => {
                  d.arms.pop();
                })
              }
            >
              移除最后一个方案
            </Button>
          )}
        </div>
        <details className="ai-card">
          <summary>查看导入的原始商品资料</summary>
          <p>
            保留该商品的完整候选记录、已保存补查和关联资料，供核对。SDK
            不支持的销量、评论、竞店等资料不会自动拼入模拟事实。
          </p>
          {Object.entries(loaded.draft.sources).map(([arm, source]) => (
            <details key={arm}>
              <summary>
                {arm} · {source.candidate?.title || "来源记录"}
              </summary>
              <pre className="ai-json">{JSON.stringify(source, null, 2)}</pre>
            </details>
          ))}
        </details>
        <div className="ai-toolbar ai-note">
          <div>
            <strong>每次成功测试扣 1 次</strong>
            <small>
              {data.persona_count} 位虚拟消费者 × {data.arms.length}{" "}
              个方案；每人每方案 {data.sessions_per_arm} 次模拟
            </small>
            <small>提交时预留 1 次，失败或取消后退回。</small>
          </div>
          <Button
            disabled={busy || !markets[data.market]}
            onClick={() =>
              task(async () => {
                const missing = requiredTestFields(data);
                if (missing.length)
                  throw new Error(
                    "请补齐必填内容：\n" + fieldErrorsText(missing, "ai-testing"),
                  );
                await save();
                const r = await api(base + "/review");
                const e = await api(base + "/estimate", {
                  method: "POST",
                  body: {},
                });
                if (e.digest !== r.digest)
                  throw new Error("草稿已变化，请重新核对。");
                setReview({ ...r, estimate: e.estimate });
              })
            }
          >
            {busy ? "处理中…" : "预检并确认信息"}
          </Button>
        </div>
      </fieldset>
      {review && (
        <TestReview
          review={review}
          data={data}
          workspace={workspace}
          busy={busy}
          onClose={() => !busy && setReview(null)}
          onSubmit={() =>
            task(async () => {
              const r = await api(base + "/submit", {
                method: "POST",
                body: {
                  version: review.version,
                  digest: review.digest,
                  confirmed: true,
                },
              });
              setReview(null);
              onSubmitted(r);
            })
          }
          error={error}
        />
      )}
    </div>
  );
}
