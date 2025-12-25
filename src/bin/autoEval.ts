import { getPool } from "../db/index.js";
import { runAutoEvalJob } from "../workers/autoEvalJob.js";
import { loadEnv } from "../config/loadEnv.js";

loadEnv();

const tenantId = process.env.TENANT_ID ?? "t_123";
const baselineHours = Number(process.env.BASELINE_HOURS ?? "24");
const currentHours = Number(process.env.CURRENT_HOURS ?? "6");

runAutoEvalJob(getPool(), { tenantId, baselineHours, currentHours })
  .then((res) => {
    // eslint-disable-next-line no-console
    console.log(res);
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  });


