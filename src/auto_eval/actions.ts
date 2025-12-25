import type pg from "pg";
import { v4 as uuidv4 } from "uuid";
import { writeAudit } from "../security/audit.js";

export type RecommendedActionType =
  | "increase_eval_sampling"
  | "route_fallback"
  | "rate_limit_agent"
  | "require_human_review"
  | "run_investigation";

export interface RecommendedActionInput {
  tenant_id: string;
  action_type: RecommendedActionType;
  target: Record<string, unknown>;
  payload?: Record<string, unknown> | null;
  decided_by?: "auto" | "human";
}

export async function insertRecommendedAction(pool: pg.Pool, input: RecommendedActionInput): Promise<string> {
  const actionId = uuidv4();
  await pool.query(
    `
    INSERT INTO recommended_actions (
      tenant_id, action_id,
      action_type, target, payload,
      decided_by, status
    )
    VALUES (
      $1, $2::uuid,
      $3, $4::jsonb, $5::jsonb,
      $6, 'open'
    )
  `,
    [
      input.tenant_id,
      actionId,
      input.action_type,
      input.target as unknown as object,
      (input.payload ?? null) as unknown as object,
      input.decided_by ?? "auto"
    ]
  );

  try {
    await writeAudit(pool, {
      tenant_id: input.tenant_id,
      actor_type: input.decided_by === "human" ? "user" : "auto",
      action: "recommended_action_created",
      resource_type: "recommended_action",
      resource_id: actionId,
      metadata: { action_type: input.action_type, target: input.target, payload: input.payload ?? null }
    });
  } catch {
    // best-effort
  }

  return actionId;
}

export async function hasRecentOpenAction(
  pool: pg.Pool,
  tenantId: string,
  actionType: string,
  targetKey: string,
  lookbackHours = 6
): Promise<boolean> {
  const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
  const res = await pool.query<{ n: number }>(
    `
    SELECT COUNT(*)::int AS n
    FROM recommended_actions
    WHERE tenant_id = $1
      AND action_type = $2
      AND status = 'open'
      AND created_at >= $3::timestamptz
      AND target::text = $4
  `,
    [tenantId, actionType, since, targetKey]
  );
  return (res.rows[0]?.n ?? 0) > 0;
}


