import type pg from "pg";
import { v4 as uuidv4 } from "uuid";
import { horizonToMs, type HorizonString } from "./horizon.js";
import { mean, pearsonCorr, sharpeRatio, stddevSample, tStatOfMean } from "./metrics.js";

type DbSignalRow = {
  signal_id: string;
  event_time: string;
  horizon: string;
  instrument_universe: unknown;
  signal_value: unknown;
  confidence: number | null;
};

type SignalUniverseItem = { instrument_id: string; weight?: number };
type SignalValue =
  | { kind: "scalar"; value: number }
  | { kind: "vector"; values: { instrument_id: string; value: number }[] }
  | { kind: "text"; value: string };

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function parseUniverse(x: unknown): SignalUniverseItem[] {
  if (!Array.isArray(x)) return [];
  const out: SignalUniverseItem[] = [];
  for (const item of x) {
    if (!isObject(item)) continue;
    const instrument_id = item["instrument_id"];
    if (typeof instrument_id !== "string" || instrument_id.length === 0) continue;
    const weight = item["weight"];
    if (typeof weight === "number") out.push({ instrument_id, weight });
    else out.push({ instrument_id });
  }
  return out;
}

function parseSignalValue(x: unknown): SignalValue | null {
  if (!isObject(x)) return null;
  const kind = x["kind"];
  if (kind === "scalar" && typeof x["value"] === "number") return { kind, value: x["value"] };
  if (kind === "text" && typeof x["value"] === "string") return { kind, value: x["value"] };
  if (kind === "vector" && Array.isArray(x["values"])) {
    const values: { instrument_id: string; value: number }[] = [];
    for (const it of x["values"]) {
      if (!isObject(it)) continue;
      if (typeof it["instrument_id"] !== "string") continue;
      if (typeof it["value"] !== "number") continue;
      values.push({ instrument_id: it["instrument_id"], value: it["value"] });
    }
    return { kind, values };
  }
  return null;
}

function buildInstrumentScores(universe: SignalUniverseItem[], val: SignalValue): Map<string, number> {
  const weights = new Map<string, number>();
  for (const u of universe) weights.set(u.instrument_id, u.weight ?? 1);

  const out = new Map<string, number>();
  if (val.kind === "scalar") {
    for (const [instrumentId, w] of weights) out.set(instrumentId, val.value * w);
    return out;
  }
  if (val.kind === "vector") {
    const vec = new Map(val.values.map((v) => [v.instrument_id, v.value]));
    for (const [instrumentId, w] of weights) {
      const v = vec.get(instrumentId);
      if (typeof v === "number") out.set(instrumentId, v * w);
    }
    return out;
  }
  // text -> no numeric signal
  return out;
}

function normalizeWeights(scores: Map<string, number>): Map<string, number> {
  const absSum = Array.from(scores.values()).reduce((a, b) => a + Math.abs(b), 0);
  if (absSum === 0) return new Map();
  const out = new Map<string, number>();
  for (const [k, v] of scores) out.set(k, v / absSum);
  return out;
}

export interface BacktestParams {
  tenantId: string;
  datasetVersion: string;
  horizon: HorizonString;
  startTime: string; // ISO
  endTime: string; // ISO
  costBps: number;
  codeVersion: string;
}

export interface BacktestSummary {
  dataset_version: string;
  horizon: string;
  n_signals: number;
  n_instrument_obs: number;
  mean_return: number;
  std_return: number;
  sharpe: number;
  mean_excess_return: number;
  sharpe_excess: number;
  mean_ic: number;
  ic_t_stat: number;
  hit_rate: number;
  cost_bps: number;
}

export async function runBacktest(pool: pg.Pool, params: BacktestParams): Promise<{ backtest_id: string; summary: BacktestSummary }> {
  const horizonMs = horizonToMs(params.horizon);

  const signals = await pool.query<DbSignalRow>(
    `
    SELECT signal_id::text, event_time::text, horizon, instrument_universe, signal_value, confidence
    FROM signals
    WHERE tenant_id = $1
      AND event_time >= $2::timestamptz
      AND event_time < $3::timestamptz
      AND horizon = $4
    ORDER BY event_time ASC
  `,
    [params.tenantId, params.startTime, params.endTime, params.horizon]
  );

  const perSignalReturns: number[] = [];
  const perSignalExcess: number[] = [];
  const perSignalIc: number[] = [];
  let instrumentObs = 0;

  for (const s of signals.rows) {
    const universe = parseUniverse(s.instrument_universe);
    const sv = parseSignalValue(s.signal_value);
    if (!sv) continue;
    const scores = buildInstrumentScores(universe, sv);
    if (scores.size < 2) continue;

    const weights = normalizeWeights(scores);
    if (weights.size === 0) continue;

    const t0 = new Date(s.event_time).getTime();
    const targetTime = new Date(t0 + horizonMs).toISOString();
    const instrumentIds = Array.from(weights.keys());

    const outcomesRes = await pool.query<{
      instrument_id: string;
      return: number | null;
      benchmark_return: number | null;
    }>(
      `
      SELECT instrument_id, return, benchmark_return
      FROM market_outcomes
      WHERE tenant_id = $1
        AND dataset_version = $2
        AND asof_time = $3::timestamptz
        AND instrument_id = ANY($4::text[])
    `,
      [params.tenantId, params.datasetVersion, targetTime, instrumentIds]
    );

    const returnsById = new Map<string, { r: number; br: number }>();
    for (const r of outcomesRes.rows) {
      if (r.return == null) continue;
      returnsById.set(r.instrument_id, { r: r.return, br: r.benchmark_return ?? 0 });
    }

    const xScores: number[] = [];
    const yReturns: number[] = [];
    let portfolioReturn = 0;
    const benchReturns: number[] = [];

    for (const [instrumentId, w] of weights) {
      const out = returnsById.get(instrumentId);
      if (!out) continue;
      const rawScore = scores.get(instrumentId);
      if (rawScore == null) continue;
      xScores.push(rawScore);
      yReturns.push(out.r);
      portfolioReturn += w * out.r;
      benchReturns.push(out.br);
    }

    if (yReturns.length < 2) continue;
    instrumentObs += yReturns.length;

    const ic = pearsonCorr(xScores, yReturns);
    perSignalIc.push(ic);

    const benchmarkReturn = benchReturns.length ? mean(benchReturns) : 0;
    const cost = params.costBps / 10_000;
    const netReturn = portfolioReturn - cost;
    const excess = netReturn - benchmarkReturn;

    perSignalReturns.push(netReturn);
    perSignalExcess.push(excess);

    await pool.query(
      `
      INSERT INTO signal_outcomes (
        tenant_id, signal_id, horizon,
        computed_at,
        realized_return, benchmark_return, excess_return,
        realized_volatility,
        details
      )
      VALUES (
        $1, $2::uuid, $3,
        now(),
        $4, $5, $6,
        NULL,
        $7::jsonb
      )
      ON CONFLICT (tenant_id, signal_id, horizon) DO NOTHING
    `,
      [
        params.tenantId,
        s.signal_id,
        params.horizon,
        netReturn,
        benchmarkReturn,
        excess,
        { n_instruments: yReturns.length, ic }
      ]
    );
  }

  const hitRate = perSignalReturns.length
    ? perSignalReturns.filter((r) => r > 0).length / perSignalReturns.length
    : 0;

  const annualization = params.horizon === "1d" ? 252 : 252; // keep simple; adjust if needed
  const summary: BacktestSummary = {
    dataset_version: params.datasetVersion,
    horizon: params.horizon,
    n_signals: perSignalReturns.length,
    n_instrument_obs: instrumentObs,
    mean_return: mean(perSignalReturns),
    std_return: stddevSample(perSignalReturns),
    sharpe: sharpeRatio(perSignalReturns, annualization),
    mean_excess_return: mean(perSignalExcess),
    sharpe_excess: sharpeRatio(perSignalExcess, annualization),
    mean_ic: mean(perSignalIc),
    ic_t_stat: tStatOfMean(perSignalIc),
    hit_rate: hitRate,
    cost_bps: params.costBps
  };

  const backtestId = uuidv4();
  await pool.query(
    `
    INSERT INTO backtest_runs (
      tenant_id, backtest_id,
      dataset_version, code_version, start_time, end_time, horizon,
      params, summary, status
    )
    VALUES (
      $1, $2::uuid,
      $3, $4, $5::timestamptz, $6::timestamptz, $7,
      $8::jsonb, $9::jsonb, 'completed'
    )
  `,
    [
      params.tenantId,
      backtestId,
      params.datasetVersion,
      params.codeVersion,
      params.startTime,
      params.endTime,
      params.horizon,
      { cost_bps: params.costBps },
      summary
    ]
  );

  return { backtest_id: backtestId, summary };
}


