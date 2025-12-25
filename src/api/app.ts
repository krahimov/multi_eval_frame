import Fastify, { type FastifyInstance } from "fastify";
import type pg from "pg";
import { registerEventsRoutes } from "./routes/events.js";
import { registerQueryRoutes } from "./routes/query.js";
import { registry, httpRequestDurationMs } from "../observability/metrics.js";
import { registerApiKeyAuth } from "../security/auth.js";

export interface AppDeps {
  pool: pg.Pool;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: {
        paths: ["req.headers.authorization", "req.headers.x-api-key"],
        censor: "[REDACTED]"
      }
    },
    bodyLimit: Number(process.env.MAX_BODY_BYTES ?? String(5 * 1024 * 1024))
  });

  // Observability: prometheus
  app.get(
    "/metrics",
    { config: { auth: false } },
    async (_req, reply) => {
      reply.header("Content-Type", registry.contentType);
      return registry.metrics();
    }
  );

  app.get("/healthz", { config: { auth: false } }, async () => ({ ok: true }));

  // Auth (API key) - defaults to open if EVAL_API_KEYS not set.
  registerApiKeyAuth(app);

  // HTTP metrics (route-based)
  app.addHook("onRequest", async (req) => {
    (req as any)._startHrTime = process.hrtime.bigint();
  });
  app.addHook("onResponse", async (req, reply) => {
    const start = (req as any)._startHrTime as bigint | undefined;
    if (!start) return;
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const route = req.routeOptions?.url ?? req.routerPath ?? "unknown";
    httpRequestDurationMs.labels(req.method, route, String(reply.statusCode)).observe(durationMs);
  });

  registerEventsRoutes(app, deps);
  registerQueryRoutes(app, deps);

  return app;
}


