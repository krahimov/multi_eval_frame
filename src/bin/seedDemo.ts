import { loadEnv } from "../config/loadEnv.js";
import { v4 as uuidv4 } from "uuid";
import { v1 } from "../contracts/index.js";

loadEnv();

type SeedConfig = {
  baseUrl: string;
  tenantId: string;
  workflowId: string;
  datasetVersion: string;
  horizon: string;
  instruments: string[];
  baselineRuns: number;
  currentRuns: number;
  baselineAgentVersion: string;
  currentAgentVersion: string;
  signals: number;
  drift: boolean;
  injectAnomaly: boolean;
};

function envNum(name: string, def: number): number {
  const raw = process.env[name];
  if (!raw) return def;
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
}

function envBool(name: string, def: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return def;
  return raw === "true" || raw === "1" || raw.toLowerCase() === "yes";
}

function iso(d: Date): string {
  return d.toISOString();
}

function randn(): number {
  // Box-Muller
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function clamp01(x: number): number {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function pickConfig(): SeedConfig {
  const baseUrl = process.env.EVAL_BASE_URL ?? "http://127.0.0.1:3001";
  const tenantId = process.env.TENANT_ID ?? "t_123";
  const workflowId = process.env.WORKFLOW_ID ?? "geoRiskExposure";
  const datasetVersion = process.env.DATASET_VERSION ?? "pit_demo_1";
  const horizon = process.env.HORIZON ?? "1d";
  const instruments = (process.env.DEMO_INSTRUMENTS ?? "NVDA,TSM,ASML")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    baseUrl,
    tenantId,
    workflowId,
    datasetVersion,
    horizon,
    instruments,
    baselineRuns: envNum("BASELINE_RUNS", 25),
    currentRuns: envNum("CURRENT_RUNS", 15),
    baselineAgentVersion: process.env.BASELINE_AGENT_VERSION ?? "v1",
    currentAgentVersion: process.env.CURRENT_AGENT_VERSION ?? "v2",
    signals: envNum("SIGNALS", 30),
    drift: envBool("DRIFT", true),
    injectAnomaly: envBool("INJECT_ANOMALY", true)
  };
}

function makeBaseEvent(cfg: SeedConfig, type: v1.EventTypeV1, orchestrationRunId: string, queryId: string, t: Date): v1.BaseEventV1 {
  return {
    schema_version: "v1",
    type,
    event_id: uuidv4(),
    tenant_id: cfg.tenantId,
    orchestration_run_id: orchestrationRunId,
    workflow_id: cfg.workflowId,
    query_id: queryId,
    request_timestamp: iso(t),
    event_time: iso(t)
  };
}

function makeOrchestrationRunStarted(cfg: SeedConfig, orchestrationRunId: string, queryId: string, t: Date): v1.OrchestrationRunStartedEventV1 {
  return {
    ...makeBaseEvent(cfg, "OrchestrationRunStarted", orchestrationRunId, queryId, t),
    type: "OrchestrationRunStarted",
    orchestration: { orchestrator_version: "seed-demo", client_id: "seed", user_id: "seed" }
  };
}

function makeOrchestrationRunCompleted(cfg: SeedConfig, orchestrationRunId: string, queryId: string, t: Date, totalLatencyMs: number): v1.OrchestrationRunCompletedEventV1 {
  return {
    ...makeBaseEvent(cfg, "OrchestrationRunCompleted", orchestrationRunId, queryId, t),
    type: "OrchestrationRunCompleted",
    orchestration: { status: "success", total_latency_ms: totalLatencyMs }
  };
}

function makeAgentRunStarted(cfg: SeedConfig, orchestrationRunId: string, queryId: string, t: Date, agentRunId: string, agentVersion: string): v1.AgentRunStartedEventV1 {
  return {
    ...makeBaseEvent(cfg, "AgentRunStarted", orchestrationRunId, queryId, t),
    type: "AgentRunStarted",
    agent_run_id: agentRunId,
    agent: { agent_id: "MacroAgent", agent_version: agentVersion, model: "gpt-4o", config_hash: "sha256:seed" }
  };
}

function makeAgentRunCompleted(
  cfg: SeedConfig,
  orchestrationRunId: string,
  queryId: string,
  t: Date,
  agentRunId: string,
  agentVersion: string,
  metrics: { latency_ms: number; faithfulness: number; coverage: number; confidence: number; hallucination: boolean }
): v1.AgentRunCompletedEventV1 {
  return {
    ...makeBaseEvent(cfg, "AgentRunCompleted", orchestrationRunId, queryId, t),
    type: "AgentRunCompleted",
    agent_run_id: agentRunId,
    agent: { agent_id: "MacroAgent", agent_version: agentVersion, model: "gpt-4o", config_hash: "sha256:seed" },
    metrics: {
      latency_ms: metrics.latency_ms,
      faithfulness_score: clamp01(metrics.faithfulness),
      coverage_score: clamp01(metrics.coverage),
      confidence_score: clamp01(metrics.confidence),
      hallucination_flag: metrics.hallucination
    },
    output: {
      output_summary: `seed-demo ${agentVersion} ${cfg.workflowId}`,
      citations: [{ doc_id: "doc_seed", chunk_id: "c1", quote_hash: "sha256:seed" }]
    }
  };
}

function makeSignal(
  cfg: SeedConfig,
  orchestrationRunId: string,
  queryId: string,
  t: Date,
  signalId: string,
  perInstrumentScore: Map<string, number>
): v1.SignalEmittedEventV1 {
  return {
    ...makeBaseEvent(cfg, "SignalEmitted", orchestrationRunId, queryId, t),
    type: "SignalEmitted",
    signal_id: signalId,
    agent: { agent_id: "QuantAgent", agent_version: "v1", model: "gpt-4o", config_hash: "sha256:seed" },
    signal: {
      prediction_type: "return_forecast",
      horizon: cfg.horizon,
      instrument_universe: cfg.instruments.map((instrument_id) => ({ instrument_id, weight: 1 })),
      signal_value: {
        kind: "vector",
        values: cfg.instruments.map((instrument_id) => ({ instrument_id, value: perInstrumentScore.get(instrument_id) ?? 0 }))
      },
      confidence: 0.65
    }
  };
}

function makeMarketOutcome(
  cfg: SeedConfig,
  tSignal: Date,
  instrumentId: string,
  realizedReturn: number,
  benchmarkReturn: number
): v1.MarketOutcomeIngestedEventV1 {
  // This event still requires orchestration identifiers in our v1 schema, so we use stable placeholders.
  const baseT = new Date(tSignal.getTime());
  const base = makeBaseEvent(cfg, "MarketOutcomeIngested", "market_dataset", "market_dataset", baseT);
  const asof = new Date(tSignal.getTime() + 24 * 60 * 60 * 1000);
  return {
    ...base,
    type: "MarketOutcomeIngested",
    dataset_version: cfg.datasetVersion,
    instrument_id: instrumentId,
    asof_time: iso(asof),
    market: {
      return: realizedReturn,
      benchmark_return: benchmarkReturn
    }
  };
}

async function postBatch(cfg: SeedConfig, batchIdx: number, events: v1.EventV1[]): Promise<void> {
  const payload: v1.IngestBatchV1 = { schema_version: "v1", events };
  const maxAttempts = Number(process.env.SEED_POST_MAX_ATTEMPTS ?? "30");
  const baseDelayMs = Number(process.env.SEED_POST_BASE_DELAY_MS ?? "200");

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`${cfg.baseUrl}/events`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `seed-demo-${cfg.datasetVersion}-${batchIdx}`
        },
        body: JSON.stringify(payload)
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`seed batch failed: ${res.status} ${text}`);
      // eslint-disable-next-line no-console
      console.log(text);
      return;
    } catch (err: any) {
      const code = err?.cause?.code ?? err?.code;
      const msg = String(err?.message ?? err);
      const isConnRefused = code === "ECONNREFUSED" || msg.includes("ECONNREFUSED") || msg.includes("fetch failed");

      if (!isConnRefused || attempt === maxAttempts) throw err;

      const delay = Math.min(5_000, baseDelayMs * attempt);
      // eslint-disable-next-line no-console
      console.log(`seed: waiting for API (${cfg.baseUrl})... attempt ${attempt}/${maxAttempts} (sleep ${delay}ms)`);
      await sleep(delay);
    }
  }
}

function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

async function main(): Promise<void> {
  const cfg = pickConfig();

  // eslint-disable-next-line no-console
  console.log({
    baseUrl: cfg.baseUrl,
    tenantId: cfg.tenantId,
    workflowId: cfg.workflowId,
    datasetVersion: cfg.datasetVersion,
    horizon: cfg.horizon,
    instruments: cfg.instruments,
    baselineRuns: cfg.baselineRuns,
    currentRuns: cfg.currentRuns,
    baselineAgentVersion: cfg.baselineAgentVersion,
    currentAgentVersion: cfg.currentAgentVersion,
    signals: cfg.signals,
    drift: cfg.drift,
    injectAnomaly: cfg.injectAnomaly
  });

  const now = new Date();
  const baselineTime = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const currentTime = new Date(now.getTime() - 10 * 60 * 1000);

  const events: v1.EventV1[] = [];

  // 1) Seed agent-run evaluation records (baseline + current)
  for (let i = 0; i < cfg.baselineRuns; i++) {
    const orc = `orc_seed_base_${uuidv4()}`;
    const q = `q_seed_base_${i}`;
    const agentRunId = uuidv4();
    const t = new Date(baselineTime.getTime() + i * 10_000);

    const latency = 900 + Math.floor(Math.random() * 600);
    const faithfulness = 0.85 + 0.05 * randn();
    const coverage = 0.78 + 0.05 * randn();
    const confidence = 0.65 + 0.05 * randn();

    events.push(makeOrchestrationRunStarted(cfg, orc, q, t));
    events.push(makeAgentRunStarted(cfg, orc, q, t, agentRunId, cfg.baselineAgentVersion));
    events.push(
      makeAgentRunCompleted(cfg, orc, q, t, agentRunId, cfg.baselineAgentVersion, {
        latency_ms: latency,
        faithfulness,
        coverage,
        confidence,
        hallucination: false
      })
    );
    events.push(makeOrchestrationRunCompleted(cfg, orc, q, t, latency + 300));
  }

  for (let i = 0; i < cfg.currentRuns; i++) {
    const orc = `orc_seed_cur_${uuidv4()}`;
    const q = `q_seed_cur_${i}`;
    const agentRunId = uuidv4();
    const t = new Date(currentTime.getTime() + i * 10_000);

    const latency = 1100 + Math.floor(Math.random() * 900);
    const baseFaith = cfg.drift ? 0.65 : 0.84;
    const faithfulness = baseFaith + 0.06 * randn();
    const coverage = (cfg.drift ? 0.68 : 0.78) + 0.06 * randn();
    const confidence = 0.62 + 0.06 * randn();
    const hallucination = cfg.drift ? Math.random() < 0.12 : Math.random() < 0.02;

    events.push(makeOrchestrationRunStarted(cfg, orc, q, t));
    events.push(makeAgentRunStarted(cfg, orc, q, t, agentRunId, cfg.currentAgentVersion));
    events.push(
      makeAgentRunCompleted(cfg, orc, q, t, agentRunId, cfg.currentAgentVersion, {
        latency_ms: cfg.injectAnomaly && i === 0 ? 25_000 : latency,
        faithfulness,
        coverage,
        confidence,
        hallucination: cfg.injectAnomaly && i === 0 ? true : hallucination
      })
    );
    events.push(makeOrchestrationRunCompleted(cfg, orc, q, t, latency + 300));
  }

  // 2) Seed signals + market outcomes so backtest returns non-zero metrics.
  // We'll create a latent factor per signal time; scores correlate with next-day returns.
  for (let i = 0; i < cfg.signals; i++) {
    const t = new Date(now.getTime() - (cfg.signals - i) * 60 * 60 * 1000); // spread across last ~signals hours
    const orc = `orc_seed_sig_${uuidv4()}`;
    const q = `q_seed_sig_${i}`;
    const signalId = uuidv4();

    const z = randn(); // latent factor
    const benchmark = 0.0002 + 0.003 * randn();

    const perInstrumentScore = new Map<string, number>();
    const perInstrumentReturn = new Map<string, number>();

    for (const instrument of cfg.instruments) {
      const score = z + 0.4 * randn();
      // realized return correlated with z
      const realized = 0.006 * z + 0.01 * randn();
      perInstrumentScore.set(instrument, score);
      perInstrumentReturn.set(instrument, realized);
    }

    events.push(makeOrchestrationRunStarted(cfg, orc, q, t));
    events.push(makeSignal(cfg, orc, q, t, signalId, perInstrumentScore));
    events.push(makeOrchestrationRunCompleted(cfg, orc, q, t, 500));

    // outcomes at t+1d
    for (const instrument of cfg.instruments) {
      events.push(makeMarketOutcome(cfg, t, instrument, perInstrumentReturn.get(instrument) ?? 0, benchmark));
    }
  }

  // Post in batches (avoid huge requests)
  const batches = chunk(events, 200);
  for (let i = 0; i < batches.length; i++) {
    await postBatch(cfg, i, batches[i]!);
  }

  // eslint-disable-next-line no-console
  console.log(`Seeded events: ${events.length} in ${batches.length} batches.`);
  // eslint-disable-next-line no-console
  console.log("Next: run jobs with tighter windows for demo:");
  // eslint-disable-next-line no-console
  console.log("  WINDOW_HOURS=1 npm run job:significance");
  // eslint-disable-next-line no-console
  console.log("  BASELINE_HOURS=4 CURRENT_HOURS=1 npm run job:auto-eval");
  // eslint-disable-next-line no-console
  console.log(`  DATASET_VERSION=${cfg.datasetVersion} HORIZON=${cfg.horizon} npm run backtest:run`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});


