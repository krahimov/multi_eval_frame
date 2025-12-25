export type SchemaVersionV1 = "v1";

export type IsoDateTimeString = string;

export type UUIDString = string;

export type EventTypeV1 =
  | "OrchestrationRunStarted"
  | "OrchestrationRunCompleted"
  | "AgentRunStarted"
  | "AgentRunCompleted"
  | "RetrievalContextAttached"
  | "SignalEmitted"
  | "MarketOutcomeIngested";

export interface BaseEventV1 {
  schema_version: SchemaVersionV1;
  type: EventTypeV1;
  event_id: UUIDString;

  tenant_id: string;
  orchestration_run_id: string;
  workflow_id: string;
  query_id: string;
  request_timestamp: IsoDateTimeString;

  event_time: IsoDateTimeString;
}

export interface AgentIdentityV1 {
  agent_id: string;
  agent_version: string;
  model?: string;
  config_hash?: string;
}

export interface CitationV1 {
  doc_id: string;
  chunk_id?: string;
  quote_hash?: string;
  score?: number;
  source?: string;
}

export interface OrchestrationRunStartedEventV1 extends BaseEventV1 {
  type: "OrchestrationRunStarted";
  orchestration: {
    orchestrator_version?: string;
    client_id?: string;
    user_id?: string;
  };
}

export interface OrchestrationRunCompletedEventV1 extends BaseEventV1 {
  type: "OrchestrationRunCompleted";
  orchestration: {
    status: "success" | "error";
    total_latency_ms?: number;
    error_code?: string;
    error_message?: string;
  };
}

export interface AgentRunStartedEventV1 extends BaseEventV1 {
  type: "AgentRunStarted";
  agent_run_id: UUIDString;
  agent: AgentIdentityV1;
  parent_agent_run_id?: UUIDString;
}

export interface AgentRunCompletedEventV1 extends BaseEventV1 {
  type: "AgentRunCompleted";
  agent_run_id: UUIDString;
  agent: AgentIdentityV1;
  metrics: {
    latency_ms: number;
    faithfulness_score?: number;
    hallucination_flag?: boolean;
    coverage_score?: number;
    confidence_score?: number;
  };
  output: {
    output_summary: string;
    citations?: CitationV1[];
    output_uri?: string;
  };
}

export interface RetrievalContextAttachedEventV1 extends BaseEventV1 {
  type: "RetrievalContextAttached";
  agent_run_id: UUIDString;
  retrieval: {
    citations: CitationV1[];
    retrieval_uri?: string;
  };
}

export interface SignalEmittedEventV1 extends BaseEventV1 {
  type: "SignalEmitted";
  signal_id: UUIDString;
  agent?: AgentIdentityV1;
  signal: {
    prediction_type: string;
    horizon: "1d" | "1w" | "1m" | "3m" | "6m" | "1y" | string;
    instrument_universe: { instrument_id: string; weight?: number }[];
    signal_value:
      | { kind: "scalar"; value: number }
      | { kind: "vector"; values: { instrument_id: string; value: number }[] }
      | { kind: "text"; value: string };
    confidence?: number;
    constraints?: Record<string, unknown>;
  };
}

export interface MarketOutcomeIngestedEventV1 extends BaseEventV1 {
  type: "MarketOutcomeIngested";
  dataset_version: string;
  instrument_id: string;
  asof_time: IsoDateTimeString;
  market: {
    price?: number;
    return?: number;
    benchmark_return?: number;
    volatility?: number;
    meta?: Record<string, unknown>;
  };
}

export type EventV1 =
  | OrchestrationRunStartedEventV1
  | OrchestrationRunCompletedEventV1
  | AgentRunStartedEventV1
  | AgentRunCompletedEventV1
  | RetrievalContextAttachedEventV1
  | SignalEmittedEventV1
  | MarketOutcomeIngestedEventV1;

export interface IngestBatchV1 {
  schema_version: SchemaVersionV1;
  events: EventV1[];
}


