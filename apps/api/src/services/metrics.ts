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

// Execution Engine Metrics
export const executionLatency = new client.Histogram({
  name: 'matcha_execution_latency_seconds',
  help: 'Latency for trade execution (including fallbacks)',
  labelNames: ['source', 'fallback_used'],
  buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [metricsRegistry],
});

export const executionFallbacks = new client.Counter({
  name: 'matcha_execution_fallbacks_total',
  help: 'Number of times execution engine used fallback route',
  labelNames: ['fallback_type'],
  registers: [metricsRegistry],
});

// Strategy Selector Metrics
export const strategySwitches = new client.Counter({
  name: 'matcha_strategy_switches_total',
  help: 'Number of times strategy selector switched strategies',
  labelNames: ['from_strategy', 'to_strategy', 'regime'],
  registers: [metricsRegistry],
});

export const strategyPerformance = new client.Gauge({
  name: 'matcha_strategy_performance',
  help: 'Performance metrics per strategy type',
  labelNames: ['strategy_type', 'metric'], // metric: win_rate, sharpe, avg_return
  registers: [metricsRegistry],
});

// Adaptive Exits Metrics
export const adaptiveExitTriggers = new client.Counter({
  name: 'matcha_adaptive_exit_triggers_total',
  help: 'Number of times adaptive exits adjusted take-profit/stop-loss',
  labelNames: ['exit_type', 'adjustment_type'], // exit_type: take_profit, stop_loss; adjustment_type: trend, volatility, performance
  registers: [metricsRegistry],
});

// AI Validator Metrics
export const aiValidatorRejections = new client.Counter({
  name: 'matcha_ai_validator_rejections_total',
  help: 'Number of AI decisions rejected by validator',
  labelNames: ['reason'], // reason: low_confidence, position_size, losing_streak, daily_loss, drawdown
  registers: [metricsRegistry],
});

// Slippage Manager Metrics
export const slippageCalculations = new client.Histogram({
  name: 'matcha_slippage_bps',
  help: 'Calculated slippage tolerance in basis points',
  labelNames: ['regime', 'volatility_regime'],
  buckets: [10, 25, 50, 75, 100, 150, 200],
  registers: [metricsRegistry],
});

// Trade Execution Metrics
export const tradeExecutions = new client.Counter({
  name: 'matcha_trade_executions_total',
  help: 'Total number of trades executed',
  labelNames: ['mode', 'action', 'strategy_id'],
  registers: [metricsRegistry],
});

export const tradePerformance = new client.Gauge({
  name: 'matcha_trade_performance',
  help: 'Performance metrics for trades',
  labelNames: ['strategy_id', 'metric'], // metric: pnl, pnl_pct, slippage, fees
  registers: [metricsRegistry],
});

export async function renderPrometheusMetrics(): Promise<string> {
  return metricsRegistry.metrics();
}
