import type pg from "pg";
import { v4 as uuidv4 } from "uuid";
import { v1 } from "../contracts/index.js";
import { aggregateAgentQuality, WEIGHTING_VERSION } from "../eval/aggregate.js";
import { normalizeAgentMetrics, NORMALIZATION_VERSION } from "../eval/normalize.js";

type DbClient = Pick<pg.Pool, "query">;

export interface RealtimeWorkerOptions {
  batchSize: number;
  maxAttempts: number;
}

export const DEFAULT_REALTIME_WORKER_OPTIONS: RealtimeWorkerOptions = {
  batchSize: 100,
  maxAttempts: 5
};

type RawEventRow = {
  tenant_id: string;
  event_id: string;
  event_type: string;
  payload: unknown;
  attempt_count: number;
};

async function ensureOrchestrationRunExists(db: DbClient, e: v1.BaseEventV1): Promise<void> {
  // Create a minimal placeholder to satisfy FKs even if events arrive out of order.
  // We treat request_timestamp as the best "started_at" proxy if OrchestrationRunStarted hasn't been ingested yet.
  await db.query(
    `
    INSERT INTO orchestration_runs (
      tenant_id, orchestration_run_id,
      workflow_id, query_id, request_timestamp,
      status, started_at,
      created_at, updated_at
    )
    VALUES (
      $1, $2,
      $3, $4, $5::timestamptz,
      'running', $5::timestamptz,
      now(), now()
    )
    ON CONFLICT (tenant_id, orchestration_run_id) DO UPDATE SET
      workflow_id = EXCLUDED.workflow_id,
      query_id = EXCLUDED.query_id,
      request_timestamp = EXCLUDED.request_timestamp,
      started_at = LEAST(orchestration_runs.started_at, EXCLUDED.started_at),
      updated_at = now()
  `,
    [e.tenant_id, e.orchestration_run_id, e.workflow_id, e.query_id, e.request_timestamp]
  );
}

async function fetchAndLockUnprocessedEvents(
  db: DbClient,
  opts: RealtimeWorkerOptions
): Promise<RawEventRow[]> {
  const res = await db.query<RawEventRow>(
    `
    SELECT tenant_id, event_id::text, event_type, payload, attempt_count
    FROM raw_events
    WHERE processed_at IS NULL
      AND attempt_count < $1
    ORDER BY ingest_time ASC, event_time ASC, event_id ASC
    LIMIT $2
    FOR UPDATE SKIP LOCKED
  `,
    [opts.maxAttempts, opts.batchSize]
  );
  return res.rows;
}

async function markEventProcessed(
  db: DbClient,
  tenantId: string,
  eventId: string
): Promise<void> {
  await db.query(
    `
    UPDATE raw_events
    SET processed_at = now(),
        processing_error = NULL
    WHERE tenant_id = $1 AND event_id = $2::uuid
  `,
    [tenantId, eventId]
  );
}

async function markEventFailed(
  db: DbClient,
  tenantId: string,
  eventId: string,
  errorMessage: string,
  opts: RealtimeWorkerOptions
): Promise<void> {
  // increment attempt_count; dead-letter by setting processed_at when max attempts reached
  await db.query(
    `
    UPDATE raw_events
    SET attempt_count = attempt_count + 1,
        processing_error = $3,
        processed_at = CASE WHEN attempt_count + 1 >= $4 THEN now() ELSE processed_at END
    WHERE tenant_id = $1 AND event_id = $2::uuid
  `,
    [tenantId, eventId, errorMessage.slice(0, 10_000), opts.maxAttempts]
  );
}

async function upsertOrchestrationRunStarted(db: DbClient, e: v1.OrchestrationRunStartedEventV1): Promise<void> {
  await db.query(
    `
    INSERT INTO orchestration_runs (
      tenant_id, orchestration_run_id,
      workflow_id, query_id, request_timestamp,
      status, started_at,
      orchestrator_version, client_id, user_id,
      created_at, updated_at
    )
    VALUES (
      $1, $2,
      $3, $4, $5::timestamptz,
      'running', $6::timestamptz,
      $7, $8, $9,
      now(), now()
    )
    ON CONFLICT (tenant_id, orchestration_run_id) DO UPDATE SET
      workflow_id = EXCLUDED.workflow_id,
      query_id = EXCLUDED.query_id,
      request_timestamp = EXCLUDED.request_timestamp,
      started_at = LEAST(orchestration_runs.started_at, EXCLUDED.started_at),
      orchestrator_version = COALESCE(EXCLUDED.orchestrator_version, orchestration_runs.orchestrator_version),
      client_id = COALESCE(EXCLUDED.client_id, orchestration_runs.client_id),
      user_id = COALESCE(EXCLUDED.user_id, orchestration_runs.user_id),
      updated_at = now()
  `,
    [
      e.tenant_id,
      e.orchestration_run_id,
      e.workflow_id,
      e.query_id,
      e.request_timestamp,
      e.event_time,
      e.orchestration.orchestrator_version ?? null,
      e.orchestration.client_id ?? null,
      e.orchestration.user_id ?? null
    ]
  );
}

async function upsertOrchestrationRunCompleted(
  db: DbClient,
  e: v1.OrchestrationRunCompletedEventV1
): Promise<void> {
  await ensureOrchestrationRunExists(db, e);
  await db.query(
    `
    UPDATE orchestration_runs
    SET status = $3,
        completed_at = COALESCE(completed_at, $4::timestamptz),
        total_latency_ms = COALESCE($5, total_latency_ms),
        error_code = COALESCE($6, error_code),
        error_message = COALESCE($7, error_message),
        updated_at = now()
    WHERE tenant_id = $1 AND orchestration_run_id = $2
  `,
    [
      e.tenant_id,
      e.orchestration_run_id,
      e.orchestration.status,
      e.event_time,
      e.orchestration.total_latency_ms ?? null,
      e.orchestration.error_code ?? null,
      e.orchestration.error_message ?? null
    ]
  );
}

async function upsertAgentRunStarted(db: DbClient, e: v1.AgentRunStartedEventV1): Promise<void> {
  await ensureOrchestrationRunExists(db, e);
  await db.query(
    `
    INSERT INTO agent_runs (
      tenant_id, agent_run_id, orchestration_run_id,
      workflow_id, query_id,
      agent_id, agent_version, model, config_hash,
      parent_agent_run_id,
      started_at,
      created_at, updated_at
    )
    VALUES (
      $1, $2::uuid, $3,
      $4, $5,
      $6, $7, $8, $9,
      $10::uuid,
      $11::timestamptz,
      now(), now()
    )
    ON CONFLICT (tenant_id, agent_run_id) DO UPDATE SET
      orchestration_run_id = EXCLUDED.orchestration_run_id,
      workflow_id = EXCLUDED.workflow_id,
      query_id = EXCLUDED.query_id,
      agent_id = EXCLUDED.agent_id,
      agent_version = EXCLUDED.agent_version,
      model = COALESCE(EXCLUDED.model, agent_runs.model),
      config_hash = COALESCE(EXCLUDED.config_hash, agent_runs.config_hash),
      parent_agent_run_id = COALESCE(EXCLUDED.parent_agent_run_id, agent_runs.parent_agent_run_id),
      started_at = COALESCE(agent_runs.started_at, EXCLUDED.started_at),
      updated_at = now()
  `,
    [
      e.tenant_id,
      e.agent_run_id,
      e.orchestration_run_id,
      e.workflow_id,
      e.query_id,
      e.agent.agent_id,
      e.agent.agent_version,
      e.agent.model ?? null,
      e.agent.config_hash ?? null,
      e.parent_agent_run_id ?? null,
      e.event_time
    ]
  );
}

async function upsertAgentRunCompletedAndEval(db: DbClient, e: v1.AgentRunCompletedEventV1): Promise<void> {
  await ensureOrchestrationRunExists(db, e);
  // Upsert agent run summary
  await db.query(
    `
    INSERT INTO agent_runs (
      tenant_id, agent_run_id, orchestration_run_id,
      workflow_id, query_id,
      agent_id, agent_version, model, config_hash,
      completed_at, latency_ms,
      output_summary, output_uri,
      created_at, updated_at
    )
    VALUES (
      $1, $2::uuid, $3,
      $4, $5,
      $6, $7, $8, $9,
      $10::timestamptz, $11,
      $12, $13,
      now(), now()
    )
    ON CONFLICT (tenant_id, agent_run_id) DO UPDATE SET
      orchestration_run_id = EXCLUDED.orchestration_run_id,
      workflow_id = EXCLUDED.workflow_id,
      query_id = EXCLUDED.query_id,
      agent_id = EXCLUDED.agent_id,
      agent_version = EXCLUDED.agent_version,
      model = COALESCE(EXCLUDED.model, agent_runs.model),
      config_hash = COALESCE(EXCLUDED.config_hash, agent_runs.config_hash),
      completed_at = COALESCE(agent_runs.completed_at, EXCLUDED.completed_at),
      latency_ms = COALESCE(EXCLUDED.latency_ms, agent_runs.latency_ms),
      output_summary = COALESCE(EXCLUDED.output_summary, agent_runs.output_summary),
      output_uri = COALESCE(EXCLUDED.output_uri, agent_runs.output_uri),
      updated_at = now()
  `,
    [
      e.tenant_id,
      e.agent_run_id,
      e.orchestration_run_id,
      e.workflow_id,
      e.query_id,
      e.agent.agent_id,
      e.agent.agent_version,
      e.agent.model ?? null,
      e.agent.config_hash ?? null,
      e.event_time,
      Math.round(e.metrics.latency_ms),
      e.output.output_summary,
      e.output.output_uri ?? null
    ]
  );

  const normalized = normalizeAgentMetrics(e.workflow_id, e.metrics);
  const agg = aggregateAgentQuality(e.workflow_id, normalized);

  await db.query(
    `
    INSERT INTO evaluation_records (
      tenant_id, evaluation_id,
      agent_run_id, orchestration_run_id, workflow_id,
      agent_id, agent_version,
      evaluator_version, normalization_version, weighting_version,
      latency_ms, faithfulness_score, hallucination_flag, coverage_score, confidence_score,
      latency_norm, faithfulness_norm, hallucination_norm, coverage_norm, confidence_norm,
      run_quality_score, risk_score,
      scoring_timestamp
    )
    VALUES (
      $1, $2::uuid,
      $3::uuid, $4, $5,
      $6, $7,
      $8, $9, $10,
      $11, $12, $13, $14, $15,
      $16, $17, $18, $19, $20,
      $21, $22,
      now()
    )
    ON CONFLICT (tenant_id, agent_run_id) DO NOTHING
  `,
    [
      e.tenant_id,
      uuidv4(),
      e.agent_run_id,
      e.orchestration_run_id,
      e.workflow_id,
      e.agent.agent_id,
      e.agent.agent_version,
      "v1",
      NORMALIZATION_VERSION,
      WEIGHTING_VERSION,
      Math.round(e.metrics.latency_ms),
      e.metrics.faithfulness_score ?? null,
      e.metrics.hallucination_flag ?? null,
      e.metrics.coverage_score ?? null,
      e.metrics.confidence_score ?? null,
      normalized.latency_norm,
      normalized.faithfulness_norm,
      normalized.hallucination_norm,
      normalized.coverage_norm,
      normalized.confidence_norm,
      agg.run_quality_score,
      agg.risk_score
    ]
  );
}

async function upsertSignal(db: DbClient, e: v1.SignalEmittedEventV1): Promise<void> {
  await db.query(
    `
    INSERT INTO signals (
      tenant_id, signal_id,
      orchestration_run_id, workflow_id, query_id, event_time,
      agent_id, agent_version,
      prediction_type, horizon,
      instrument_universe, signal_value,
      confidence, constraints,
      created_at, updated_at
    )
    VALUES (
      $1, $2::uuid,
      $3, $4, $5, $6::timestamptz,
      $7, $8,
      $9, $10,
      $11::jsonb, $12::jsonb,
      $13, $14::jsonb,
      now(), now()
    )
    ON CONFLICT (tenant_id, signal_id) DO UPDATE SET
      orchestration_run_id = EXCLUDED.orchestration_run_id,
      workflow_id = EXCLUDED.workflow_id,
      query_id = EXCLUDED.query_id,
      event_time = EXCLUDED.event_time,
      agent_id = COALESCE(EXCLUDED.agent_id, signals.agent_id),
      agent_version = COALESCE(EXCLUDED.agent_version, signals.agent_version),
      prediction_type = EXCLUDED.prediction_type,
      horizon = EXCLUDED.horizon,
      instrument_universe = EXCLUDED.instrument_universe,
      signal_value = EXCLUDED.signal_value,
      confidence = COALESCE(EXCLUDED.confidence, signals.confidence),
      constraints = COALESCE(EXCLUDED.constraints, signals.constraints),
      updated_at = now()
  `,
    [
      e.tenant_id,
      e.signal_id,
      e.orchestration_run_id,
      e.workflow_id,
      e.query_id,
      e.event_time,
      e.agent?.agent_id ?? null,
      e.agent?.agent_version ?? null,
      e.signal.prediction_type,
      e.signal.horizon,
      e.signal.instrument_universe as unknown as object,
      e.signal.signal_value as unknown as object,
      e.signal.confidence ?? null,
      (e.signal.constraints ?? null) as unknown as object
    ]
  );
}

async function upsertMarketOutcome(db: DbClient, e: v1.MarketOutcomeIngestedEventV1): Promise<void> {
  await db.query(
    `
    INSERT INTO market_outcomes (
      tenant_id, dataset_version, instrument_id, asof_time,
      price, return, benchmark_return, volatility, meta, ingested_at
    )
    VALUES (
      $1, $2, $3, $4::timestamptz,
      $5, $6, $7, $8, $9::jsonb, now()
    )
    ON CONFLICT (tenant_id, dataset_version, instrument_id, asof_time)
    DO NOTHING
  `,
    [
      e.tenant_id,
      e.dataset_version,
      e.instrument_id,
      e.asof_time,
      e.market.price ?? null,
      e.market.return ?? null,
      e.market.benchmark_return ?? null,
      e.market.volatility ?? null,
      (e.market.meta ?? null) as unknown as object
    ]
  );
}

async function processEvent(db: DbClient, event: v1.EventV1): Promise<void> {
  switch (event.type) {
    case "OrchestrationRunStarted":
      return upsertOrchestrationRunStarted(db, event);
    case "OrchestrationRunCompleted":
      return upsertOrchestrationRunCompleted(db, event);
    case "AgentRunStarted":
      return upsertAgentRunStarted(db, event);
    case "AgentRunCompleted":
      return upsertAgentRunCompletedAndEval(db, event);
    case "SignalEmitted":
      return upsertSignal(db, event);
    case "MarketOutcomeIngested":
      return upsertMarketOutcome(db, event);
    case "RetrievalContextAttached":
      // Stored via object storage pointer (future); ignore for now.
      return;
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

export async function runRealtimeWorkerOnce(
  pool: pg.Pool,
  opts: RealtimeWorkerOptions = DEFAULT_REALTIME_WORKER_OPTIONS
): Promise<{ processed: number; failed: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rows = await fetchAndLockUnprocessedEvents(client, opts);
    let processed = 0;
    let failed = 0;

    for (const row of rows) {
      // Prevent a single event failure from aborting the entire transaction.
      await client.query("SAVEPOINT sp_event");
      try {
        const validated = v1.validateEventV1(row.payload);
        if (!validated.ok) {
          failed++;
          await client.query("ROLLBACK TO SAVEPOINT sp_event");
          await markEventFailed(client, row.tenant_id, row.event_id, "invalid_event_payload", opts);
          await client.query("RELEASE SAVEPOINT sp_event");
          continue;
        }

        await processEvent(client, validated.value);
        await markEventProcessed(client, row.tenant_id, row.event_id);
        await client.query("RELEASE SAVEPOINT sp_event");
        processed++;
      } catch (err) {
        failed++;
        await client.query("ROLLBACK TO SAVEPOINT sp_event");
        await markEventFailed(client, row.tenant_id, row.event_id, (err as Error).message, opts);
        await client.query("RELEASE SAVEPOINT sp_event");
      }
    }

    await client.query("COMMIT");
    return { processed, failed };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function runRealtimeWorkerLoop(
  pool: pg.Pool,
  opts: RealtimeWorkerOptions = DEFAULT_REALTIME_WORKER_OPTIONS
): Promise<void> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await runRealtimeWorkerOnce(pool, opts);
    // eslint-disable-next-line no-console
    if (res.processed === 0 && res.failed === 0) await new Promise((r) => setTimeout(r, 500));
  }
}


