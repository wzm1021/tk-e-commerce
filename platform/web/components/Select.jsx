import { useState, useEffect, useRef, useId } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

export function Select({
  value,
  defaultValue,
  onChange,
  options,
  ariaLabel,
  name,
  disabled = false,
  variant = "line",
  size = "md",
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [own, setOwn] = useState(defaultValue ?? options[0]?.value ?? "");
  const [rect, setRect] = useState(null);
  const root = useRef(null);
  const trigger = useRef(null);
  const list = useRef(null);
  const id = useId();
  const current = value !== undefined ? value : own;
  const selected = options.find((o) => o.value === current);
  useEffect(() => {
    if (!open) return;
    const away = (e) => {
      if (
        !root.current?.contains(e.target) &&
        !list.current?.contains(e.target)
      )
        setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const place = () =>
      setRect(trigger.current?.getBoundingClientRect() ?? null);
    place();
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    setActive(
      Math.max(
        0,
        options.findIndex((o) => o.value === current),
      ),
    );
    requestAnimationFrame(() =>
      list.current
        ?.querySelector('[aria-selected="true"]')
        ?.scrollIntoView({ block: "nearest" }),
    );
  }, [open, current]);
  useEffect(() => {
    if (open)
      list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active, open]);
  function pick(option) {
    if (value === undefined) setOwn(option.value);
    onChange?.(option.value);
    setOpen(false);
    trigger.current?.focus();
  }
  function key(e) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === "Escape" || e.key === "Tab") {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) =>
        Math.max(
          0,
          Math.min(options.length - 1, a + (e.key === "ArrowDown" ? 1 : -1)),
        ),
      );
      return;
    }
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive(e.key === "Home" ? 0 : options.length - 1);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (options[active]) pick(options[active]);
    }
  }
  function menuStyle() {
    const min = size === "sm" ? 180 : variant === "box" ? 260 : 340;
    const width = Math.min(Math.max(rect.width, min), 560);
    const below = window.innerHeight - rect.bottom;
    const flip = below < 320 && rect.top > below;
    return {
      width,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      ...(flip
        ? { bottom: window.innerHeight - rect.top + 6 }
        : { top: rect.bottom + 6 }),
    };
  }
  return (
    <div
      className={
        "select" +
        (open ? " open" : "") +
        (variant === "box" ? " select-box" : "") +
        (size === "sm" ? " select-sm" : "") +
        (className ? " " + className : "")
      }
      ref={root}
      onKeyDown={key}
    >
      {name && <input type="hidden" name={name} value={current ?? ""} />}
      <button
        type="button"
        ref={trigger}
        className="select-trigger"
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id + "-list" : undefined}
        aria-activedescendant={open ? id + "-" + active : undefined}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{selected?.title ?? "—"}</span>
        <ChevronDown size={15} />
      </button>
      {open &&
        createPortal(
          <ul
            ref={list}
            id={id + "-list"}
            className="select-menu"
            style={rect ? menuStyle() : { visibility: "hidden" }}
            role="listbox"
            aria-label={ariaLabel}
          >
            {options.map((o, i) => (
              <li
                key={o.value}
                id={id + "-" + i}
                role="option"
                aria-selected={o.value === current}
                className={i === active ? "active" : ""}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o)}
              >
                <span>{o.title}</span>
                {o.hint ? <small>{o.hint}</small> : null}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </div>
  );
}
