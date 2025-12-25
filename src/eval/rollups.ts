import type pg from "pg";

export interface RollupOptions {
  tenantId: string;
  lookbackHours: number;
}

export async function materializeHourlyRollups(
  pool: pg.Pool,
  opts: RollupOptions
): Promise<{ upserted_groups: number }> {
  const lookbackHours = Math.max(1, Math.floor(opts.lookbackHours));
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);

  const res = await pool.query<{
    upserted_groups: number;
  }>(
    `
    WITH buckets AS (
      SELECT
        tenant_id,
        workflow_id,
        agent_id,
        agent_version,
        date_trunc('hour', scoring_timestamp) AS hour_bucket,

        COUNT(*)::int AS n,

        AVG(latency_ms)::double precision AS mean_latency_ms,
        AVG(faithfulness_score)::double precision AS mean_faithfulness,
        AVG(coverage_score)::double precision AS mean_coverage,
        AVG(confidence_score)::double precision AS mean_confidence,
        AVG(run_quality_score)::double precision AS mean_quality,

        STDDEV_SAMP(latency_ms)::double precision AS std_latency_ms,
        STDDEV_SAMP(faithfulness_score)::double precision AS std_faithfulness,
        STDDEV_SAMP(coverage_score)::double precision AS std_coverage,
        STDDEV_SAMP(confidence_score)::double precision AS std_confidence,
        STDDEV_SAMP(run_quality_score)::double precision AS std_quality,

        percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_latency_ms,

        percentile_cont(0.50) WITHIN GROUP (ORDER BY faithfulness_score) AS p50_faithfulness,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY faithfulness_score) AS p95_faithfulness,
        percentile_cont(0.10) WITHIN GROUP (ORDER BY faithfulness_score) AS p10_faithfulness,
        percentile_cont(0.05) WITHIN GROUP (ORDER BY faithfulness_score) AS p05_faithfulness,

        percentile_cont(0.50) WITHIN GROUP (ORDER BY run_quality_score) AS p50_quality,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY run_quality_score) AS p95_quality,
        percentile_cont(0.10) WITHIN GROUP (ORDER BY run_quality_score) AS p10_quality,
        percentile_cont(0.05) WITHIN GROUP (ORDER BY run_quality_score) AS p05_quality,

        SUM(CASE WHEN anomaly_flag THEN 1 ELSE 0 END)::int AS anomaly_count
      FROM evaluation_records
      WHERE tenant_id = $1
        AND scoring_timestamp >= $2::timestamptz
      GROUP BY 1,2,3,4,5
    ),
    upserted AS (
      INSERT INTO metric_rollups_hourly (
        tenant_id, workflow_id, agent_id, agent_version, hour_bucket,
        n,
        mean_latency_ms, mean_faithfulness, mean_coverage, mean_confidence, mean_quality,
        std_latency_ms, std_faithfulness, std_coverage, std_confidence, std_quality,
        p95_latency_ms,
        p50_faithfulness, p95_faithfulness, p10_faithfulness, p05_faithfulness,
        p50_quality, p95_quality, p10_quality, p05_quality,
        anomaly_count,
        updated_at
      )
      SELECT
        tenant_id, workflow_id, agent_id, agent_version, hour_bucket,
        n,
        mean_latency_ms, mean_faithfulness, mean_coverage, mean_confidence, mean_quality,
        std_latency_ms, std_faithfulness, std_coverage, std_confidence, std_quality,
        p95_latency_ms,
        p50_faithfulness, p95_faithfulness, p10_faithfulness, p05_faithfulness,
        p50_quality, p95_quality, p10_quality, p05_quality,
        anomaly_count,
        now()
      FROM buckets
      ON CONFLICT (tenant_id, workflow_id, agent_id, agent_version, hour_bucket)
      DO UPDATE SET
        n = EXCLUDED.n,
        mean_latency_ms = EXCLUDED.mean_latency_ms,
        mean_faithfulness = EXCLUDED.mean_faithfulness,
        mean_coverage = EXCLUDED.mean_coverage,
        mean_confidence = EXCLUDED.mean_confidence,
        mean_quality = EXCLUDED.mean_quality,
        std_latency_ms = EXCLUDED.std_latency_ms,
        std_faithfulness = EXCLUDED.std_faithfulness,
        std_coverage = EXCLUDED.std_coverage,
        std_confidence = EXCLUDED.std_confidence,
        std_quality = EXCLUDED.std_quality,
        p95_latency_ms = EXCLUDED.p95_latency_ms,
        p50_faithfulness = EXCLUDED.p50_faithfulness,
        p95_faithfulness = EXCLUDED.p95_faithfulness,
        p10_faithfulness = EXCLUDED.p10_faithfulness,
        p05_faithfulness = EXCLUDED.p05_faithfulness,
        p50_quality = EXCLUDED.p50_quality,
        p95_quality = EXCLUDED.p95_quality,
        p10_quality = EXCLUDED.p10_quality,
        p05_quality = EXCLUDED.p05_quality,
        anomaly_count = EXCLUDED.anomaly_count,
        updated_at = EXCLUDED.updated_at
      RETURNING 1
    )
    SELECT COUNT(*)::int AS upserted_groups FROM upserted;
  `,
    [opts.tenantId, since.toISOString()]
  );

  return { upserted_groups: res.rows[0]?.upserted_groups ?? 0 };
}


