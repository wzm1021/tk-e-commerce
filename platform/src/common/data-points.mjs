import { z } from "zod";
import { requireThat } from "./core.mjs";
export const CACHE_POINTS = 3n;
export function pointUnits(value) {
  const s = String(value);
  requireThat(/^\d+(\.\d)?$/.test(s), "invalid_data_points");
  const [whole, fraction = "0"] = s.split(".");
  const n = BigInt(whole) * 10n + BigInt(fraction);
  requireThat(n <= 10000000n, "invalid_data_points");
  return n;
}
export const pointBudget = (max) =>
  z
    .number()
    .min(0)
    .max(max)
    .refine((n) => /^\d+(\.\d)?$/.test(String(n)), "积分最多一位小数");
export function points(units, scale = 10) {
  const n = BigInt(units ?? 0);
  if (Number(scale) === 1) return n.toString();
  return n % 10n === 0n ? (n / 10n).toString() : `${n / 10n}.${n % 10n}`;
}
function publicRow(row) {
  const out = { ...row };
  for (const k of ["data_budget", "data_spent", "data_inflight"])
    if (out[k] != null) out[k] = points(out[k]);
  if (out.currency === "data_points")
    for (const k of ["amount", "available", "reserved"])
      if (out[k] != null)
        out[k] = points(
          out[k],
          k === "amount" ? (out.data_unit_scale ?? 10) : 10,
        );
  if (out.kind === "data")
    for (const k of ["reserved", "charged", "procurement"])
      if (out[k] != null) out[k] = points(out[k]);
  if (out.calls) out.calls = out.calls.map(publicRow);
  return out;
}
// Only known billing containers are converted. User requests, results and notes are opaque.
export function publicBilling(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const out = publicRow(payload);
  for (const k of ["items", "jobs", "turns", "wallets", "ledger"])
    if (Array.isArray(out[k])) out[k] = out[k].map(publicRow);
  return out;
}
