import type { FastifyInstance } from "fastify";
import type pg from "pg";

function getTenantIdFromReq(req: any): string {
  const header = req.headers["x-tenant-id"];
  if (typeof header === "string" && header.trim().length) return header.trim();
  return process.env.TENANT_ID ?? "t_123";
}

export function registerQueryRoutes(app: FastifyInstance, deps: { pool: pg.Pool }): void {
  app.get("/metrics/agents", async (req) => {
    const tenantId = getTenantIdFromReq(req);
    const since = typeof (req.query as any).since === "string" ? (req.query as any).since : null;
    const until = typeof (req.query as any).until === "string" ? (req.query as any).until : null;
    const limit = Math.min(500, Math.max(1, Number((req.query as any).limit ?? "100")));

    const rows = await deps.pool.query(
      `
      SELECT
        workflow_id,
        agent_id,
        agent_version,
        COUNT(*)::int AS n,
        AVG(run_quality_score)::double precision AS mean_quality,
        AVG(faithfulness_score)::double precision AS mean_faithfulness,
        AVG(coverage_score)::double precision AS mean_coverage,
        AVG(confidence_score)::double precision AS mean_confidence,
        AVG(latency_ms)::double precision AS mean_latency_ms
      FROM evaluation_records
      WHERE tenant_id = $1
        AND ($2::timestamptz IS NULL OR scoring_timestamp >= $2::timestamptz)
        AND ($3::timestamptz IS NULL OR scoring_timestamp < $3::timestamptz)
      GROUP BY 1,2,3
      ORDER BY mean_quality DESC NULLS LAST
      LIMIT $4
    `,
      [tenantId, since, until, limit]
    );

    return { ok: true, tenant_id: tenantId, rows: rows.rows };
  });

  app.get("/metrics/workflows", async (req) => {
    const tenantId = getTenantIdFromReq(req);
    const since = typeof (req.query as any).since === "string" ? (req.query as any).since : null;
    const until = typeof (req.query as any).until === "string" ? (req.query as any).until : null;
    const limit = Math.min(200, Math.max(1, Number((req.query as any).limit ?? "50")));

    const rows = await deps.pool.query(
      `
      SELECT
        workflow_id,
        COUNT(*)::int AS n,
        AVG(run_quality_score)::double precision AS mean_quality,
        AVG(faithfulness_score)::double precision AS mean_faithfulness,
        AVG(coverage_score)::double precision AS mean_coverage,
        AVG(confidence_score)::double precision AS mean_confidence,
        AVG(latency_ms)::double precision AS mean_latency_ms
      FROM evaluation_records
      WHERE tenant_id = $1
        AND ($2::timestamptz IS NULL OR scoring_timestamp >= $2::timestamptz)
        AND ($3::timestamptz IS NULL OR scoring_timestamp < $3::timestamptz)
      GROUP BY 1
      ORDER BY mean_quality DESC NULLS LAST
      LIMIT $4
    `,
      [tenantId, since, until, limit]
    );

    return { ok: true, tenant_id: tenantId, rows: rows.rows };
  });

  app.get("/anomalies", async (req) => {
    const tenantId = getTenantIdFromReq(req);
    const limit = Math.min(500, Math.max(1, Number((req.query as any).limit ?? "100")));

    const rows = await deps.pool.query(
      `
      SELECT
        a.created_at,
        a.metric_name,
        a.method,
        a.value,
        a.z_score,
        a.threshold_low,
        a.threshold_high,
        e.workflow_id,
        e.agent_id,
        e.agent_version,
        e.scoring_timestamp
      FROM anomalies a
      JOIN evaluation_records e
        ON e.tenant_id = a.tenant_id
       AND e.evaluation_id = a.evaluation_id
      WHERE a.tenant_id = $1
      ORDER BY a.created_at DESC
      LIMIT $2
    `,
      [tenantId, limit]
    );

    return { ok: true, tenant_id: tenantId, rows: rows.rows };
  });

  app.get("/backtests", async (req) => {
    const tenantId = getTenantIdFromReq(req);
    const limit = Math.min(200, Math.max(1, Number((req.query as any).limit ?? "50")));

    const rows = await deps.pool.query(
      `
      SELECT created_at, backtest_id::text, dataset_version, code_version, start_time, end_time, horizon, status, summary
      FROM backtest_runs
      WHERE tenant_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
      [tenantId, limit]
    );
    return { ok: true, tenant_id: tenantId, rows: rows.rows };
  });

  app.get("/signals/:id", async (req, reply) => {
    const tenantId = getTenantIdFromReq(req);
    const signalId = (req.params as any).id;
    const row = await deps.pool.query(
      `
      SELECT signal_id::text, orchestration_run_id, workflow_id, query_id, event_time, agent_id, agent_version,
             prediction_type, horizon, instrument_universe, signal_value, confidence, constraints
      FROM signals
      WHERE tenant_id = $1 AND signal_id = $2::uuid
    `,
      [tenantId, signalId]
    );
    if (!row.rows[0]) return reply.status(404).send({ ok: false, error: "Not found" });
    return { ok: true, tenant_id: tenantId, signal: row.rows[0] };
  });

  app.get("/actions/recommended", async (req) => {
    const tenantId = getTenantIdFromReq(req);
    const status = typeof (req.query as any).status === "string" ? (req.query as any).status : "open";
    const limit = Math.min(500, Math.max(1, Number((req.query as any).limit ?? "100")));

    const rows = await deps.pool.query(
      `
      SELECT created_at, action_id::text, action_type, target, payload, decided_by, status
      FROM recommended_actions
      WHERE tenant_id = $1 AND status = $2
      ORDER BY created_at DESC
      LIMIT $3
    `,
      [tenantId, status, limit]
    );

    return { ok: true, tenant_id: tenantId, rows: rows.rows };
  });
}


