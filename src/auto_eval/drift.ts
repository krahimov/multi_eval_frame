import { quantile } from "../eval/outliers.js";

export interface PsiResult {
  psi: number;
  bins: { low: number; high: number; p_base: number; p_cur: number; psi_bin: number }[];
}

function clamp(min: number, x: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

export function computePsi(base: number[], cur: number[], bins = 10): PsiResult {
  if (base.length === 0 || cur.length === 0) return { psi: 0, bins: [] };
  const b = Math.max(2, Math.floor(bins));

  // Use baseline quantiles to define bins (stable over time)
  const edges: number[] = [];
  for (let i = 0; i <= b; i++) edges.push(quantile(base, i / b));

  // De-duplicate edges (constant distributions)
  const uniqEdges = edges.filter((v, i) => i === 0 || v !== edges[i - 1]);
  if (uniqEdges.length < 3) return { psi: 0, bins: [] };

  const counts = (xs: number[]) => {
    const out = new Array(uniqEdges.length - 1).fill(0);
    for (const x of xs) {
      // last bin inclusive
      let idx = uniqEdges.findIndex((e) => x < e) - 1;
      if (idx < 0) idx = uniqEdges.length - 2;
      idx = clamp(0, idx, uniqEdges.length - 2);
      out[idx] += 1;
    }
    return out;
  };

  const baseCounts = counts(base);
  const curCounts = counts(cur);
  const baseTotal = baseCounts.reduce((a, b) => a + b, 0);
  const curTotal = curCounts.reduce((a, b) => a + b, 0);

  const eps = 1e-6;
  let psi = 0;
  const perBin: PsiResult["bins"] = [];
  for (let i = 0; i < baseCounts.length; i++) {
    const pBase = Math.max(eps, baseCounts[i]! / baseTotal);
    const pCur = Math.max(eps, curCounts[i]! / curTotal);
    const psiBin = (pCur - pBase) * Math.log(pCur / pBase);
    psi += psiBin;
    perBin.push({ low: uniqEdges[i]!, high: uniqEdges[i + 1]!, p_base: pBase, p_cur: pCur, psi_bin: psiBin });
  }

  return { psi, bins: perBin };
}

export function wassersteinDistance1D(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  const n = Math.min(sa.length, sb.length);
  let acc = 0;
  for (let i = 0; i < n; i++) acc += Math.abs(sa[Math.floor((i * sa.length) / n)]! - sb[Math.floor((i * sb.length) / n)]!);
  return acc / n;
}

export type DriftSeverity = "none" | "moderate" | "severe";

export interface DriftDetection {
  psi: PsiResult;
  wasserstein: number;
  severity: DriftSeverity;
}

export function detectDrift(base: number[], cur: number[]): DriftDetection {
  const psi = computePsi(base, cur, 10);
  const w = wassersteinDistance1D(base, cur);

  let severity: DriftSeverity = "none";
  if (psi.psi >= 0.2) severity = "moderate";
  if (psi.psi >= 0.35) severity = "severe";

  return { psi, wasserstein: w, severity };
}


