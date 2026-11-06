import { AlertCircle, LoaderCircle } from "lucide-react";
import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
} from "react";
import { stateLabels, errorText } from "../lib/format.mjs";
import { nativeValidationMessage } from "../lib/validation-errors.mjs";

export function RequiredMark() {
  return <span className="field-required">* 必填</span>;
}
export function Field({
  label,
  children,
  hint,
  wide = false,
  required = false,
}) {
  const marked = typeof label === "string" && /\s*\*\s*$/.test(label);
  const isRequired =
    required ||
    marked ||
    Children.toArray(children).some(
      (child) => isValidElement(child) && child.props.required,
    );
  return (
    <label className={"field" + (wide ? " wide" : "")}>
      <span>
        {marked ? label.replace(/\s*\*\s*$/, "") : label}
        {isRequired && (
          <>
            {" "}
            <RequiredMark />
          </>
        )}
      </span>
      {Children.map(children, (child) =>
        isValidElement(child) &&
        ["input", "textarea", "select"].includes(child.type)
          ? cloneElement(child, {
              "aria-required": isRequired || undefined,
              onInvalid: (e) => {
                e.currentTarget.setCustomValidity(
                  nativeValidationMessage(e.currentTarget),
                );
                child.props.onInvalid?.(e);
              },
              onInput: (e) => {
                e.currentTarget.setCustomValidity("");
                child.props.onInput?.(e);
              },
            })
          : child,
      )}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Button({ children, secondary = false, ...props }) {
  return (
    <button className={secondary ? "button secondary" : "button"} {...props}>
      {children}
    </button>
  );
}
export function Badge({ value, label }) {
  return (
    <span className={"badge " + value}>
      {label || stateLabels[value] || value}
    </span>
  );
}
export function Empty({ title = "这里还没有记录", children }) {
  return (
    <div className="empty">
      <span className="empty-mark">↗</span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function ErrorBox({ error, focus = false }) {
  const ref = useRef(null);
  useEffect(() => {
    if (focus && error) ref.current?.focus();
  }, [error, focus]);
  return error ? (
    <div
      className="error"
      role="alert"
      ref={ref}
      tabIndex={focus ? -1 : undefined}
    >
      <AlertCircle size={17} />
      <span>{errorText(error)}</span>
    </div>
  ) : null;
}
export function Loading() {
  return (
    <div className="loading">
      <LoaderCircle className="spin" size={19} />
      正在加载…
    </div>
  );
}
export function JsonView({ value }) {
  return <pre className="json-view">{JSON.stringify(value, null, 2)}</pre>;
}
