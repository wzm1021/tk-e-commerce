import { useState, useRef, useId, useEffect } from "react";
import { candidateKey, searchCandidates } from "./candidate-search.mjs";
export function CandidatePicker({
  candidates,
  value,
  onChange,
  arm,
  disabled,
}) {
  const [query, setQuery] = useState(""),
    [open, setOpen] = useState(false),
    [active, setActive] = useState(0);
  const root = useRef(null),
    listId = useId();
  const selected = candidates.find((c) => candidateKey(c) === value);
  const results = searchCandidates(candidates, query),
    visible = results.slice(0, 60);
  const current = Math.min(active, Math.max(0, visible.length - 1));
  useEffect(() => {
    const close = (e) => {
      if (!root.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  useEffect(() => {
    if (open)
      document
        .getElementById(`${listId}-${current}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [current, open, listId]);
  function choose(c) {
    if (disabled) return;
    onChange(candidateKey(c));
    setQuery("");
    setOpen(false);
  }
  return (
    <div
      className="ai-candidate-picker"
      ref={root}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <label htmlFor={listId + "-input"}>从候选商品导入</label>
      <div className="ai-candidate-input">
        <input
          id={listId + "-input"}
          role="combobox"
          aria-label={arm + " 搜索候选商品"}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && visible.length ? `${listId}-${current}` : undefined
          }
          disabled={disabled}
          value={open ? query : selected?.title || ""}
          placeholder="搜索商品名称、ID / ASIN 或关键词…"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
            onChange("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              e.preventDefault();
            }
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setOpen(true);
              setActive((n) =>
                Math.max(
                  0,
                  Math.min(
                    visible.length - 1,
                    n + (e.key === "ArrowDown" ? 1 : -1),
                  ),
                ),
              );
            }
            if (e.key === "Enter" && open) {
              e.preventDefault();
              if (visible[current]) choose(visible[current]);
            }
          }}
        />
        {(value || query) && (
          <button
            type="button"
            aria-label={arm + " 清除候选商品"}
            disabled={disabled}
            onClick={() => {
              onChange("");
              setQuery("");
              setActive(0);
              setOpen(true);
              root.current.querySelector("input").focus();
            }}
          >
            ×
          </button>
        )}
      </div>
      {open && (
        <div className="ai-candidate-menu">
          <div className="ai-candidate-count" role="status">
            {results.length
              ? `找到 ${results.length} 个候选商品${results.length > 60 ? "，请细化关键词查看其余结果" : ""}`
              : "未找到匹配商品，试试名称片段、编号或其他关键词"}
          </div>
          <div id={listId} role="listbox" aria-label={arm + " 候选商品"}>
            {visible.map((c, i) => (
              <div
                key={candidateKey(c)}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={candidateKey(c) === value}
                className={i === current ? "is-active" : ""}
                onPointerDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(c)}
              >
                <strong>{c.title || "未命名商品"}</strong>
                <small>
                  {c.product_id} · {c.market}
                </small>
                {c.keywords?.length > 0 && (
                  <small>{c.keywords.join(" · ")}</small>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {selected && (
        <p className="ai-candidate-selected">
          已选择：{selected.title} <small>{selected.product_id}</small>
        </p>
      )}
      <small className="muted">
        支持名称片段、多个关键词和英文近似拼写；仅列出当前市场的候选商品。
      </small>
    </div>
  );
}
