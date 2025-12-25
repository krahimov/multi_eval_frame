BEGIN;

CREATE TABLE IF NOT EXISTS ingest_requests (
  tenant_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,

  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  request_sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing', -- processing | completed | failed

  response_status INT NULL,
  response_body JSONB NULL,
  error_message TEXT NULL,

  PRIMARY KEY (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS ingest_requests_recent_idx
  ON ingest_requests (tenant_id, received_at DESC);

COMMIT;


