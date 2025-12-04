import type { RiskLimits } from '@matcha-ai/shared';

export interface RiskMetrics {
  valueAtRiskPct: number;
  conditionalVaRPct: number;
}

export class RiskEngine {
  /**
   * Historical Value at Risk (returns and output are expressed in percent, e.g., 0.05 = 5%)
   */
  calculateHistoricalVaR(returns: number[], confidence = 0.95): number {
    if (returns.length === 0) return 0;
    const sorted = [...returns].sort((a, b) => a - b); // ascending
    const index = Math.max(0, Math.floor((1 - confidence) * sorted.length));
    const varReturn = sorted[index] ?? 0;
    return Math.abs(Math.min(0, varReturn));
  }

  /**
   * Conditional VaR (Expected Shortfall) on the left tail
   */
  calculateCVaR(returns: number[], confidence = 0.95): number {
    if (returns.length === 0) return 0;
    const sorted = [...returns].sort((a, b) => a - b);
    const cutoffIndex = Math.max(0, Math.floor((1 - confidence) * sorted.length));
    const tail = sorted.slice(0, cutoffIndex + 1);
    if (tail.length === 0) return 0;
    const avgLoss = tail.reduce((sum, r) => sum + r, 0) / tail.length;
    return Math.abs(Math.min(0, avgLoss));
  }

  /**
   * Monte Carlo CVaR - simulates 10k scenarios based on historical distribution
   * More robust than historical CVaR for tail risk estimation
   */
  calculateMonteCarloCVaR(returns: number[], confidence = 0.95, numSimulations = 10000): number {
    if (returns.length === 0) return 0;

    // Calculate historical mean and std dev
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) return 0;

    // Generate Monte Carlo simulations (normal distribution)
    const simulatedReturns: number[] = [];
    for (let i = 0; i < numSimulations; i++) {
      // Box-Muller transform for normal distribution
      const u1 = Math.random();
      const u2 = Math.random();
      const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      const simulatedReturn = mean + stdDev * z0;
      simulatedReturns.push(simulatedReturn);
    }

    // Calculate CVaR from simulations
    const sorted = simulatedReturns.sort((a, b) => a - b);
    const cutoffIndex = Math.max(0, Math.floor((1 - confidence) * sorted.length));
    const tail = sorted.slice(0, cutoffIndex + 1);
    if (tail.length === 0) return 0;
    const avgLoss = tail.reduce((sum, r) => sum + r, 0) / tail.length;
    return Math.abs(Math.min(0, avgLoss));
  }

  /**
   * Kelly Criterion position sizing (returns percent of equity, capped)
   */
  calculateKellyPositionPct(winRate: number, payoffRatio: number, capPct: number): number {
    if (!Number.isFinite(winRate) || winRate <= 0 || winRate >= 1) {
      return Math.min(capPct, 0);
    }
    const ratio = Math.max(payoffRatio, 0.01);
    const kellyFraction = winRate - (1 - winRate) / ratio;
    const pct = Math.max(0, kellyFraction * 100);
    return Math.min(capPct, pct);
  }

  shouldTriggerCircuitBreaker(dailyPnl: number, equity: number, circuitBreakerPct?: number): boolean {
    if (!circuitBreakerPct || circuitBreakerPct <= 0) return false;
    if (equity <= 0) return true;
    const lossPct = dailyPnl < 0 ? Math.abs(dailyPnl) / equity * 100 : 0;
    return lossPct >= circuitBreakerPct;
  }

  /**
   * Determine whether VaR/CVaR limits are violated
   */
  violatesTailRiskLimits(
    returns: number[] | undefined,
    riskLimits: RiskLimits
  ): { violated: boolean; metrics?: RiskMetrics } {
    if (!returns || returns.length === 0) {
      return { violated: false };
    }

    const confidence = riskLimits.varConfidence ?? 0.95;
    const varPct = this.calculateHistoricalVaR(returns, confidence) * 100;
    // Use Monte Carlo CVaR for more robust tail risk estimation
    const cvarPct = this.calculateMonteCarloCVaR(returns, confidence, 10000) * 100;

    if (riskLimits.maxPortfolioVaRPct && varPct > riskLimits.maxPortfolioVaRPct) {
      return {
        violated: true,
        metrics: { valueAtRiskPct: varPct, conditionalVaRPct: cvarPct },
      };
    }

    return { violated: false, metrics: { valueAtRiskPct: varPct, conditionalVaRPct: cvarPct } };
  }

  /**
   * Dynamic position sizing based on volatility
   * Reduces position size in high volatility environments
   */
  calculateVolatilityAdjustedSize(
    baseSizePct: number,
    volatility: number, // ATR or std dev as percentage
    maxVolatility: number = 0.1 // 10% = high volatility threshold
  ): number {
    if (volatility <= 0) return baseSizePct;
    
    // Reduce size proportionally to volatility
    // At maxVolatility, reduce to 50% of base size
    const volatilityRatio = Math.min(1, volatility / maxVolatility);
    const adjustment = 1 - (volatilityRatio * 0.5); // Scale down by up to 50%
    
    return Math.max(0, baseSizePct * adjustment);
  }

  /**
   * Calculate correlation between two return series
   * Returns correlation coefficient (-1 to 1)
   */
  calculateCorrelation(returns1: number[], returns2: number[]): number {
    if (returns1.length !== returns2.length || returns1.length === 0) {
      return 0;
    }

    const mean1 = returns1.reduce((a, b) => a + b, 0) / returns1.length;
    const mean2 = returns2.reduce((a, b) => a + b, 0) / returns2.length;

    let numerator = 0;
    let sumSq1 = 0;
    let sumSq2 = 0;

    for (let i = 0; i < returns1.length; i++) {
      const diff1 = returns1[i] - mean1;
      const diff2 = returns2[i] - mean2;
      numerator += diff1 * diff2;
      sumSq1 += diff1 * diff1;
      sumSq2 += diff2 * diff2;
    }

    const denominator = Math.sqrt(sumSq1 * sumSq2);
    if (denominator === 0) return 0;

    return numerator / denominator;
  }

  /**
   * Circuit breaker for extreme market conditions
   * Triggers when multiple risk metrics exceed thresholds
   */
  checkCircuitBreaker(
    dailyPnl: number,
    equity: number,
    maxDrawdown: number,
    volatility: number,
    circuitBreakerPct?: number,
    maxDrawdownThreshold: number = 15, // 15% max drawdown
    volatilityThreshold: number = 0.15 // 15% volatility
  ): { triggered: boolean; reason?: string } {
    // Check daily loss limit
    if (circuitBreakerPct) {
      const lossPct = dailyPnl < 0 ? Math.abs(dailyPnl) / equity * 100 : 0;
      if (lossPct >= circuitBreakerPct) {
        return { triggered: true, reason: `Daily loss limit exceeded: ${lossPct.toFixed(2)}%` };
      }
    }

    // Check max drawdown
    if (maxDrawdown >= maxDrawdownThreshold) {
      return { triggered: true, reason: `Max drawdown exceeded: ${maxDrawdown.toFixed(2)}%` };
    }

    // Check extreme volatility
    if (volatility >= volatilityThreshold) {
      return { triggered: true, reason: `Extreme volatility detected: ${(volatility * 100).toFixed(2)}%` };
    }

    return { triggered: false };
  }
}

export const riskEngine = new RiskEngine();
