import type pg from "pg";
import { v4 as uuidv4 } from "uuid";
import { benjaminiHochberg, cusumTwoSided, ewma, welchTTest } from "../eval/changeDetection.js";

export interface SignificanceJobOptions {
  tenantId: string;
  metric: "run_quality_score" | "faithfulness_score";
  windowHours: number;
  alpha: number;
}

type GroupRow = {
  workflow_id: string;
  agent_id: string;
  agent_version: string;
  window_a: number[] | null;
  window_b: number[] | null;
};

function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

export async function runSignificanceJob(
  pool: pg.Pool,
  opts: SignificanceJobOptions
): Promise<{ tests_run: number; shifts_written: number }> {
  const windowHours = Math.max(1, Math.floor(opts.windowHours));
  const aStart = hoursAgoIso(windowHours);
  const bStart = hoursAgoIso(windowHours * 2);

  // Window A = [now-windowHours, now], Window B = [now-2*windowHours, now-windowHours]
  const rows = await pool.query<GroupRow>(
    `
    SELECT
      workflow_id,
      agent_id,
      agent_version,
      array_agg(${opts.metric} ORDER BY scoring_timestamp) FILTER (
        WHERE scoring_timestamp >= $2::timestamptz AND scoring_timestamp < now()
      ) AS window_a,
      array_agg(${opts.metric} ORDER BY scoring_timestamp) FILTER (
        WHERE scoring_timestamp >= $3::timestamptz AND scoring_timestamp < $2::timestamptz
      ) AS window_b
    FROM evaluation_records
    WHERE tenant_id = $1
      AND scoring_timestamp >= $3::timestamptz
      AND ${opts.metric} IS NOT NULL
    GROUP BY 1,2,3
  `,
    [opts.tenantId, aStart, bStart]
  );

  const tests: {
    id: string;
    workflow_id: string;
    agent_id: string;
    agent_version: string;
    p_value: number;
    effect_size: number;
    details: Record<string, unknown>;
  }[] = [];

  for (const r of rows.rows) {
    const a = r.window_a ?? [];
    const b = r.window_b ?? [];
    if (a.length < 2 || b.length < 2) continue;

    const t = welchTTest(a, b);
    const id = `${r.workflow_id}:${r.agent_id}:${r.agent_version}:${opts.metric}`;
    tests.push({
      id,
      workflow_id: r.workflow_id,
      agent_id: r.agent_id,
      agent_version: r.agent_version,
      p_value: t.p_value_two_sided,
      effect_size: t.effect_size,
      details: { ...t, metric: opts.metric, approx: "normal" }
    });
  }

  const bh = benjaminiHochberg(
    tests.map((t) => ({ id: t.id, p_value: t.p_value })),
    opts.alpha
  );
  const bhById = new Map(bh.map((x) => [x.id, x]));

  let written = 0;
  for (const t of tests) {
    const bhItem = bhById.get(t.id);
    const shiftId = uuidv4();
    const significant = bhItem?.significant ?? false;
    const bhAdjusted = bhItem?.q_value ?? null;

    await pool.query(
      `
      INSERT INTO performance_shifts (
        tenant_id, shift_id, workflow_id, agent_id, agent_version, metric_name,
        window_a_start, window_a_end, window_b_start, window_b_end,
        method, p_value, bh_adjusted_p_value, effect_size, significant, details
      )
      VALUES (
        $1, $2::uuid, $3, $4, $5, $6,
        $7::timestamptz, now(), $8::timestamptz, $7::timestamptz,
        $9, $10, $11, $12, $13, $14::jsonb
      )
    `,
      [
        opts.tenantId,
        shiftId,
        t.workflow_id,
        t.agent_id,
        t.agent_version,
        opts.metric,
        aStart,
        bStart,
        "welch_normal_approx",
        t.p_value,
        bhAdjusted,
        t.effect_size,
        significant,
        t.details
      ]
    );
    written++;
  }

  // EWMA/CUSUM (heuristic) on hourly mean_quality (if present), to satisfy change-point detection requirement.
  // This writes "performance_shifts" with method=ewma/cusum only when clear signals exist.
  const rollupRows = await pool.query<{
    workflow_id: string;
    agent_id: string;
    agent_version: string;
    mean_quality: number | null;
    hour_bucket: string;
  }>(
    `
    SELECT workflow_id, agent_id, agent_version, mean_quality, hour_bucket
    FROM metric_rollups_hourly
    WHERE tenant_id = $1
      AND hour_bucket >= $2::timestamptz
      AND mean_quality IS NOT NULL
    ORDER BY workflow_id, agent_id, agent_version, hour_bucket ASC
  `,
    [opts.tenantId, hoursAgoIso(Math.max(24, windowHours * 2))]
  );

  // Group the time series per key.
  const keyToSeries = new Map<string, { meta: { workflow_id: string; agent_id: string; agent_version: string }; xs: number[]; ts: string[] }>();
  for (const r of rollupRows.rows) {
    const key = `${r.workflow_id}:${r.agent_id}:${r.agent_version}`;
    const cur = keyToSeries.get(key) ?? {
      meta: { workflow_id: r.workflow_id, agent_id: r.agent_id, agent_version: r.agent_version },
      xs: [],
      ts: []
    };
    cur.xs.push(r.mean_quality!);
    cur.ts.push(r.hour_bucket);
    keyToSeries.set(key, cur);
  }

  for (const { meta, xs, ts } of keyToSeries.values()) {
    if (xs.length < 12) continue;
    const baseline = xs.slice(0, Math.min(6, xs.length));
    const targetMean = baseline.reduce((a, b) => a + b, 0) / baseline.length;

    const e = ewma(xs, 0.3);
    const last = e[e.length - 1]!;
    const cus = cusumTwoSided(xs, targetMean, 0.02, 0.2);
    const cusLast = cus[cus.length - 1]!;

    if (Math.abs(last.ewma - targetMean) > 0.15) {
      await pool.query(
        `
        INSERT INTO performance_shifts (
          tenant_id, shift_id, workflow_id, agent_id, agent_version, metric_name,
          window_a_start, window_a_end, window_b_start, window_b_end,
          method, p_value, bh_adjusted_p_value, effect_size, significant, details
        )
        VALUES (
          $1, $2::uuid, $3, $4, $5, 'run_quality_score',
          $6::timestamptz, $7::timestamptz, $6::timestamptz, $7::timestamptz,
          'ewma', NULL, NULL, $8, TRUE, $9::jsonb
        )
      `,
        [
          opts.tenantId,
          uuidv4(),
          meta.workflow_id,
          meta.agent_id,
          meta.agent_version,
          ts[0]!,
          ts[ts.length - 1]!,
          last.ewma - targetMean,
          { baseline_mean: targetMean, ewma_last: last.ewma, lambda: 0.3 }
        ]
      );
      written++;
    }

    if (cusLast.signal) {
      await pool.query(
        `
        INSERT INTO performance_shifts (
          tenant_id, shift_id, workflow_id, agent_id, agent_version, metric_name,
          window_a_start, window_a_end, window_b_start, window_b_end,
          method, p_value, bh_adjusted_p_value, effect_size, significant, details
        )
        VALUES (
          $1, $2::uuid, $3, $4, $5, 'run_quality_score',
          $6::timestamptz, $7::timestamptz, $6::timestamptz, $7::timestamptz,
          'cusum', NULL, NULL, NULL, TRUE, $8::jsonb
        )
      `,
        [
          opts.tenantId,
          uuidv4(),
          meta.workflow_id,
          meta.agent_id,
          meta.agent_version,
          ts[0]!,
          ts[ts.length - 1]!,
          { targetMean, k: 0.02, h: 0.2, pos: cusLast.pos, neg: cusLast.neg }
        ]
      );
      written++;
    }
  }

  return { tests_run: tests.length, shifts_written: written };
}


