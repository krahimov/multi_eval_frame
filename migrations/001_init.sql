-- Module 3 Eval Service - initial schema
-- Notes:
-- - Multi-tenant first-class: almost every table keyed by (tenant_id, ...).
-- - Raw event payloads stored as JSONB with idempotency + processing state.
-- - Evaluation records and rollups are separate to support both detailed audit and fast dashboards.

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  migration_name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS raw_events (
  tenant_id TEXT NOT NULL,
  event_id UUID NOT NULL,
  schema_version TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_time TIMESTAMPTZ NOT NULL,
  ingest_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  idempotency_key TEXT NULL,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ NULL,
  processing_error TEXT NULL,
  attempt_count INT NOT NULL DEFAULT 0,

  PRIMARY KEY (tenant_id, event_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS raw_events_tenant_idempotency_key_uq
  ON raw_events (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS raw_events_unprocessed_idx
  ON raw_events (tenant_id, ingest_time)
  WHERE processed_at IS NULL;

CREATE TABLE IF NOT EXISTS orchestration_runs (
  tenant_id TEXT NOT NULL,
  orchestration_run_id TEXT NOT NULL,

  workflow_id TEXT NOT NULL,
  query_id TEXT NOT NULL,
  request_timestamp TIMESTAMPTZ NOT NULL,

  status TEXT NOT NULL DEFAULT 'running',
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NULL,
  total_latency_ms INT NULL,
  error_code TEXT NULL,
  error_message TEXT NULL,

  orchestrator_version TEXT NULL,
  client_id TEXT NULL,
  user_id TEXT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, orchestration_run_id)
);

CREATE INDEX IF NOT EXISTS orchestration_runs_workflow_time_idx
  ON orchestration_runs (tenant_id, workflow_id, request_timestamp DESC);

CREATE TABLE IF NOT EXISTS agent_runs (
  tenant_id TEXT NOT NULL,
  agent_run_id UUID NOT NULL,
  orchestration_run_id TEXT NOT NULL,

  workflow_id TEXT NOT NULL,
  query_id TEXT NOT NULL,

  agent_id TEXT NOT NULL,
  agent_version TEXT NOT NULL,
  model TEXT NULL,
  config_hash TEXT NULL,

  parent_agent_run_id UUID NULL,

  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  latency_ms INT NULL,

  output_summary TEXT NULL,
  output_uri TEXT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, agent_run_id),

  CONSTRAINT agent_runs_orc_fk
    FOREIGN KEY (tenant_id, orchestration_run_id)
    REFERENCES orchestration_runs (tenant_id, orchestration_run_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS agent_runs_agent_time_idx
  ON agent_runs (tenant_id, agent_id, agent_version, COALESCE(completed_at, started_at) DESC);

CREATE TABLE IF NOT EXISTS evaluation_records (
  tenant_id TEXT NOT NULL,
  evaluation_id UUID NOT NULL,

  agent_run_id UUID NOT NULL,
  orchestration_run_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,

  agent_id TEXT NOT NULL,
  agent_version TEXT NOT NULL,

  scoring_timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  evaluator_version TEXT NOT NULL,
  normalization_version TEXT NOT NULL,
  weighting_version TEXT NOT NULL,

  latency_ms INT NOT NULL,
  faithfulness_score DOUBLE PRECISION NULL,
  hallucination_flag BOOLEAN NULL,
  coverage_score DOUBLE PRECISION NULL,
  confidence_score DOUBLE PRECISION NULL,

  latency_norm DOUBLE PRECISION NULL,
  faithfulness_norm DOUBLE PRECISION NULL,
  coverage_norm DOUBLE PRECISION NULL,
  confidence_norm DOUBLE PRECISION NULL,
  hallucination_norm DOUBLE PRECISION NULL,

  run_quality_score DOUBLE PRECISION NULL,
  risk_score DOUBLE PRECISION NULL,

  anomaly_flag BOOLEAN NOT NULL DEFAULT false,
  meta JSONB NULL,

  PRIMARY KEY (tenant_id, evaluation_id),

  CONSTRAINT evaluation_agent_run_fk
    FOREIGN KEY (tenant_id, agent_run_id)
    REFERENCES agent_runs (tenant_id, agent_run_id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS evaluation_records_agent_run_uq
  ON evaluation_records (tenant_id, agent_run_id);

CREATE INDEX IF NOT EXISTS evaluation_records_time_idx
  ON evaluation_records (tenant_id, scoring_timestamp DESC);

CREATE INDEX IF NOT EXISTS evaluation_records_agent_metric_idx
  ON evaluation_records (tenant_id, workflow_id, agent_id, agent_version, scoring_timestamp DESC);

CREATE TABLE IF NOT EXISTS metric_rollups_hourly (
  tenant_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  agent_version TEXT NOT NULL,
  hour_bucket TIMESTAMPTZ NOT NULL,

  n INT NOT NULL,

  mean_latency_ms DOUBLE PRECISION NULL,
  mean_faithfulness DOUBLE PRECISION NULL,
  mean_coverage DOUBLE PRECISION NULL,
  mean_confidence DOUBLE PRECISION NULL,
  mean_quality DOUBLE PRECISION NULL,

  std_latency_ms DOUBLE PRECISION NULL,
  std_faithfulness DOUBLE PRECISION NULL,
  std_coverage DOUBLE PRECISION NULL,
  std_confidence DOUBLE PRECISION NULL,
  std_quality DOUBLE PRECISION NULL,

  p50_faithfulness DOUBLE PRECISION NULL,
  p95_faithfulness DOUBLE PRECISION NULL,
  p10_faithfulness DOUBLE PRECISION NULL,
  p05_faithfulness DOUBLE PRECISION NULL,

  p50_quality DOUBLE PRECISION NULL,
  p95_quality DOUBLE PRECISION NULL,
  p10_quality DOUBLE PRECISION NULL,
  p05_quality DOUBLE PRECISION NULL,

  anomaly_count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, workflow_id, agent_id, agent_version, hour_bucket)
);

CREATE INDEX IF NOT EXISTS metric_rollups_hourly_time_idx
  ON metric_rollups_hourly (tenant_id, hour_bucket DESC);

CREATE TABLE IF NOT EXISTS anomalies (
  tenant_id TEXT NOT NULL,
  anomaly_id UUID NOT NULL,
  evaluation_id UUID NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metric_name TEXT NOT NULL,
  method TEXT NOT NULL,

  value DOUBLE PRECISION NOT NULL,
  threshold_low DOUBLE PRECISION NULL,
  threshold_high DOUBLE PRECISION NULL,
  z_score DOUBLE PRECISION NULL,
  details JSONB NULL,

  PRIMARY KEY (tenant_id, anomaly_id),

  CONSTRAINT anomalies_eval_fk
    FOREIGN KEY (tenant_id, evaluation_id)
    REFERENCES evaluation_records (tenant_id, evaluation_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS anomalies_recent_idx
  ON anomalies (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS performance_shifts (
  tenant_id TEXT NOT NULL,
  shift_id UUID NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  workflow_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  agent_version TEXT NOT NULL,
  metric_name TEXT NOT NULL,

  window_a_start TIMESTAMPTZ NOT NULL,
  window_a_end TIMESTAMPTZ NOT NULL,
  window_b_start TIMESTAMPTZ NOT NULL,
  window_b_end TIMESTAMPTZ NOT NULL,

  method TEXT NOT NULL,
  p_value DOUBLE PRECISION NULL,
  bh_adjusted_p_value DOUBLE PRECISION NULL,
  effect_size DOUBLE PRECISION NULL,
  significant BOOLEAN NOT NULL DEFAULT false,
  details JSONB NULL,

  PRIMARY KEY (tenant_id, shift_id)
);

CREATE INDEX IF NOT EXISTS performance_shifts_recent_idx
  ON performance_shifts (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS signals (
  tenant_id TEXT NOT NULL,
  signal_id UUID NOT NULL,

  orchestration_run_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  query_id TEXT NOT NULL,
  event_time TIMESTAMPTZ NOT NULL,

  agent_id TEXT NULL,
  agent_version TEXT NULL,

  prediction_type TEXT NOT NULL,
  horizon TEXT NOT NULL,

  instrument_universe JSONB NOT NULL,
  signal_value JSONB NOT NULL,

  confidence DOUBLE PRECISION NULL,
  constraints JSONB NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, signal_id)
);

CREATE INDEX IF NOT EXISTS signals_time_idx
  ON signals (tenant_id, event_time DESC);

CREATE TABLE IF NOT EXISTS market_outcomes (
  tenant_id TEXT NOT NULL,
  dataset_version TEXT NOT NULL,
  instrument_id TEXT NOT NULL,
  asof_time TIMESTAMPTZ NOT NULL,

  price DOUBLE PRECISION NULL,
  return DOUBLE PRECISION NULL,
  benchmark_return DOUBLE PRECISION NULL,
  volatility DOUBLE PRECISION NULL,
  meta JSONB NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (tenant_id, dataset_version, instrument_id, asof_time)
);

CREATE INDEX IF NOT EXISTS market_outcomes_time_idx
  ON market_outcomes (tenant_id, dataset_version, asof_time DESC);

CREATE TABLE IF NOT EXISTS signal_outcomes (
  tenant_id TEXT NOT NULL,
  signal_id UUID NOT NULL,
  horizon TEXT NOT NULL,

  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  realized_return DOUBLE PRECISION NULL,
  benchmark_return DOUBLE PRECISION NULL,
  excess_return DOUBLE PRECISION NULL,
  realized_volatility DOUBLE PRECISION NULL,
  drawdown_contribution DOUBLE PRECISION NULL,
  details JSONB NULL,

  PRIMARY KEY (tenant_id, signal_id, horizon),

  CONSTRAINT signal_outcomes_signal_fk
    FOREIGN KEY (tenant_id, signal_id)
    REFERENCES signals (tenant_id, signal_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS backtest_runs (
  tenant_id TEXT NOT NULL,
  backtest_id UUID NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  dataset_version TEXT NOT NULL,
  code_version TEXT NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  horizon TEXT NOT NULL,

  universe_filter JSONB NULL,
  params JSONB NULL,

  summary JSONB NOT NULL,
  artifact_uri TEXT NULL,

  status TEXT NOT NULL DEFAULT 'completed',
  error_message TEXT NULL,

  PRIMARY KEY (tenant_id, backtest_id)
);

CREATE INDEX IF NOT EXISTS backtest_runs_recent_idx
  ON backtest_runs (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS recommended_actions (
  tenant_id TEXT NOT NULL,
  action_id UUID NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  action_type TEXT NOT NULL,
  target JSONB NOT NULL,
  payload JSONB NULL,

  decided_by TEXT NOT NULL DEFAULT 'auto',
  status TEXT NOT NULL DEFAULT 'open',

  PRIMARY KEY (tenant_id, action_id)
);

CREATE INDEX IF NOT EXISTS recommended_actions_recent_idx
  ON recommended_actions (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  tenant_id TEXT NOT NULL,
  audit_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  actor_type TEXT NOT NULL,
  actor_id TEXT NULL,

  action TEXT NOT NULL,
  resource_type TEXT NULL,
  resource_id TEXT NULL,

  request_id TEXT NULL,
  metadata JSONB NULL,

  PRIMARY KEY (tenant_id, audit_id)
);

CREATE INDEX IF NOT EXISTS audit_log_recent_idx
  ON audit_log (tenant_id, created_at DESC);

COMMIT;


