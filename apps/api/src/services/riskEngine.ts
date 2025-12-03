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
    const cvarPct = this.calculateCVaR(returns, confidence) * 100;

    if (riskLimits.maxPortfolioVaRPct && varPct > riskLimits.maxPortfolioVaRPct) {
      return {
        violated: true,
        metrics: { valueAtRiskPct: varPct, conditionalVaRPct: cvarPct },
      };
    }

    return { violated: false, metrics: { valueAtRiskPct: varPct, conditionalVaRPct: cvarPct } };
  }
}

export const riskEngine = new RiskEngine();
