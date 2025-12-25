import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { v4 as uuidv4 } from "uuid";
import { v1 } from "../../contracts/index.js";
import { ingestEventsTotal } from "../../observability/metrics.js";
import { writeAudit } from "../../security/audit.js";

type IngestResponseV1 = {
  ok: true;
  schema_version: "v1";
  tenant_id: string;
  received_events: number;
  inserted_events: number;
  duplicate_events: number;
  request_idempotency_key: string | null;
};

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function getHeaderString(header: unknown): string | undefined {
  if (typeof header !== "string") return undefined;
  const trimmed = header.trim();
  return trimmed.length ? trimmed : undefined;
}

function extractBatch(body: unknown): unknown {
  // Allow either:
  // - { schema_version: 'v1', events: [...] }
  // - [...]  (interpreted as batch events)
  if (Array.isArray(body)) return { schema_version: "v1", events: body };
  return body;
}

function bestEffortTenantIdFromUnknownBatch(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const maybeEvents = (input as any).events;
  if (!Array.isArray(maybeEvents) || maybeEvents.length === 0) return null;
  const first = maybeEvents[0];
  if (!first || typeof first !== "object") return null;
  const tenant = (first as any).tenant_id;
  return typeof tenant === "string" && tenant.length ? tenant : null;
}

function getTenantIdFromBatch(batch: v1.IngestBatchV1): string {
  const first = batch.events[0];
  if (!first) throw new Error("Empty events batch");
  const tenant = first.tenant_id;
  for (const e of batch.events) {
    if (e.tenant_id !== tenant) {
      throw new Error("All events in a batch must share the same tenant_id");
    }
  }
  return tenant;
}

async function writeDeadLetter(
  pool: pg.Pool,
  tenantId: string | null,
  idempotencyKey: string | undefined,
  reason: string,
  payload: unknown,
  errors: unknown
): Promise<void> {
  const deadLetterId = uuidv4();
  await pool.query(
    `
    INSERT INTO dead_letter_events (tenant_id, dead_letter_id, reason, idempotency_key, payload, errors)
    VALUES ($1, $2::uuid, $3, $4, $5::jsonb, $6::jsonb)
  `,
    [tenantId, deadLetterId, reason, idempotencyKey ?? null, payload ?? null, errors ?? null]
  );
}

async function tryBeginIdempotentRequest(
  pool: pg.Pool,
  tenantId: string,
  idempotencyKey: string,
  requestSha: string
): Promise<
  | { kind: "new" }
  | { kind: "cached"; response_status: number; response_body: unknown }
  | { kind: "in_progress" }
  | { kind: "conflict" }
> {
  const insertRes = await pool.query<{ inserted: number }>(
    `
    WITH ins AS (
      INSERT INTO ingest_requests (tenant_id, idempotency_key, request_sha256, status)
      VALUES ($1, $2, $3, 'processing')
      ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
      RETURNING 1
    )
    SELECT COUNT(*)::int AS inserted FROM ins;
  `,
    [tenantId, idempotencyKey, requestSha]
  );

  const inserted = insertRes.rows[0]?.inserted ?? 0;
  if (inserted === 1) return { kind: "new" };

  const existingRes = await pool.query<{
    status: string;
    request_sha256: string;
    response_status: number | null;
    response_body: unknown | null;
  }>(
    `
    SELECT status, request_sha256, response_status, response_body
    FROM ingest_requests
    WHERE tenant_id = $1 AND idempotency_key = $2
  `,
    [tenantId, idempotencyKey]
  );

  const row = existingRes.rows[0];
  if (!row) return { kind: "conflict" };

  if (row.request_sha256 !== requestSha) return { kind: "conflict" };
  if (row.status === "completed" && row.response_status != null && row.response_body != null) {
    return { kind: "cached", response_status: row.response_status, response_body: row.response_body };
  }
  if (row.status === "processing") return { kind: "in_progress" };
  return { kind: "conflict" };
}

async function finalizeIdempotentRequest(
  pool: pg.Pool,
  tenantId: string,
  idempotencyKey: string,
  status: "completed" | "failed",
  responseStatus: number | null,
  responseBody: unknown | null,
  errorMessage: string | null
): Promise<void> {
  await pool.query(
    `
    UPDATE ingest_requests
    SET status = $3,
        response_status = $4,
        response_body = $5,
        error_message = $6,
        updated_at = now()
    WHERE tenant_id = $1 AND idempotency_key = $2
  `,
    [tenantId, idempotencyKey, status, responseStatus, responseBody, errorMessage]
  );
}

async function insertRawEvents(pool: pg.Pool, batch: v1.IngestBatchV1): Promise<number> {
  if (batch.events.length === 0) return 0;

  // Multi-row insert with ON CONFLICT DO NOTHING, returning only inserted rows.
  const valuesSql: string[] = [];
  const params: unknown[] = [];

  for (let i = 0; i < batch.events.length; i++) {
    const e = batch.events[i]!;
    const base = i * 6;
    valuesSql.push(`($${base + 1}, $${base + 2}::uuid, $${base + 3}, $${base + 4}, $${base + 5}::timestamptz, $${base + 6}::jsonb)`);
    params.push(e.tenant_id, e.event_id, e.schema_version, e.type, e.event_time, e as unknown as object);
  }

  const res = await pool.query<{ event_id: string }>(
    `
    INSERT INTO raw_events (tenant_id, event_id, schema_version, event_type, event_time, payload)
    VALUES ${valuesSql.join(",")}
    ON CONFLICT (tenant_id, event_id) DO NOTHING
    RETURNING event_id;
  `,
    params
  );

  return res.rowCount ?? res.rows.length;
}

export function registerEventsRoutes(app: FastifyInstance, deps: { pool: pg.Pool }): void {
  app.post("/events", async (req, reply) => {
    const idempotencyKey = getHeaderString(req.headers["idempotency-key"]);

    // Preserve the raw body as best-effort for request hashing.
    const rawBody = JSON.stringify(req.body ?? null);
    const requestSha = sha256Hex(rawBody);

    const extracted = extractBatch(req.body);
    const validated = v1.validateIngestBatchV1(extracted);
    if (!validated.ok) {
      await writeDeadLetter(
        deps.pool,
        bestEffortTenantIdFromUnknownBatch(extracted),
        idempotencyKey,
        "invalid_batch_schema",
        extracted,
        validated.errors
      );
      return reply.status(400).send({
        ok: false,
        error: "Invalid batch schema",
        schema_version: "v1",
        errors: validated.errors
      });
    }

    const batch = validated.value;
    if (batch.events.length === 0) {
      await writeDeadLetter(deps.pool, null, idempotencyKey, "empty_batch", batch, null);
      return reply.status(400).send({ ok: false, error: "Empty batch", schema_version: "v1" });
    }

    let tenantId: string;
    try {
      tenantId = getTenantIdFromBatch(batch);
    } catch (err) {
      await writeDeadLetter(deps.pool, null, idempotencyKey, "mixed_tenant_batch", batch, (err as Error).message);
      return reply.status(400).send({ ok: false, error: (err as Error).message, schema_version: "v1" });
    }

    if (idempotencyKey) {
      const idem = await tryBeginIdempotentRequest(deps.pool, tenantId, idempotencyKey, requestSha);
      if (idem.kind === "cached") return reply.status(idem.response_status).send(idem.response_body);
      if (idem.kind === "in_progress") return reply.status(202).send({ ok: true, status: "processing" });
      if (idem.kind === "conflict") {
        return reply.status(409).send({
          ok: false,
          error: "Idempotency key conflict (different request payload or failed prior run)"
        });
      }
      // else kind === "new" -> proceed
    }

    try {
      const inserted = await insertRawEvents(deps.pool, batch);
      const received = batch.events.length;
      const duplicates = received - inserted;

      ingestEventsTotal.inc({ result: "inserted" }, inserted);
      ingestEventsTotal.inc({ result: "duplicate" }, duplicates);

      const response: IngestResponseV1 = {
        ok: true,
        schema_version: "v1",
        tenant_id: tenantId,
        received_events: received,
        inserted_events: inserted,
        duplicate_events: duplicates,
        request_idempotency_key: idempotencyKey ?? null
      };

      if (idempotencyKey) {
        await finalizeIdempotentRequest(deps.pool, tenantId, idempotencyKey, "completed", 200, response, null);
      }

      try {
        await writeAudit(deps.pool, {
          tenant_id: tenantId,
          actor_type: "service",
          action: "ingest_events",
          resource_type: "raw_events_batch",
          resource_id: idempotencyKey ?? null,
          request_id: req.id,
          metadata: { received, inserted, duplicates }
        });
      } catch (auditErr) {
        req.log.warn({ err: auditErr }, "Failed to write audit log");
      }

      return reply.status(200).send(response);
    } catch (err) {
      if (idempotencyKey) {
        await finalizeIdempotentRequest(
          deps.pool,
          tenantId,
          idempotencyKey,
          "failed",
          500,
          null,
          (err as Error).message
        );
      }
      ingestEventsTotal.inc({ result: "error" }, 1);
      await writeDeadLetter(deps.pool, tenantId, idempotencyKey, "db_insert_failed", batch, (err as Error).message);
      req.log.error({ err }, "Failed to ingest events");
      return reply.status(500).send({ ok: false, error: "Internal error" });
    }
  });
}


