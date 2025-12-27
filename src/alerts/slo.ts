export type SloVersion = "v1";
export const SLO_VERSION: SloVersion = "v1";

export interface WorkflowSlo {
  // Hard maximums / minimums for alerting
  max_latency_p95_ms: number;
  min_faithfulness_p05: number;
  min_quality_p05: number;
  max_anomaly_rate: number; // anomaly_count / n
}

export const DEFAULT_WORKFLOW_SLO: WorkflowSlo = {
  max_latency_p95_ms: 5_000,
  min_faithfulness_p05: 0.7,
  min_quality_p05: 0.6,
  max_anomaly_rate: 0.05
};

export const WORKFLOW_SLO_OVERRIDES: Record<string, Partial<WorkflowSlo>> = {
  geoRiskExposure: { max_latency_p95_ms: 7_000, min_faithfulness_p05: 0.72 }
};

export function getWorkflowSlo(workflowId: string): WorkflowSlo {
  return { ...DEFAULT_WORKFLOW_SLO, ...(WORKFLOW_SLO_OVERRIDES[workflowId] ?? {}) };
}

export interface HourlyRollupRow {
  workflow_id: string;
  agent_id: string;
  agent_version: string;
  hour_bucket: string; // ISO timestamp
  n: number;
  p95_latency_ms?: number | null;
  p05_faithfulness?: number | null;
  p05_quality?: number | null;
  anomaly_count: number;
}

export interface SloViolation {
  slo_version: SloVersion;
  workflow_id: string;
  agent_id: string;
  agent_version: string;
  hour_bucket: string;
  kind:
    | "latency_p95_exceeded"
    | "faithfulness_p05_below"
    | "quality_p05_below"
    | "anomaly_rate_exceeded";
  details: Record<string, unknown>;
}

export function evaluateRollupAgainstSlo(row: HourlyRollupRow): SloViolation[] {
  const slo = getWorkflowSlo(row.workflow_id);
  const out: SloViolation[] = [];

  const anomalyRate = row.n > 0 ? row.anomaly_count / row.n : 0;
  if (anomalyRate > slo.max_anomaly_rate) {
    out.push({
      slo_version: SLO_VERSION,
      workflow_id: row.workflow_id,
      agent_id: row.agent_id,
      agent_version: row.agent_version,
      hour_bucket: row.hour_bucket,
      kind: "anomaly_rate_exceeded",
      details: { anomalyRate, threshold: slo.max_anomaly_rate, n: row.n, anomaly_count: row.anomaly_count }
    });
  }

  if (row.p95_latency_ms != null && row.p95_latency_ms > slo.max_latency_p95_ms) {
    out.push({
      slo_version: SLO_VERSION,
      workflow_id: row.workflow_id,
      agent_id: row.agent_id,
      agent_version: row.agent_version,
      hour_bucket: row.hour_bucket,
      kind: "latency_p95_exceeded",
      details: { p95_latency_ms: row.p95_latency_ms, threshold: slo.max_latency_p95_ms }
    });
  }

  if (row.p05_faithfulness != null && row.p05_faithfulness < slo.min_faithfulness_p05) {
    out.push({
      slo_version: SLO_VERSION,
      workflow_id: row.workflow_id,
      agent_id: row.agent_id,
      agent_version: row.agent_version,
      hour_bucket: row.hour_bucket,
      kind: "faithfulness_p05_below",
      details: { p05_faithfulness: row.p05_faithfulness, threshold: slo.min_faithfulness_p05 }
    });
  }

  if (row.p05_quality != null && row.p05_quality < slo.min_quality_p05) {
    out.push({
      slo_version: SLO_VERSION,
      workflow_id: row.workflow_id,
      agent_id: row.agent_id,
      agent_version: row.agent_version,
      hour_bucket: row.hour_bucket,
      kind: "quality_p05_below",
      details: { p05_quality: row.p05_quality, threshold: slo.min_quality_p05 }
    });
  }

  return out;
}



