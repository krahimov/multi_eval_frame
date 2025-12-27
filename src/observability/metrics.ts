import client from "prom-client";

export const registry = new client.Registry();

client.collectDefaultMetrics({ register: registry });

export const httpRequestDurationMs = new client.Histogram({
  name: "evalservice_http_request_duration_ms",
  help: "HTTP request duration in milliseconds",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]
});

export const ingestEventsTotal = new client.Counter({
  name: "evalservice_ingest_events_total",
  help: "Total ingested events",
  labelNames: ["result"] as const
});

registry.registerMetric(httpRequestDurationMs);
registry.registerMetric(ingestEventsTotal);



