import client from 'prom-client';
import { config } from '../config/env';

export const metricsRegistry = new client.Registry();
export const metricsEnabled = config.observability.enableMetrics;

if (metricsEnabled) {
  client.collectDefaultMetrics({
    register: metricsRegistry,
    prefix: 'matcha_',
  });
}

export const dataProviderLatency = new client.Histogram({
  name: 'matcha_data_provider_latency_seconds',
  help: 'Latency for external data providers',
  labelNames: ['provider', 'type'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [metricsRegistry],
});

export const dataProviderErrors = new client.Counter({
  name: 'matcha_data_provider_errors_total',
  help: 'Failures when calling external data providers',
  labelNames: ['provider', 'type'],
  registers: [metricsRegistry],
});

export const riskRejectionsCounter = new client.Counter({
  name: 'matcha_risk_rejections_total',
  help: 'Trade rejections by risk engine',
  labelNames: ['reason'],
  registers: [metricsRegistry],
});

export const decisionLatency = new client.Histogram({
  name: 'matcha_decision_latency_seconds',
  help: 'Latency for AI decision generation',
  labelNames: ['mode'],
  buckets: [0.25, 0.5, 1, 2, 4, 8, 12, 20],
  registers: [metricsRegistry],
});

export async function renderPrometheusMetrics(): Promise<string> {
  return metricsRegistry.metrics();
}
