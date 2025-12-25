import { describe, expect, it } from "vitest";
import { benjaminiHochberg, cusumTwoSided, ewma, welchTTest } from "../src/eval/changeDetection.js";

describe("change detection", () => {
  it("Benjamini-Hochberg produces monotone q-values", () => {
    const p = [
      { id: "a", p_value: 0.01 },
      { id: "b", p_value: 0.04 },
      { id: "c", p_value: 0.03 },
      { id: "d", p_value: 0.2 }
    ];
    const res = benjaminiHochberg(p, 0.05);
    const qSorted = [...res].sort((x, y) => x.p_value - y.p_value).map((x) => x.q_value);
    expect(qSorted[0]!).toBeLessThanOrEqual(qSorted[1]!);
    expect(qSorted[1]!).toBeLessThanOrEqual(qSorted[2]!);
    expect(qSorted[2]!).toBeLessThanOrEqual(qSorted[3]!);
  });

  it("Welch t-test detects obvious mean shift (normal approx)", () => {
    const a = Array.from({ length: 50 }, () => 1.0);
    const b = Array.from({ length: 50 }, () => 0.5);
    const t = welchTTest(a, b);
    expect(t.effect_size).toBeCloseTo(0.5);
    expect(t.p_value_two_sided).toBeLessThan(0.001);
  });

  it("EWMA is stable and follows trend", () => {
    const xs = [0, 0, 0, 1, 1, 1];
    const e = ewma(xs, 0.5);
    expect(e.length).toBe(xs.length);
    expect(e[0]!.ewma).toBeCloseTo(0);
    expect(e[e.length - 1]!.ewma).toBeGreaterThan(0.5);
  });

  it("CUSUM flags strong persistent shift", () => {
    const baseline = Array.from({ length: 20 }, () => 0.0);
    const shifted = Array.from({ length: 20 }, () => 1.0);
    const xs = [...baseline, ...shifted];
    const cus = cusumTwoSided(xs, 0.0, 0.1, 2.0);
    expect(cus[cus.length - 1]!.signal).toBe(true);
  });
});


