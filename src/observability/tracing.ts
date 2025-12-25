export async function initTracing(): Promise<null | { shutdown: () => Promise<void> }> {
  if (process.env.OTEL_ENABLED !== "true") return null;

  // Dynamic imports keep tracing optional in dev/test.
  const { NodeSDK } = await import("@opentelemetry/sdk-node");
  const { getNodeAutoInstrumentations } = await import("@opentelemetry/auto-instrumentations-node");
  const { OTLPTraceExporter } = await import("@opentelemetry/exporter-trace-otlp-http");

  const exporterOpts: any = {};
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    exporterOpts.url = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  }
  const exporter = new OTLPTraceExporter(exporterOpts);

  const sdk = new NodeSDK({
    traceExporter: exporter,
    instrumentations: [getNodeAutoInstrumentations()]
  });

  await sdk.start();

  return {
    shutdown: async () => {
      await sdk.shutdown();
    }
  };
}


