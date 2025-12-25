import { getPool } from "../db/index.js";
import { runRealtimeWorkerLoop } from "../workers/realtimeWorker.js";
import { loadEnv } from "../config/loadEnv.js";

loadEnv();

runRealtimeWorkerLoop(getPool()).catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});


