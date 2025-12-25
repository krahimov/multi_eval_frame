import type pg from "pg";
import { detectDrift } from "../auto_eval/drift.js";
import { hasRecentOpenAction, insertRecommendedAction } from "../auto_eval/actions.js";

export interface AutoEvalJobOptions {
  tenantId: string;
  baselineHours: number;
  currentHours: number;
}

type MetricGroupRow = {
  workflow_id: string;
  agent_id: string;
  agent_version: string;
  base_vals: number[] | null;
  cur_vals: number[] | null;
};

export async function runAutoEvalJob(
  pool: pg.Pool,
  opts: AutoEvalJobOptions
): Promise<{ groups_checked: number; actions_created: number }> {
  const baselineHours = Math.max(6, Math.floor(opts.baselineHours));
  const currentHours = Math.max(1, Math.floor(opts.currentHours));

  const curStart = new Date(Date.now() - currentHours * 60 * 60 * 1000).toISOString();
  const baseStart = new Date(Date.now() - (baselineHours + currentHours) * 60 * 60 * 1000).toISOString();

  const res = await pool.query<MetricGroupRow>(
    `
    SELECT
      workflow_id,
      agent_id,
      agent_version,
      array_agg(faithfulness_score) FILTER (
        WHERE scoring_timestamp >= $3::timestamptz
          AND scoring_timestamp < $2::timestamptz
          AND faithfulness_score IS NOT NULL
      ) AS base_vals,
      array_agg(faithfulness_score) FILTER (
        WHERE scoring_timestamp >= $2::timestamptz
          AND faithfulness_score IS NOT NULL
      ) AS cur_vals
    FROM evaluation_records
    WHERE tenant_id = $1
      AND scoring_timestamp >= $3::timestamptz
    GROUP BY 1,2,3
  `,
    [opts.tenantId, curStart, baseStart]
  );

  let actionsCreated = 0;

  for (const row of res.rows) {
    const base = row.base_vals ?? [];
    const cur = row.cur_vals ?? [];
    if (base.length < 20 || cur.length < 10) continue;

    const drift = detectDrift(base, cur);
    if (drift.severity === "none") continue;

    const target = {
      workflow_id: row.workflow_id,
      agent_id: row.agent_id,
      agent_version: row.agent_version,
      metric: "faithfulness_score"
    };
    const targetKey = JSON.stringify(target);

    // Adaptive sampling: increase eval sampling on drift.
    if (!(await hasRecentOpenAction(pool, opts.tenantId, "increase_eval_sampling", targetKey, 6))) {
      await insertRecommendedAction(pool, {
        tenant_id: opts.tenantId,
        action_type: "increase_eval_sampling",
        target,
        payload: {
          severity: drift.severity,
          psi: drift.psi.psi,
          wasserstein: drift.wasserstein,
          // Suggested knob for orchestrator to interpret
          sampling_rate_suggested: drift.severity === "severe" ? 0.2 : 0.05
        }
      });
      actionsCreated++;
    }

    // Human-in-the-loop for severe drift.
    if (drift.severity === "severe") {
      if (!(await hasRecentOpenAction(pool, opts.tenantId, "require_human_review", targetKey, 12))) {
        await insertRecommendedAction(pool, {
          tenant_id: opts.tenantId,
          action_type: "require_human_review",
          target,
          payload: { reason: "severe_metric_drift", ...drift }
        });
        actionsCreated++;
      }
      if (!(await hasRecentOpenAction(pool, opts.tenantId, "route_fallback", targetKey, 12))) {
        await insertRecommendedAction(pool, {
          tenant_id: opts.tenantId,
          action_type: "route_fallback",
          target,
          payload: { reason: "severe_metric_drift", suggested_fallback: "previous_stable_agent_version" }
        });
        actionsCreated++;
      }
    }
  }

  return { groups_checked: res.rows.length, actions_created: actionsCreated };
}


