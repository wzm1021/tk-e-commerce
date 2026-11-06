import { errorLabel } from "./format.mjs";
import { customerPresentation, displayText } from "./presentation.mjs";
import { fieldErrorsText } from "./validation-errors.mjs";

export function makeApi(audience = "web", workspace = "") {
  return async (path, { method = "GET", body, signal } = {}) => {
    const cookie =
      audience === "admin" ? "tidelab_admin_csrf" : "tidelab_session_csrf";
    const csrf =
      document.cookie
        .split("; ")
        .find((x) => x.startsWith(cookie + "="))
        ?.slice(cookie.length + 1) || "";
    let response;
    try {
      response = await fetch(path, {
        method,
        signal,
        credentials: "same-origin",
        headers: {
          ...(workspace ? { "X-Workspace-Id": workspace } : {}),
          ...(body !== undefined
            ? {
                "Content-Type": "application/json",
                "X-CSRF-Token": decodeURIComponent(csrf),
              }
            : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (cause) {
      if (cause.name === "AbortError") throw cause;
      throw Object.assign(new Error(errorLabel("network_error")), {
        code: "network_error",
      });
    }
    const fallbackCode =
      response.status === 413
        ? "body_too_large"
        : response.status >= 500
          ? "service_unavailable"
          : "request_failed";
    let result;
    try {
      result = await response.json();
    } catch (e) {
      if (e.name === "AbortError") throw e;
      const code = response.ok ? "invalid_response" : fallbackCode;
      throw Object.assign(new Error(errorLabel(code)), {
        code,
        status: response.status,
      });
    }
    if (!response.ok) {
      const code =
        typeof result?.error === "string" ? result.error : fallbackCode;
      const fields = fieldErrorsText(
        result?.fields,
        path.startsWith("/api/ai-tests") ? "ai-testing" : "",
      );
      const error = new Error(
        (audience === "web"
          ? displayText(errorLabel(code))
          : errorLabel(code)) + (fields ? "：" + fields : ""),
      );
      error.code = code;
      error.status = response.status;
      throw error;
    }
    return audience === "web" ? customerPresentation(result) : result;
  };
}
