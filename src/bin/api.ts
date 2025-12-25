import { buildApp } from "../api/app.js";
import { getPool } from "../db/index.js";
import { initTracing } from "../observability/tracing.js";
import { loadEnv } from "../config/loadEnv.js";

const port = Number(process.env.PORT ?? "3001");
const host = process.env.HOST ?? "0.0.0.0";

async function main(): Promise<void> {
  loadEnv();
  const tracing = await initTracing();
  const app = buildApp({ pool: getPool() });

  await app.listen({ port, host });
  app.log.info({ host, port }, "Eval service listening");

  const shutdown = async () => {
    try {
      await app.close();
    } finally {
      await tracing?.shutdown();
      process.exit(0);
    }
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});


