import test from "node:test";
import assert from "node:assert/strict";
import {
  trendScale,
  trendTick,
} from "../web/features/scouting/trend-scale.mjs";
test("trend axis starts at zero, fits all values and uses integer sales ticks", () => {
  for (const maximum of [0, 1, 2, 3, 9, 102, 148, 9999, 1e9]) {
    const scale = trendScale([null, undefined, NaN, Infinity, -1, maximum]);
    assert.equal(scale.ticks[0], 0);
    assert.ok(scale.top >= maximum);
    assert.ok(scale.ticks.length <= 5);
    assert.ok(scale.ticks.every(Number.isInteger));
    assert.equal(scale.ticks.at(-1), scale.top);
  }
  assert.deepEqual(trendScale([148]), { top: 150, ticks: [0, 50, 100, 150] });
});
test("monetary axes preserve decimals and large labels remain readable", () => {
  assert.deepEqual(trendScale([1.23], true), {
    top: 1.5,
    ticks: [0, 0.5, 1, 1.5],
  });
  assert.equal(trendTick(0.5), "0.5");
  assert.equal(trendTick(25000), "2.5万");
  assert.equal(trendTick(1e8), "1亿");
  assert.deepEqual(trendScale([]), { top: 1, ticks: [0, 1] });
});
