import { getPool } from "../db/index.js";
import { runBacktest } from "../backtest/runner.js";
import { loadEnv } from "../config/loadEnv.js";

loadEnv();

const tenantId = process.env.TENANT_ID ?? "t_123";
const datasetVersion = process.env.DATASET_VERSION ?? "pit_2025-12-23";
const horizon = (process.env.HORIZON ?? "1d") as string;
const startTime = process.env.START_TIME ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
const endTime = process.env.END_TIME ?? new Date().toISOString();
const costBps = Number(process.env.COST_BPS ?? "5");
const codeVersion = process.env.CODE_VERSION ?? "local";

runBacktest(getPool(), {
  tenantId,
  datasetVersion,
  horizon,
  startTime,
  endTime,
  costBps,
  codeVersion
})
  .then((res) => {
    // eslint-disable-next-line no-console
    console.log(res);
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  });


