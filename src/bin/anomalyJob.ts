import { loadEnv } from "../config/loadEnv.js";
import { getPool } from "../db/index.js";
import { runAnomalyJob } from "../workers/anomalyJob.js";

loadEnv();

const tenantId = process.env.TENANT_ID ?? "t_123";
const lookbackHours = Number(process.env.LOOKBACK_HOURS ?? "6");
const minHistory = Number(process.env.MIN_HISTORY ?? "30");
const perGroupLimit = Number(process.env.PER_GROUP_LIMIT ?? "200");

runAnomalyJob(getPool(), { tenantId, lookbackHours, minHistory, perGroupLimit })
  .then((res) => {
    // eslint-disable-next-line no-console
    console.log(res);
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  });


