export type NormalizationVersion = "v1";

export const NORMALIZATION_VERSION: NormalizationVersion = "v1";

export interface NormalizationConfig {
  latency_p99_target_ms: number;
}

export const DEFAULT_NORMALIZATION_CONFIG: NormalizationConfig = {
  latency_p99_target_ms: 5_000
};

export const WORKFLOW_NORMALIZATION_CONFIG: Record<string, Partial<NormalizationConfig>> = {
  // Example overrides (extend as workflows stabilize)
  geoRiskExposure: { latency_p99_target_ms: 7_000 }
};

export function getNormalizationConfig(workflowId: string): NormalizationConfig {
  const override = WORKFLOW_NORMALIZATION_CONFIG[workflowId] ?? {};
  return { ...DEFAULT_NORMALIZATION_CONFIG, ...override };
}

export interface RawAgentMetrics {
  latency_ms: number;
  faithfulness_score?: number;
  hallucination_flag?: boolean;
  coverage_score?: number;
  confidence_score?: number;
}

export interface NormalizedAgentMetrics {
  latency_norm: number;
  faithfulness_norm: number | null;
  hallucination_norm: number | null;
  coverage_norm: number | null;
  confidence_norm: number | null;
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function normalizeOptional01(x: number | undefined): number | null {
  if (x == null) return null;
  return clamp01(x);
}

export function normalizeLatencyMs(latencyMs: number, p99TargetMs: number): number {
  const denom = Math.log1p(Math.max(1, p99TargetMs));
  const raw = 1 - Math.log1p(Math.max(0, latencyMs)) / denom;
  return clamp01(raw);
}

export function normalizeAgentMetrics(workflowId: string, metrics: RawAgentMetrics): NormalizedAgentMetrics {
  const cfg = getNormalizationConfig(workflowId);

  const latency_norm = normalizeLatencyMs(metrics.latency_ms, cfg.latency_p99_target_ms);
  const faithfulness_norm = normalizeOptional01(metrics.faithfulness_score);
  const coverage_norm = normalizeOptional01(metrics.coverage_score);
  const confidence_norm = normalizeOptional01(metrics.confidence_score);

  const hallucination_norm =
    metrics.hallucination_flag == null ? null : metrics.hallucination_flag === true ? 0 : 1;

  return { latency_norm, faithfulness_norm, hallucination_norm, coverage_norm, confidence_norm };
}


