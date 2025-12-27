import type pg from "pg";
import { v4 as uuidv4 } from "uuid";
import { detectOutlierMAD, detectOutlierZScore } from "../eval/outliers.js";

export interface AnomalyJobOptions {
  tenantId: string;
  lookbackHours: number;
  minHistory: number;
  perGroupLimit: number;
}

export const DEFAULT_ANOMALY_JOB_OPTIONS: AnomalyJobOptions = {
  tenantId: "t_123",
  lookbackHours: 72,
  minHistory: 30,
  perGroupLimit: 200
};

type GroupKey = { workflow_id: string; agent_id: string; agent_version: string };

type EvalRow = {
  evaluation_id: string;
  scoring_timestamp: string;
  latency_ms: number;
  confidence_score: number | null;
  faithfulness_score: number | null;
  run_quality_score: number | null;
  hallucination_flag: boolean | null;
  anomaly_flag: boolean;
};

function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

async function fetchGroups(pool: pg.Pool, tenantId: string, sinceIso: string): Promise<GroupKey[]> {
  const res = await pool.query<GroupKey>(
    `
    SELECT workflow_id, agent_id, agent_version
    FROM evaluation_records
    WHERE tenant_id = $1 AND scoring_timestamp >= $2::timestamptz
    GROUP BY 1,2,3
  `,
    [tenantId, sinceIso]
  );
  return res.rows;
}

async function fetchGroupEvals(
  pool: pg.Pool,
  tenantId: string,
  g: GroupKey,
  limit: number
): Promise<EvalRow[]> {
  const res = await pool.query<EvalRow>(
    `
    SELECT evaluation_id::text, scoring_timestamp::text, latency_ms,
           confidence_score, faithfulness_score, run_quality_score,
           hallucination_flag,
           anomaly_flag
    FROM evaluation_records
    WHERE tenant_id = $1
      AND workflow_id = $2
      AND agent_id = $3
      AND agent_version = $4
    ORDER BY scoring_timestamp DESC
    LIMIT $5
  `,
    [tenantId, g.workflow_id, g.agent_id, g.agent_version, limit]
  );
  return res.rows;
}

async function insertAnomaly(
  pool: pg.Pool,
  tenantId: string,
  evaluationId: string,
  metricName: string,
  method: string,
  value: number,
  thresholdLow: number | null,
  thresholdHigh: number | null,
  zScore: number | null,
  details: Record<string, unknown>
): Promise<void> {
  await pool.query(
    `
    INSERT INTO anomalies (
      tenant_id, anomaly_id, evaluation_id,
      metric_name, method,
      value, threshold_low, threshold_high, z_score,
      details
    )
    VALUES (
      $1, $2::uuid, $3::uuid,
      $4, $5,
      $6, $7, $8, $9,
      $10::jsonb
    )
  `,
    [
      tenantId,
      uuidv4(),
      evaluationId,
      metricName,
      method,
      value,
      thresholdLow,
      thresholdHigh,
      zScore,
      JSON.stringify(details)
    ]
  );
}

async function markEvaluationAnomalous(pool: pg.Pool, tenantId: string, evaluationId: string): Promise<void> {
  await pool.query(
    `
    UPDATE evaluation_records
    SET anomaly_flag = true
    WHERE tenant_id = $1 AND evaluation_id = $2::uuid
  `,
    [tenantId, evaluationId]
  );
}

export async function runAnomalyJob(
  pool: pg.Pool,
  opts: AnomalyJobOptions
): Promise<{ groups: number; anomalies_created: number }> {
  const sinceIso = hoursAgoIso(Math.max(1, opts.lookbackHours));
  const groups = await fetchGroups(pool, opts.tenantId, sinceIso);

  let anomaliesCreated = 0;
  for (const g of groups) {
    const evals = await fetchGroupEvals(pool, opts.tenantId, g, opts.perGroupLimit);
    if (evals.length < opts.minHistory) continue;

    // Evaluate up to the most recent 20 points (each vs older history), so we can
    // backfill anomalies after a seed run.
    const maxCandidates = Math.min(20, evals.length - opts.minHistory);
    for (let i = 0; i < maxCandidates; i++) {
      const cand = evals[i]!;
      if (cand.anomaly_flag) continue;
      const history = evals.slice(i + 1);
      if (history.length < opts.minHistory) continue;

      // Hallucination flag: always record as anomaly (high impact).
      if (cand.hallucination_flag === true) {
        await insertAnomaly(
          pool,
          opts.tenantId,
          cand.evaluation_id,
          "hallucination_flag",
          "rule",
          1,
          null,
          null,
          null,
          { reason: "hallucination_flag_true" }
        );
        await markEvaluationAnomalous(pool, opts.tenantId, cand.evaluation_id);
        anomaliesCreated++;
        continue;
      }

      // Latency: robust MAD (heavy tails)
      const latencyHist = history.map((r) => r.latency_ms);
      const latencyRes = detectOutlierMAD(latencyHist, cand.latency_ms, 3.5);
      if (latencyRes.is_outlier) {
        await insertAnomaly(
          pool,
          opts.tenantId,
          cand.evaluation_id,
          "latency_ms",
          latencyRes.method,
          cand.latency_ms,
          latencyRes.threshold_low,
          latencyRes.threshold_high,
          latencyRes.z_score,
          latencyRes.details ?? {}
        );
        await markEvaluationAnomalous(pool, opts.tenantId, cand.evaluation_id);
        anomaliesCreated++;
        continue;
      }

      // Confidence: z-score if present
      if (cand.confidence_score != null) {
        const confHist = history.map((r) => r.confidence_score).filter((x): x is number => x != null);
        if (confHist.length >= opts.minHistory) {
          const confRes = detectOutlierZScore(confHist, cand.confidence_score, 3);
          if (confRes.is_outlier) {
            await insertAnomaly(
              pool,
              opts.tenantId,
              cand.evaluation_id,
              "confidence_score",
              confRes.method,
              cand.confidence_score,
              confRes.threshold_low,
              confRes.threshold_high,
              confRes.z_score,
              confRes.details ?? {}
            );
            await markEvaluationAnomalous(pool, opts.tenantId, cand.evaluation_id);
            anomaliesCreated++;
            continue;
          }
        }
      }

      // Faithfulness: low-tail anomaly (z-score); only if present
      if (cand.faithfulness_score != null) {
        const fHist = history.map((r) => r.faithfulness_score).filter((x): x is number => x != null);
        if (fHist.length >= opts.minHistory) {
          const fRes = detectOutlierZScore(fHist, cand.faithfulness_score, 3);
          if (fRes.is_outlier && (fRes.z_score ?? 0) < 0) {
            await insertAnomaly(
              pool,
              opts.tenantId,
              cand.evaluation_id,
              "faithfulness_score",
              fRes.method,
              cand.faithfulness_score,
              fRes.threshold_low,
              fRes.threshold_high,
              fRes.z_score,
              fRes.details ?? {}
            );
            await markEvaluationAnomalous(pool, opts.tenantId, cand.evaluation_id);
            anomaliesCreated++;
            continue;
          }
        }
      }
    }
  }

  return { groups: groups.length, anomalies_created: anomaliesCreated };
}


