import { getPool } from "../db/index.js";
import { runRealtimeWorkerLoop } from "../workers/realtimeWorker.js";
import { loadEnv } from "../config/loadEnv.js";

loadEnv();

process.on("uncaughtException", (err) => {
  // eslint-disable-next-line no-console
  console.error("uncaughtException", err);
});
process.on("unhandledRejection", (err) => {
  // eslint-disable-next-line no-console
  console.error("unhandledRejection", err);
});

runRealtimeWorkerLoop(getPool()).catch((err) => {
  // eslint-disable-next-line no-console
  console.error("worker_fatal", err);
  process.exitCode = 1;
});


