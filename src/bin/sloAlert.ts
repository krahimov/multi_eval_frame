import { getPool } from "../db/index.js";
import { runSloAlertJob } from "../workers/sloAlertJob.js";
import { loadEnv } from "../config/loadEnv.js";

loadEnv();

const tenantId = process.env.TENANT_ID ?? "t_123";
const lookbackHours = Number(process.env.LOOKBACK_HOURS ?? "24");

runSloAlertJob(getPool(), { tenantId, lookbackHours })
  .then((res) => {
    // eslint-disable-next-line no-console
    console.log(res);
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  });


