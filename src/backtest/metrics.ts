export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function stddevSample(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const varSum = xs.reduce((acc, x) => acc + (x - m) * (x - m), 0);
  return Math.sqrt(varSum / (xs.length - 1));
}

export function pearsonCorr(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length) throw new Error("pearsonCorr expects arrays with equal length");
  if (xs.length < 2) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i]! - mx;
    const y = ys[i]! - my;
    num += x * y;
    dx += x * x;
    dy += y * y;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

export function sharpeRatio(returns: number[], annualizationFactor = 252): number {
  const m = mean(returns);
  const s = stddevSample(returns);
  if (s === 0) return 0;
  return (m / s) * Math.sqrt(annualizationFactor);
}

export function tStatOfMean(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const s = stddevSample(xs);
  if (s === 0) return 0;
  return m / (s / Math.sqrt(xs.length));
}


