import { useEffect, useState } from "react";
import { errorLabel } from "../../lib/format.mjs";
import { randomId } from "../../lib/client-id.mjs";

// Serialize automatic supplements so large reports do not flood the model gateway.
let queue = Promise.resolve();

export function CandidateKeywords({ api, reportId, productId }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState("");
  useEffect(() => {
    let active = true,
      timer;
    setResult(null);
    setError("");
    const load = async () => {
      if (!active) return;
      try {
        const value = await api(
          `/api/reports/${reportId}/candidates/${encodeURIComponent(productId)}/keywords`,
          {
            method: "POST",
            body: attempt ? { retry_key: attempt } : {},
          },
        );
        if (!active) return;
        setResult(value);
        if (value.status === "running") timer = setTimeout(enqueue, 3000);
      } catch (e) {
        if (active) setError(e.message);
      }
    };
    const enqueue = () => {
      queue = queue.then(load, load);
    };
    enqueue();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [api, reportId, productId, attempt]);
  return (
    <div className="candidate-keywords">
      {result?.terms?.length > 0 ? (
        <>
          <div className="keyword-tags">
            {result.terms.map((term) => (
              <span key={term}>{term}</span>
            ))}
          </div>
          <small>
            {result.source === "evidence"
              ? "已有关键词 · 热度待核验"
              : "AI 建议 · 热度待验证"}
          </small>
        </>
      ) : result?.status === "reconciling" ? (
        <small>调用结算中，请稍后重新打开</small>
      ) : error || ["failed", "cancelled"].includes(result?.status) ? (
        <>
          <small>
            {error ||
              errorLabel(result?.error_code || "keyword_generation_failed")}
          </small>
          <button
            className="text-button"
            onClick={() => setAttempt(randomId())}
          >
            重试生成
          </button>
        </>
      ) : (
        <small role="status">正在补充热词建议…</small>
      )}
    </div>
  );
}
