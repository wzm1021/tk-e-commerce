// Round up to readable intervals without clipping the tallest bar. Sales counts
// use whole units; monetary axes retain cent precision for small values.
export function trendScale(values, monetary = false) {
  const valid = values.filter(
    (v) => typeof v === "number" && Number.isFinite(v) && v >= 0,
  );
  const maximum = Math.max(1, ...valid);
  const magnitude = 10 ** Math.floor(Math.log10(maximum / 4));
  const step = Math.max(
    monetary ? 0.01 : 1,
    [1, 2, 5, 10].find((n) => n * magnitude >= maximum / 4) * magnitude,
  );
  const count = Math.ceil(maximum / step);
  const top = Number((count * step).toPrecision(12));
  return {
    top,
    ticks: Array.from({ length: count + 1 }, (_, i) =>
      Number((i * step).toPrecision(12)),
    ),
  };
}
export function trendTick(value) {
  const unit = value >= 1e8 ? 1e8 : value >= 1e4 ? 1e4 : 1;
  return (
    (value / unit).toLocaleString("zh-CN", { maximumFractionDigits: 2 }) +
    (unit === 1e8 ? "亿" : unit === 1e4 ? "万" : "")
  );
}
