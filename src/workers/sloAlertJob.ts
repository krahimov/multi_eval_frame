import type pg from "pg";
import { evaluateRollupAgainstSlo } from "../alerts/slo.js";
import { materializeHourlyRollups } from "../eval/rollups.js";
import { hasRecentOpenAction, insertRecommendedAction } from "../auto_eval/actions.js";

export interface SloAlertJobOptions {
  tenantId: string;
  lookbackHours: number;
}

export async function runSloAlertJob(
  pool: pg.Pool,
  opts: SloAlertJobOptions
): Promise<{ rollups_upserted: number; violations: number; actions_created: number }> {
  const mat = await materializeHourlyRollups(pool, { tenantId: opts.tenantId, lookbackHours: opts.lookbackHours });

  const since = new Date(Date.now() - Math.max(1, opts.lookbackHours) * 60 * 60 * 1000).toISOString();
  const rollups = await pool.query<{
    workflow_id: string;
    agent_id: string;
    agent_version: string;
    hour_bucket: string;
    n: number;
    p95_latency_ms: number | null;
    p05_faithfulness: number | null;
    p05_quality: number | null;
    anomaly_count: number;
  }>(
    `
    SELECT workflow_id, agent_id, agent_version, hour_bucket::text, n,
           p95_latency_ms, p05_faithfulness, p05_quality, anomaly_count
    FROM metric_rollups_hourly
    WHERE tenant_id = $1
      AND hour_bucket >= $2::timestamptz
    ORDER BY hour_bucket DESC
  `,
    [opts.tenantId, since]
  );

  let violations = 0;
  let actionsCreated = 0;
  for (const r of rollups.rows) {
    const v = evaluateRollupAgainstSlo({
      workflow_id: r.workflow_id,
      agent_id: r.agent_id,
      agent_version: r.agent_version,
      hour_bucket: r.hour_bucket,
      n: r.n,
      p95_latency_ms: r.p95_latency_ms,
      p05_faithfulness: r.p05_faithfulness,
      p05_quality: r.p05_quality,
      anomaly_count: r.anomaly_count
    });
    violations += v.length;

    for (const viol of v) {
      const target = {
        workflow_id: viol.workflow_id,
        agent_id: viol.agent_id,
        agent_version: viol.agent_version,
        hour_bucket: viol.hour_bucket,
        violation: viol.kind
      };
      const targetKey = JSON.stringify(target);
      if (await hasRecentOpenAction(pool, opts.tenantId, "run_investigation", targetKey, 6)) continue;
      await insertRecommendedAction(pool, {
        tenant_id: opts.tenantId,
        action_type: "run_investigation",
        target,
        payload: { ...viol }
      });
      actionsCreated++;
    }
  }

  return { rollups_upserted: mat.upserted_groups, violations, actions_created: actionsCreated };
}


