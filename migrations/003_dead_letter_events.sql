BEGIN;

CREATE TABLE IF NOT EXISTS dead_letter_events (
  tenant_id TEXT NULL,
  dead_letter_id UUID NOT NULL,

  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL DEFAULT 'ingest_api',
  reason TEXT NOT NULL,

  idempotency_key TEXT NULL,
  payload JSONB NOT NULL,
  errors JSONB NULL,

  PRIMARY KEY (dead_letter_id)
);

CREATE INDEX IF NOT EXISTS dead_letter_events_recent_idx
  ON dead_letter_events (received_at DESC);

COMMIT;



