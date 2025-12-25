export type OutlierMethod = "zscore" | "mad" | "iqr";

export interface OutlierResult {
  method: OutlierMethod;
  is_outlier: boolean;
  value: number;
  z_score: number | null;
  threshold_low: number | null;
  threshold_high: number | null;
  details?: Record<string, unknown>;
}

function assertNonEmpty(values: number[]): void {
  if (values.length === 0) throw new Error("values must be non-empty");
}

function sorted(values: number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

export function quantile(values: number[], q: number): number {
  assertNonEmpty(values);
  const v = sorted(values);
  const clamped = Math.min(1, Math.max(0, q));
  const pos = (v.length - 1) * clamped;
  const base = Math.floor(pos);
  const rest = pos - base;
  const left = v[base]!;
  const right = v[Math.min(v.length - 1, base + 1)]!;
  return left + rest * (right - left);
}

export function median(values: number[]): number {
  return quantile(values, 0.5);
}

export function mean(values: number[]): number {
  assertNonEmpty(values);
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function stddevSample(values: number[]): number {
  assertNonEmpty(values);
  if (values.length < 2) return 0;
  const m = mean(values);
  const varSum = values.reduce((acc, x) => acc + (x - m) * (x - m), 0);
  return Math.sqrt(varSum / (values.length - 1));
}

export function mad(values: number[]): number {
  assertNonEmpty(values);
  const m = median(values);
  const devs = values.map((x) => Math.abs(x - m));
  return median(devs);
}

export function zScore(value: number, m: number, s: number): number {
  if (s === 0) return 0;
  return (value - m) / s;
}

export function robustZScore(value: number, med: number, madValue: number): number {
  if (madValue === 0) return 0;
  // 0.6745 makes MAD comparable to stddev under normality
  return (0.6745 * (value - med)) / madValue;
}

export function iqrBounds(values: number[], k = 1.5): { low: number; high: number; q1: number; q3: number } {
  assertNonEmpty(values);
  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  const iqr = q3 - q1;
  return { low: q1 - k * iqr, high: q3 + k * iqr, q1, q3 };
}

export function detectOutlierZScore(
  values: number[],
  value: number,
  zThreshold = 3
): OutlierResult {
  assertNonEmpty(values);
  const m = mean(values);
  const s = stddevSample(values);
  const z = zScore(value, m, s);
  return {
    method: "zscore",
    is_outlier: Math.abs(z) > zThreshold,
    value,
    z_score: z,
    threshold_low: m - zThreshold * s,
    threshold_high: m + zThreshold * s,
    details: { mean: m, stddev: s, zThreshold }
  };
}

export function detectOutlierMAD(
  values: number[],
  value: number,
  robustZThreshold = 3.5
): OutlierResult {
  assertNonEmpty(values);
  const med = median(values);
  const madValue = mad(values);
  const rz = robustZScore(value, med, madValue);
  return {
    method: "mad",
    is_outlier: Math.abs(rz) > robustZThreshold,
    value,
    z_score: rz,
    threshold_low: null,
    threshold_high: null,
    details: { median: med, mad: madValue, robustZThreshold }
  };
}

export function detectOutlierIQR(values: number[], value: number, k = 1.5): OutlierResult {
  assertNonEmpty(values);
  const { low, high, q1, q3 } = iqrBounds(values, k);
  return {
    method: "iqr",
    is_outlier: value < low || value > high,
    value,
    z_score: null,
    threshold_low: low,
    threshold_high: high,
    details: { q1, q3, k }
  };
}


