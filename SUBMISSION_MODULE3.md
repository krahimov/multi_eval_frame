# Module 3 — Evaluation Framework (Real-Time + Long-Term)

> Reference: `AGENTSMYTH ENGINEERING CHALLENGE (1).pdf`

This submission implements a **complete evaluation system** for a multi-agent orchestration framework.

---

## ✅ Section 1 — Real-Time Evaluation Framework

### What gets collected
Per agent run we ingest (from `AgentRunCompleted`):

| Field | Type | Description |
|-------|------|-------------|
| `latency_ms` | number | Total execution time |
| `faithfulness_score` | number [0,1] | Alignment with source context |
| `hallucination_flag` | boolean | Detected ungrounded claim |
| `coverage_score` | number [0,1] | Coverage of required data |
| `confidence_score` | number [0,1] | Model's self-assessed confidence |
| `output_summary` | string | LLM-generated summary |

Events are validated via AJV and stored raw in `raw_events`, then processed into normalized `evaluation_records`.

### Normalization + Aggregation
- **Normalization**: `latency_norm` (log-scaled), and pass-through for 0–1 metrics.
- **Aggregation**: weighted `run_quality_score` + `risk_score` (inverse).

### Outlier detection
Implemented methods:
- **MAD (Median Absolute Deviation)**: latency
- **Z-score**: confidence / faithfulness
- **IQR**: fallback

Persisted to `anomalies` table and `evaluation_records.anomaly_flag`.

### API endpoints
```
GET /metrics/workflows      → aggregated metrics by workflow
GET /metrics/agents         → aggregated metrics by agent + version
GET /anomalies              → list detected anomalies
```

---

## ✅ Section 2 — Long-Term Evaluation & Alpha Measurement

### Signals
Ingested via `SignalEmitted` events into `signals` with:
- `horizon` (`1d`, `1w`, etc.)
- `universe` (instrument IDs)
- `signal_vector` (per-instrument weights/scores)

### Outcomes
Ingested via `MarketOutcomeIngested` into `market_outcomes`:

| Key | Purpose |
|-----|---------|
| `dataset_version` | Point-in-time snapshot ID (prevents leakage) |
| `instrument_id` | Symbol |
| `asof_time` | Outcome timestamp |
| `return_1d`, `return_1w` | Forward returns |

### Backtest runner (`npm run backtest:run`)
Computes:
- Mean return, std
- **Sharpe ratio** (and excess Sharpe)
- **Information Coefficient (IC)** and IC t-stat
- Hit rate
- Alpha (net of estimated costs)

Results stored in `backtest_runs` and `signal_outcomes`.

### API endpoints
```
GET /backtests              → list backtest runs
```

---

## ✅ Section 3 — Auto-Evaluation System

### Drift detection
Detects distribution drift on `faithfulness_score` per `(workflow, agent_id, agent_version)`:
- **PSI (Population Stability Index)**
- **1D Wasserstein distance**

### Automated actions
When severe drift is detected, rows are created in `recommended_actions`:

| action_type | trigger |
|-------------|---------|
| `increase_eval_sampling` | Low drift threshold |
| `require_human_review` | Medium drift |
| `route_fallback` | High drift |

### Significance testing
Compares two time windows (A vs B) per agent/version/metric:
- **Welch's t-test** (Student‑t CDF p-values via jstat)
- **Benjamini–Hochberg correction** for multi-test FDR

Outputs stored in `performance_shifts`.

### API endpoints
```
GET /actions/recommended    → list recommended actions
GET /shifts                 → list significant performance shifts
```

---

## 🏃 Demo procedure (end-to-end)

```bash
# 1. Start API + realtime worker
npm run dev &
npm run worker:realtime &

# 2. Seed dataset with drift + anomaly injection
DATASET_VERSION=pit_demo_best_1 \
INJECT_ANOMALY=true \
npm run seed:demo

# 3. Run scheduled jobs
LOOKBACK_HOURS=72 npm run job:anomalies
WINDOW_HOURS=1 npm run job:significance
BASELINE_HOURS=4 CURRENT_HOURS=1 npm run job:auto-eval

# 4. Backtest
DATASET_VERSION=pit_demo_best_1 HORIZON=1d npm run backtest:run

# 5. Query results
curl http://127.0.0.1:3001/anomalies
curl http://127.0.0.1:3001/shifts
curl http://127.0.0.1:3001/actions/recommended
curl http://127.0.0.1:3001/backtests
```

---

## 📂 Key DB tables

| Table | Purpose |
|-------|---------|
| `orchestration_runs` | Top-level workflow executions |
| `agent_runs` | Per-agent sub-runs linked to orchestration |
| `evaluation_records` | Normalized metrics + quality/risk scores |
| `anomalies` | Detected outliers |
| `metric_rollups_hourly` | Hourly aggregates |
| `signals` | Signal emissions (alpha claims) |
| `market_outcomes` | Ground truth returns |
| `signal_outcomes` | Per-signal backtest results |
| `backtest_runs` | Summary stats per backtest |
| `performance_shifts` | Detected stat-significant shifts |
| `recommended_actions` | Auto-triggered actions |
| `dead_letter_events` | Invalid/failed events |

---

## 🔐 Security

- API key auth via `X-API-Key` header (optional for demo)
- Tenant isolation via `tenant_id` in all tables
- Audit logging of mutations

---

## 📈 Observability

- Prometheus metrics at `GET /metrics` (via prom-client)
- OpenTelemetry tracing (OTLP exporter-ready)
- Structured JSON logging

---

## 🚀 Deployment notes

See `README.md` for environment setup. Recommended:

- **Neon** for Postgres (SSL auto-detected)
- **cron** or scheduler for `job:anomalies`, `job:significance`, `job:auto-eval`, `job:slo-alerts`
- Single-process API + long-running worker in separate process

---

*Submission prepared for the AGENTSMYTH Module 3 Engineering Challenge.*
