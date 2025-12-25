import type { NormalizedAgentMetrics } from "./normalize.js";

export type WeightingVersion = "v1";
export const WEIGHTING_VERSION: WeightingVersion = "v1";

export interface QualityWeights {
  faithfulness: number;
  coverage: number;
  confidence: number;
  hallucination: number;
  latency: number;
}

export const DEFAULT_QUALITY_WEIGHTS: QualityWeights = {
  faithfulness: 0.35,
  coverage: 0.25,
  confidence: 0.15,
  hallucination: 0.15,
  latency: 0.1
};

export const WORKFLOW_QUALITY_WEIGHTS: Record<string, Partial<QualityWeights>> = {
  // Example: for geo risk queries, penalize hallucination a bit more.
  geoRiskExposure: { hallucination: 0.2, latency: 0.05 }
};

export function getQualityWeights(workflowId: string): QualityWeights {
  const override = WORKFLOW_QUALITY_WEIGHTS[workflowId] ?? {};
  return { ...DEFAULT_QUALITY_WEIGHTS, ...override };
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function renormalizeWeights(weights: Record<string, number>): Record<string, number> {
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(weights)) out[k] = v / sum;
  return out;
}

export interface AggregatedScores {
  run_quality_score: number | null;
  risk_score: number | null;
}

export function aggregateAgentQuality(workflowId: string, m: NormalizedAgentMetrics): AggregatedScores {
  const w = getQualityWeights(workflowId);

  // Only include metrics that are present; re-normalize weights.
  const components: { key: keyof QualityWeights; value: number | null }[] = [
    { key: "faithfulness", value: m.faithfulness_norm },
    { key: "coverage", value: m.coverage_norm },
    { key: "confidence", value: m.confidence_norm },
    { key: "hallucination", value: m.hallucination_norm },
    { key: "latency", value: m.latency_norm }
  ];

  const present = components.filter((c) => c.value != null) as { key: keyof QualityWeights; value: number }[];
  if (present.length === 0) return { run_quality_score: null, risk_score: null };

  const presentWeights: Record<string, number> = {};
  for (const c of present) presentWeights[c.key] = w[c.key];
  const wNorm = renormalizeWeights(presentWeights);

  let score = 0;
  for (const c of present) score += (wNorm[c.key] ?? 0) * c.value;

  // Risk: penalize low faithfulness and hallucination; ignore missing.
  const f = m.faithfulness_norm ?? 1;
  const h = m.hallucination_norm ?? 1;
  const risk = clamp01(1 - f * h);

  return { run_quality_score: clamp01(score), risk_score: risk };
}

export interface ShrinkageConfig {
  k: number;
  prior: number;
}

export const DEFAULT_SHRINKAGE: ShrinkageConfig = {
  // Larger k means slower movement away from prior when n is small
  k: 50,
  prior: 0.75
};

export function shrinkScore(observed: number, n: number, cfg: ShrinkageConfig = DEFAULT_SHRINKAGE): number {
  const alpha = n / (n + cfg.k);
  return clamp01(alpha * observed + (1 - alpha) * cfg.prior);
}

export interface OrchestrationComponentScore {
  agent_id: string;
  score: number | null;
  weight?: number;
}

export function aggregateOrchestrationRunQuality(components: OrchestrationComponentScore[]): number | null {
  const present = components.filter((c) => c.score != null) as { agent_id: string; score: number; weight?: number }[];
  if (present.length === 0) return null;

  const weights = present.map((c) => (c.weight == null ? 1 : c.weight));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum <= 0) return null;

  let total = 0;
  for (let i = 0; i < present.length; i++) total += (present[i]!.score * weights[i]!) / weightSum;
  return clamp01(total);
}


