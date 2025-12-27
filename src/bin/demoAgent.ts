import { loadEnv } from "../config/loadEnv.js";
import { v4 as uuidv4 } from "uuid";
import type { v1 } from "../contracts/index.js";

loadEnv();

type DemoAgentConfig = {
  baseUrl: string;
  tenantId: string;
  workflowId: string;
  prompt: string;
  useOpenAI: boolean;
};

function cfg(): DemoAgentConfig {
  const baseUrl = process.env.EVAL_BASE_URL ?? "http://127.0.0.1:3001";
  const tenantId = process.env.TENANT_ID ?? "t_123";
  const workflowId = process.env.WORKFLOW_ID ?? "geoRiskExposure";
  const prompt = process.env.PROMPT ?? "How exposed is my portfolio to semiconductors geopolitical risk?";
  const useOpenAI = Boolean(process.env.OPENAI_API_KEY);
  return { baseUrl, tenantId, workflowId, prompt, useOpenAI };
}

function iso(d: Date): string {
  return d.toISOString();
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

async function maybeCallOpenAI(prompt: string): Promise<{ output: string; citations: { doc_id: string }[] }> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return {
      output:
        "StubAgent: Portfolio semiconductor exposure is moderate; primary risk drivers are export controls and supply-chain concentration.",
      citations: [{ doc_id: "stub_doc_1" }]
    };
  }

  const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "You are a concise financial assistant. Return 3-5 bullet points." },
        { role: "user", content: prompt }
      ],
      temperature: 0.2
    })
  });

  const json = (await res.json()) as any;
  const text = json?.choices?.[0]?.message?.content ?? "No response";
  return { output: text, citations: [{ doc_id: "openai_generated" }] };
}

async function postEvents(baseUrl: string, batch: { schema_version: "v1"; events: v1.EventV1[] }): Promise<void> {
  const res = await fetch(`${baseUrl}/events`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": `demo-agent-${uuidv4()}` },
    body: JSON.stringify(batch)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`/events failed ${res.status}: ${text}`);
  // eslint-disable-next-line no-console
  console.log(text);
}

async function main(): Promise<void> {
  const c = cfg();
  const start = new Date();

  const orcId = `orc_demo_agent_${uuidv4()}`;
  const queryId = `q_demo_agent_${uuidv4()}`;
  const agentRunId = uuidv4();
  const requestTs = iso(start);

  const started: v1.OrchestrationRunStartedEventV1 = {
    schema_version: "v1",
    type: "OrchestrationRunStarted",
    event_id: uuidv4(),
    tenant_id: c.tenantId,
    orchestration_run_id: orcId,
    workflow_id: c.workflowId,
    query_id: queryId,
    request_timestamp: requestTs,
    event_time: requestTs,
    orchestration: { orchestrator_version: "demo-agent", client_id: "demo", user_id: "demo" }
  };

  const agentStarted: v1.AgentRunStartedEventV1 = {
    schema_version: "v1",
    type: "AgentRunStarted",
    event_id: uuidv4(),
    tenant_id: c.tenantId,
    orchestration_run_id: orcId,
    workflow_id: c.workflowId,
    query_id: queryId,
    request_timestamp: requestTs,
    event_time: requestTs,
    agent_run_id: agentRunId,
    agent: { agent_id: "DemoAgent", agent_version: "v1", model: c.useOpenAI ? "openai" : "stub", config_hash: "sha256:demo" }
  };

  const { output, citations } = await maybeCallOpenAI(c.prompt);
  const end = new Date();
  const latencyMs = end.getTime() - start.getTime();

  // Cheap heuristic scores for demo:
  const faithfulness = clamp01(c.useOpenAI ? 0.8 : 0.9);
  const coverage = clamp01(0.75);
  const confidence = clamp01(0.65);

  const agentCompleted: v1.AgentRunCompletedEventV1 = {
    schema_version: "v1",
    type: "AgentRunCompleted",
    event_id: uuidv4(),
    tenant_id: c.tenantId,
    orchestration_run_id: orcId,
    workflow_id: c.workflowId,
    query_id: queryId,
    request_timestamp: requestTs,
    event_time: iso(end),
    agent_run_id: agentRunId,
    agent: { agent_id: "DemoAgent", agent_version: "v1", model: c.useOpenAI ? "openai" : "stub", config_hash: "sha256:demo" },
    metrics: {
      latency_ms: latencyMs,
      faithfulness_score: faithfulness,
      hallucination_flag: false,
      coverage_score: coverage,
      confidence_score: confidence
    },
    output: {
      output_summary: output.slice(0, 280),
      citations
    }
  };

  const completed: v1.OrchestrationRunCompletedEventV1 = {
    schema_version: "v1",
    type: "OrchestrationRunCompleted",
    event_id: uuidv4(),
    tenant_id: c.tenantId,
    orchestration_run_id: orcId,
    workflow_id: c.workflowId,
    query_id: queryId,
    request_timestamp: requestTs,
    event_time: iso(end),
    orchestration: { status: "success", total_latency_ms: latencyMs }
  };

  await postEvents(c.baseUrl, { schema_version: "v1", events: [started, agentStarted, agentCompleted, completed] });

  // eslint-disable-next-line no-console
  console.log("DemoAgent run complete. Next: check /metrics/agents or /metrics/workflows.");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});


