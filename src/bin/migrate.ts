import { runMigrations } from "../db/migrate.js";
import { loadEnv } from "../config/loadEnv.js";

loadEnv();

runMigrations().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});


