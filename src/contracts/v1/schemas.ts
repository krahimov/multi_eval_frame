import type { JSONSchemaType } from "ajv";
import type { EventV1 } from "./events.js";

const isoDateTime: JSONSchemaType<string> = { type: "string", format: "date-time" };

const uuid: JSONSchemaType<string> = { type: "string", format: "uuid" };

const agentIdentity = {
  type: "object",
  properties: {
    agent_id: { type: "string" },
    agent_version: { type: "string" },
    model: { type: "string", nullable: true },
    config_hash: { type: "string", nullable: true }
  },
  required: ["agent_id", "agent_version"],
  additionalProperties: false
} as const;

const citation = {
  type: "object",
  properties: {
    doc_id: { type: "string" },
    chunk_id: { type: "string", nullable: true },
    quote_hash: { type: "string", nullable: true },
    score: { type: "number", nullable: true },
    source: { type: "string", nullable: true }
  },
  required: ["doc_id"],
  additionalProperties: false
} as const;

const baseEventProperties = {
  schema_version: { const: "v1" },
  type: { type: "string" },
  event_id: uuid,
  tenant_id: { type: "string" },
  orchestration_run_id: { type: "string" },
  workflow_id: { type: "string" },
  query_id: { type: "string" },
  request_timestamp: isoDateTime,
  event_time: isoDateTime
} as const;

export const OrchestrationRunStartedEventV1Schema = {
  $id: "OrchestrationRunStartedEventV1",
  type: "object",
  properties: {
    ...baseEventProperties,
    type: { const: "OrchestrationRunStarted" },
    orchestration: {
      type: "object",
      properties: {
        orchestrator_version: { type: "string", nullable: true },
        client_id: { type: "string", nullable: true },
        user_id: { type: "string", nullable: true }
      },
      required: [],
      additionalProperties: false
    }
  },
  required: [
    "schema_version",
    "type",
    "event_id",
    "tenant_id",
    "orchestration_run_id",
    "workflow_id",
    "query_id",
    "request_timestamp",
    "event_time",
    "orchestration"
  ],
  additionalProperties: false
} as const;

export const OrchestrationRunCompletedEventV1Schema = {
  $id: "OrchestrationRunCompletedEventV1",
  type: "object",
  properties: {
    ...baseEventProperties,
    type: { const: "OrchestrationRunCompleted" },
    orchestration: {
      type: "object",
      properties: {
        status: { enum: ["success", "error"] },
        total_latency_ms: { type: "number", nullable: true },
        error_code: { type: "string", nullable: true },
        error_message: { type: "string", nullable: true }
      },
      required: ["status"],
      additionalProperties: false
    }
  },
  required: [
    "schema_version",
    "type",
    "event_id",
    "tenant_id",
    "orchestration_run_id",
    "workflow_id",
    "query_id",
    "request_timestamp",
    "event_time",
    "orchestration"
  ],
  additionalProperties: false
} as const;

export const AgentRunStartedEventV1Schema = {
  $id: "AgentRunStartedEventV1",
  type: "object",
  properties: {
    ...baseEventProperties,
    type: { const: "AgentRunStarted" },
    agent_run_id: uuid,
    agent: agentIdentity,
    parent_agent_run_id: { ...uuid, nullable: true }
  },
  required: [
    "schema_version",
    "type",
    "event_id",
    "tenant_id",
    "orchestration_run_id",
    "workflow_id",
    "query_id",
    "request_timestamp",
    "event_time",
    "agent_run_id",
    "agent"
  ],
  additionalProperties: false
} as const;

export const AgentRunCompletedEventV1Schema = {
  $id: "AgentRunCompletedEventV1",
  type: "object",
  properties: {
    ...baseEventProperties,
    type: { const: "AgentRunCompleted" },
    agent_run_id: uuid,
    agent: agentIdentity,
    metrics: {
      type: "object",
      properties: {
        latency_ms: { type: "number" },
        faithfulness_score: { type: "number", nullable: true, minimum: 0, maximum: 1 },
        hallucination_flag: { type: "boolean", nullable: true },
        coverage_score: { type: "number", nullable: true, minimum: 0, maximum: 1 },
        confidence_score: { type: "number", nullable: true, minimum: 0, maximum: 1 }
      },
      required: ["latency_ms"],
      additionalProperties: false
    },
    output: {
      type: "object",
      properties: {
        output_summary: { type: "string" },
        citations: { type: "array", items: citation, nullable: true },
        output_uri: { type: "string", nullable: true }
      },
      required: ["output_summary"],
      additionalProperties: false
    }
  },
  required: [
    "schema_version",
    "type",
    "event_id",
    "tenant_id",
    "orchestration_run_id",
    "workflow_id",
    "query_id",
    "request_timestamp",
    "event_time",
    "agent_run_id",
    "agent",
    "metrics",
    "output"
  ],
  additionalProperties: false
} as const;

export const RetrievalContextAttachedEventV1Schema = {
  $id: "RetrievalContextAttachedEventV1",
  type: "object",
  properties: {
    ...baseEventProperties,
    type: { const: "RetrievalContextAttached" },
    agent_run_id: uuid,
    retrieval: {
      type: "object",
      properties: {
        citations: { type: "array", items: citation },
        retrieval_uri: { type: "string", nullable: true }
      },
      required: ["citations"],
      additionalProperties: false
    }
  },
  required: [
    "schema_version",
    "type",
    "event_id",
    "tenant_id",
    "orchestration_run_id",
    "workflow_id",
    "query_id",
    "request_timestamp",
    "event_time",
    "agent_run_id",
    "retrieval"
  ],
  additionalProperties: false
} as const;

export const SignalEmittedEventV1Schema = {
  $id: "SignalEmittedEventV1",
  type: "object",
  properties: {
    ...baseEventProperties,
    type: { const: "SignalEmitted" },
    signal_id: uuid,
    agent: { ...agentIdentity, nullable: true },
    signal: {
      type: "object",
      properties: {
        prediction_type: { type: "string" },
        horizon: { type: "string" },
        instrument_universe: {
          type: "array",
          items: {
            type: "object",
            properties: {
              instrument_id: { type: "string" },
              weight: { type: "number", nullable: true }
            },
            required: ["instrument_id"],
            additionalProperties: false
          }
        },
        signal_value: {
          oneOf: [
            {
              type: "object",
              properties: { kind: { const: "scalar" }, value: { type: "number" } },
              required: ["kind", "value"],
              additionalProperties: false
            },
            {
              type: "object",
              properties: {
                kind: { const: "vector" },
                values: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { instrument_id: { type: "string" }, value: { type: "number" } },
                    required: ["instrument_id", "value"],
                    additionalProperties: false
                  }
                }
              },
              required: ["kind", "values"],
              additionalProperties: false
            },
            {
              type: "object",
              properties: { kind: { const: "text" }, value: { type: "string" } },
              required: ["kind", "value"],
              additionalProperties: false
            }
          ]
        },
        confidence: { type: "number", nullable: true, minimum: 0, maximum: 1 },
        constraints: { type: "object", nullable: true, additionalProperties: true }
      },
      required: ["prediction_type", "horizon", "instrument_universe", "signal_value"],
      additionalProperties: false
    }
  },
  required: [
    "schema_version",
    "type",
    "event_id",
    "tenant_id",
    "orchestration_run_id",
    "workflow_id",
    "query_id",
    "request_timestamp",
    "event_time",
    "signal_id",
    "signal"
  ],
  additionalProperties: false
} as const;

export const MarketOutcomeIngestedEventV1Schema = {
  $id: "MarketOutcomeIngestedEventV1",
  type: "object",
  properties: {
    ...baseEventProperties,
    type: { const: "MarketOutcomeIngested" },
    dataset_version: { type: "string" },
    instrument_id: { type: "string" },
    asof_time: isoDateTime,
    market: {
      type: "object",
      properties: {
        price: { type: "number", nullable: true },
        return: { type: "number", nullable: true },
        benchmark_return: { type: "number", nullable: true },
        volatility: { type: "number", nullable: true },
        meta: { type: "object", nullable: true, additionalProperties: true }
      },
      required: [],
      additionalProperties: false
    }
  },
  required: [
    "schema_version",
    "type",
    "event_id",
    "tenant_id",
    "orchestration_run_id",
    "workflow_id",
    "query_id",
    "request_timestamp",
    "event_time",
    "dataset_version",
    "instrument_id",
    "asof_time",
    "market"
  ],
  additionalProperties: false
} as const;

export const EventV1Schema: JSONSchemaType<EventV1> = {
  $id: "EventV1",
  oneOf: [
    OrchestrationRunStartedEventV1Schema as any,
    OrchestrationRunCompletedEventV1Schema as any,
    AgentRunStartedEventV1Schema as any,
    AgentRunCompletedEventV1Schema as any,
    RetrievalContextAttachedEventV1Schema as any,
    SignalEmittedEventV1Schema as any,
    MarketOutcomeIngestedEventV1Schema as any
  ]
} as any;

export const IngestBatchV1Schema = {
  $id: "IngestBatchV1",
  type: "object",
  properties: {
    schema_version: { type: "string", const: "v1" },
    events: { type: "array", items: EventV1Schema }
  },
  required: ["schema_version", "events"],
  additionalProperties: false
} as const;


