export type HorizonString = "1d" | "1w" | "1m" | "3m" | "6m" | "1y" | string;

export function horizonToMs(horizon: HorizonString): number {
  const h = horizon.trim().toLowerCase();
  const m = h.match(/^(\d+)\s*([dwmy])$/);
  if (!m) throw new Error(`Unsupported horizon format: ${horizon}`);
  const n = Number(m[1]);
  const unit = m[2]!;
  const day = 24 * 60 * 60 * 1000;
  switch (unit) {
    case "d":
      return n * day;
    case "w":
      return n * 7 * day;
    case "m":
      return n * 30 * day;
    case "y":
      return n * 365 * day;
    default:
      throw new Error(`Unsupported horizon unit: ${unit}`);
  }
}



