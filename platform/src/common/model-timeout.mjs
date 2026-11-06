// The upstream limit excludes queueing. Callers retain time for the resource
// queue, usage settlement and delivery of a readable timeout response.
export const MODEL_RESPONSE_TIMEOUT_MS = 600_000;
export const MODEL_CLIENT_TIMEOUT_MS = 690_000;
export const MODEL_TRANSPORT_TIMEOUT_MS = 610_000;
export const MODEL_SERVER_TIMEOUT_MS = 720_000;
