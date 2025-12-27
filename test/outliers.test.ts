import { describe, expect, it } from "vitest";
import { detectOutlierIQR, detectOutlierMAD, detectOutlierZScore, iqrBounds, median, quantile } from "../src/eval/outliers.js";

describe("outliers", () => {
  it("computes quantiles deterministically", () => {
    const xs = [1, 2, 3, 4];
    expect(quantile(xs, 0)).toBe(1);
    expect(quantile(xs, 1)).toBe(4);
    expect(quantile(xs, 0.5)).toBe(2.5);
    expect(median(xs)).toBe(2.5);
  });

  it("IQR bounds do not flag middle values (regression against false positives)", () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    const { low, high } = iqrBounds(xs);
    expect(50).toBeGreaterThanOrEqual(low);
    expect(50).toBeLessThanOrEqual(high);

    const res = detectOutlierIQR(xs, 50);
    expect(res.is_outlier).toBe(false);
  });

  it("MAD robust z-score flags extreme outliers", () => {
    const xs = Array.from({ length: 200 }, (_, i) => 100 + i); // 100..299
    const res = detectOutlierMAD(xs, 10_000);
    expect(res.is_outlier).toBe(true);
    expect(res.method).toBe("mad");
  });

  it("Z-score does not flag typical values (regression against false positives)", () => {
    const xs = [10, 11, 12, 9, 10, 11, 12, 10, 11, 9];
    const res = detectOutlierZScore(xs, 10.5, 3);
    expect(res.is_outlier).toBe(false);
  });
});



