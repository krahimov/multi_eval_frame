import { getPool } from "../db/index.js";
import { runSignificanceJob } from "../workers/significanceJob.js";
import { loadEnv } from "../config/loadEnv.js";

loadEnv();

const tenantId = process.env.TENANT_ID ?? "t_123";
const metric = (process.env.SIGNIFICANCE_METRIC ?? "run_quality_score") as "run_quality_score" | "faithfulness_score";
const windowHours = Number(process.env.WINDOW_HOURS ?? "72");
const alpha = Number(process.env.ALPHA ?? "0.05");

runSignificanceJob(getPool(), { tenantId, metric, windowHours, alpha })
  .then((res) => {
    // eslint-disable-next-line no-console
    console.log(res);
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  });


