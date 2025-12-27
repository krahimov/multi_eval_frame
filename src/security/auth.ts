import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

function parseApiKeys(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function getApiKey(req: FastifyRequest): string | undefined {
  const header = req.headers["x-api-key"];
  if (typeof header !== "string") return undefined;
  const trimmed = header.trim();
  return trimmed.length ? trimmed : undefined;
}

function isPublicRoute(req: FastifyRequest): boolean {
  // Route options can set `config: { auth: false }`
  const cfg = (req.routeOptions as any)?.config;
  return cfg?.auth === false;
}

export function registerApiKeyAuth(app: FastifyInstance): void {
  const keys = parseApiKeys(process.env.EVAL_API_KEYS);
  const authEnabled = keys.size > 0;

  app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    if (isPublicRoute(req)) return;
    if (!authEnabled) return; // dev default: open

    const key = getApiKey(req);
    if (!key || !keys.has(key)) {
      return reply.status(401).send({ ok: false, error: "Unauthorized" });
    }
  });
}



