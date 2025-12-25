import { mean, stddevSample } from "./outliers.js";

export interface WelchTTestResult {
  t_stat: number;
  df: number;
  p_value_two_sided: number;
  mean_a: number;
  mean_b: number;
  effect_size: number; // mean_a - mean_b
  n_a: number;
  n_b: number;
}

// Abramowitz-Stegun approximation for erf -> normal CDF.
function erfApprox(x: number): number {
  // constants
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1 / (1 + p * absX);
  const y =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) *
      Math.exp(-absX * absX);
  return sign * y;
}

export function normalCdf(x: number): number {
  // Φ(x) = 1/2 (1 + erf(x / sqrt(2)))
  return 0.5 * (1 + erfApprox(x / Math.SQRT2));
}

export function welchTTest(a: number[], b: number[]): WelchTTestResult {
  if (a.length < 2 || b.length < 2) {
    throw new Error("Welch t-test requires at least 2 samples per group");
  }

  const meanA = mean(a);
  const meanB = mean(b);
  const stdA = stddevSample(a);
  const stdB = stddevSample(b);
  const varA = stdA * stdA;
  const varB = stdB * stdB;

  const nA = a.length;
  const nB = b.length;

  const se2 = varA / nA + varB / nB;
  const se = Math.sqrt(se2);
  const t = se === 0 ? (meanA === meanB ? 0 : Number.POSITIVE_INFINITY) : (meanA - meanB) / se;

  // Welch–Satterthwaite equation for degrees of freedom
  const num = se2 * se2;
  const den = (varA * varA) / (nA * nA * (nA - 1)) + (varB * varB) / (nB * nB * (nB - 1));
  const df = den === 0 ? nA + nB - 2 : num / den;

  // For large df, approximate Student-t with Normal.
  const p =
    Number.isFinite(t) ? 2 * (1 - normalCdf(Math.abs(t))) : 0;

  return {
    t_stat: t,
    df,
    p_value_two_sided: p,
    mean_a: meanA,
    mean_b: meanB,
    effect_size: meanA - meanB,
    n_a: nA,
    n_b: nB
  };
}

export interface BootstrapResult {
  delta_mean: number;
  ci_low: number;
  ci_high: number;
  p_value_two_sided: number;
  iterations: number;
}

function sampleWithReplacement(xs: number[], n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(Math.random() * xs.length);
    out.push(xs[idx]!);
  }
  return out;
}

export function bootstrapMeanDiff(a: number[], b: number[], iterations = 1000, alpha = 0.05): BootstrapResult {
  if (a.length === 0 || b.length === 0) throw new Error("bootstrap requires non-empty arrays");

  const observed = mean(a) - mean(b);
  const deltas: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const aS = sampleWithReplacement(a, a.length);
    const bS = sampleWithReplacement(b, b.length);
    deltas.push(mean(aS) - mean(bS));
  }
  deltas.sort((x, y) => x - y);

  const loIdx = Math.floor((alpha / 2) * (iterations - 1));
  const hiIdx = Math.floor((1 - alpha / 2) * (iterations - 1));
  const ciLow = deltas[loIdx]!;
  const ciHigh = deltas[hiIdx]!;

  // Two-sided p-value: how often bootstrap delta has opposite sign (or 0)
  const opposite = deltas.filter((d) => Math.sign(d) !== Math.sign(observed)).length;
  const p = Math.min(1, (2 * opposite) / iterations);

  return { delta_mean: observed, ci_low: ciLow, ci_high: ciHigh, p_value_two_sided: p, iterations };
}

export interface EwmaPoint {
  t: number;
  value: number;
  ewma: number;
}

export function ewma(values: number[], lambda = 0.3): EwmaPoint[] {
  if (values.length === 0) return [];
  const out: EwmaPoint[] = [];
  let prev = values[0]!;
  for (let i = 0; i < values.length; i++) {
    const x = values[i]!;
    const e = i === 0 ? x : lambda * x + (1 - lambda) * prev;
    out.push({ t: i, value: x, ewma: e });
    prev = e;
  }
  return out;
}

export interface CusumResult {
  t: number;
  value: number;
  pos: number;
  neg: number;
  signal: boolean;
}

export function cusumTwoSided(values: number[], targetMean: number, k = 0.5, h = 5): CusumResult[] {
  // Standard two-sided CUSUM on deviations from target.
  let pos = 0;
  let neg = 0;
  const out: CusumResult[] = [];
  for (let i = 0; i < values.length; i++) {
    const x = values[i]!;
    pos = Math.max(0, pos + (x - targetMean - k));
    neg = Math.min(0, neg + (x - targetMean + k));
    const signal = pos > h || Math.abs(neg) > h;
    out.push({ t: i, value: x, pos, neg, signal });
  }
  return out;
}

export interface BhResultItem {
  id: string;
  p_value: number;
  q_value: number;
  significant: boolean;
}

export function benjaminiHochberg(pValues: { id: string; p_value: number }[], alpha = 0.05): BhResultItem[] {
  const m = pValues.length;
  if (m === 0) return [];

  const sorted = [...pValues].sort((a, b) => a.p_value - b.p_value);
  const qVals: number[] = new Array(m).fill(1);

  // Compute monotone q-values from largest to smallest.
  let prevQ = 1;
  for (let i = m - 1; i >= 0; i--) {
    const rank = i + 1;
    const p = sorted[i]!.p_value;
    const q = Math.min(prevQ, (p * m) / rank);
    qVals[i] = q;
    prevQ = q;
  }

  const results: BhResultItem[] = sorted.map((t, i) => ({
    id: t.id,
    p_value: t.p_value,
    q_value: qVals[i]!,
    significant: qVals[i]! <= alpha
  }));

  // Restore input order by id (caller can map).
  return results;
}


