import AjvPkg, { type ErrorObject, type ValidateFunction } from "ajv";
import addFormatsPkg from "ajv-formats";
import type { EventV1, IngestBatchV1 } from "./events.js";
import {
  AgentRunCompletedEventV1Schema,
  AgentRunStartedEventV1Schema,
  EventV1Schema,
  IngestBatchV1Schema,
  MarketOutcomeIngestedEventV1Schema,
  OrchestrationRunCompletedEventV1Schema,
  OrchestrationRunStartedEventV1Schema,
  RetrievalContextAttachedEventV1Schema,
  SignalEmittedEventV1Schema
} from "./schemas.js";

export type ValidateOk<T> = { ok: true; value: T };
export type ValidateErr = { ok: false; errors: ErrorObject[] };

function buildAjv(): any {
  const AjvCtor: any = (AjvPkg as any).default ?? AjvPkg;
  const addFormats: any = (addFormatsPkg as any).default ?? addFormatsPkg;

  const ajv = new AjvCtor({
    allErrors: true,
    strict: true,
    allowUnionTypes: true,
    // We intentionally omit `$schema` in our schema objects to avoid depending on
    // external meta-schema URLs at runtime.
    validateSchema: true
  });

  addFormats(ajv);

  // Register referenced schemas to keep error messages readable and
  // allow `$id` resolution.
  ajv.addSchema(OrchestrationRunStartedEventV1Schema);
  ajv.addSchema(OrchestrationRunCompletedEventV1Schema);
  ajv.addSchema(AgentRunStartedEventV1Schema);
  ajv.addSchema(AgentRunCompletedEventV1Schema);
  ajv.addSchema(RetrievalContextAttachedEventV1Schema);
  ajv.addSchema(SignalEmittedEventV1Schema);
  ajv.addSchema(MarketOutcomeIngestedEventV1Schema);
  ajv.addSchema(EventV1Schema);
  ajv.addSchema(IngestBatchV1Schema);

  return ajv;
}

const ajvSingleton = buildAjv();

const validateEventFn = ajvSingleton.getSchema("EventV1") as ValidateFunction<EventV1>;
const validateBatchFn = ajvSingleton.getSchema("IngestBatchV1") as ValidateFunction<IngestBatchV1>;

export function validateEventV1(input: unknown): ValidateOk<EventV1> | ValidateErr {
  if (validateEventFn(input)) return { ok: true, value: input };
  return { ok: false, errors: validateEventFn.errors ?? [] };
}

export function validateIngestBatchV1(input: unknown): ValidateOk<IngestBatchV1> | ValidateErr {
  if (validateBatchFn(input)) return { ok: true, value: input };
  return { ok: false, errors: validateBatchFn.errors ?? [] };
}


