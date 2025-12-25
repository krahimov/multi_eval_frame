import assert from "node:assert/strict";
import {
  detectOutlierIQR,
  detectOutlierMAD,
  detectOutlierZScore,
  iqrBounds,
  median,
  quantile
} from "../src/eval/outliers.js";
import { benjaminiHochberg, cusumTwoSided, ewma, welchTTest } from "../src/eval/changeDetection.js";

function ok(name: string): void {
  // eslint-disable-next-line no-console
  console.log(`ok - ${name}`);
}

// outliers: quantiles
{
  const xs = [1, 2, 3, 4];
  assert.equal(quantile(xs, 0), 1);
  assert.equal(quantile(xs, 1), 4);
  assert.equal(quantile(xs, 0.5), 2.5);
  assert.equal(median(xs), 2.5);
  ok("quantiles");
}

// outliers: IQR false positives regression
{
  const xs = Array.from({ length: 100 }, (_, i) => i + 1);
  const { low, high } = iqrBounds(xs);
  assert.ok(50 >= low && 50 <= high);
  const res = detectOutlierIQR(xs, 50);
  assert.equal(res.is_outlier, false);
  ok("iqr_false_positive_regression");
}

// outliers: MAD flags extreme values
{
  const xs = Array.from({ length: 200 }, (_, i) => 100 + i);
  const res = detectOutlierMAD(xs, 10_000);
  assert.equal(res.method, "mad");
  assert.equal(res.is_outlier, true);
  ok("mad_flags_extreme_outlier");
}

// outliers: Z-score false positives regression
{
  const xs = [10, 11, 12, 9, 10, 11, 12, 10, 11, 9];
  const res = detectOutlierZScore(xs, 10.5, 3);
  assert.equal(res.is_outlier, false);
  ok("zscore_false_positive_regression");
}

// change detection: BH monotonicity
{
  const p = [
    { id: "a", p_value: 0.01 },
    { id: "b", p_value: 0.04 },
    { id: "c", p_value: 0.03 },
    { id: "d", p_value: 0.2 }
  ];
  const res = benjaminiHochberg(p, 0.05);
  const qSorted = [...res].sort((x, y) => x.p_value - y.p_value).map((x) => x.q_value);
  assert.ok(qSorted[0]! <= qSorted[1]! && qSorted[1]! <= qSorted[2]! && qSorted[2]! <= qSorted[3]!);
  ok("benjamini_hochberg_monotone");
}

// change detection: Welch test detects shift
{
  const a = Array.from({ length: 50 }, () => 1.0);
  const b = Array.from({ length: 50 }, () => 0.5);
  const t = welchTTest(a, b);
  assert.equal(t.effect_size, 0.5);
  assert.ok(t.p_value_two_sided < 0.001);
  ok("welch_detects_shift");
}

// change detection: EWMA follows trend
{
  const xs = [0, 0, 0, 1, 1, 1];
  const e = ewma(xs, 0.5);
  assert.equal(e.length, xs.length);
  assert.equal(e[0]!.ewma, 0);
  assert.ok(e[e.length - 1]!.ewma > 0.5);
  ok("ewma_follows_trend");
}

// change detection: CUSUM flags persistent shift
{
  const baseline = Array.from({ length: 20 }, () => 0.0);
  const shifted = Array.from({ length: 20 }, () => 1.0);
  const xs = [...baseline, ...shifted];
  const cus = cusumTwoSided(xs, 0.0, 0.1, 2.0);
  assert.equal(cus[cus.length - 1]!.signal, true);
  ok("cusum_flags_shift");
}

// eslint-disable-next-line no-console
console.log("All tests passed.");


