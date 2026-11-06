import { Agent, fetch } from "undici";
import { MODEL_CLIENT_TIMEOUT_MS } from "../common/model-timeout.mjs";

// Node's default HTTP header timeout can precede the model's hard deadline.
const dispatcher = new Agent({
  headersTimeout: MODEL_CLIENT_TIMEOUT_MS,
  bodyTimeout: MODEL_CLIENT_TIMEOUT_MS,
});
export const gatewayFetch = (url, options) =>
  fetch(url, {
    ...options,
    dispatcher,
    signal: options.signal || AbortSignal.timeout(MODEL_CLIENT_TIMEOUT_MS),
  });
