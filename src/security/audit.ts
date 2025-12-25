import type pg from "pg";
import { v4 as uuidv4 } from "uuid";

export interface AuditEntry {
  tenant_id: string;
  actor_type: "service" | "user" | "auto";
  actor_id?: string | null;
  action: string;
  resource_type?: string | null;
  resource_id?: string | null;
  request_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function writeAudit(pool: pg.Pool, entry: AuditEntry): Promise<void> {
  await pool.query(
    `
    INSERT INTO audit_log (
      tenant_id, audit_id,
      actor_type, actor_id,
      action, resource_type, resource_id,
      request_id, metadata
    )
    VALUES (
      $1, $2::uuid,
      $3, $4,
      $5, $6, $7,
      $8, $9::jsonb
    )
  `,
    [
      entry.tenant_id,
      uuidv4(),
      entry.actor_type,
      entry.actor_id ?? null,
      entry.action,
      entry.resource_type ?? null,
      entry.resource_id ?? null,
      entry.request_id ?? null,
      (entry.metadata ?? null) as unknown as object
    ]
  );
}


