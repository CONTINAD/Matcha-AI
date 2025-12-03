import type { RiskLimits, Trade, Position } from '@matcha-ai/shared';
import { logger } from '../config/logger';
import { riskEngine } from './riskEngine';
import { riskRejectionsCounter } from './metrics';

export interface RiskCheckParams {
  equity: number;
  dailyPnl: number;
  proposedTrade: {
    side: 'BUY' | 'SELL';
    size: number;
    price: number;
  };
  currentPositions: Position[];
  riskLimits: RiskLimits;
  recentReturns?: number[]; // decimal returns, e.g. 0.01 for 1%
  maxDrawdownPct?: number;
}

export interface RiskDecisionResult {
  allowed: boolean;
  reason?: string;
  adjustedSize?: number; // If size was clamped
  metrics?: {
    positionPct: number;
    totalExposurePct: number;
    leverage?: number;
    dailyLossPct: number;
  };
}

export class RiskManager {
  /**
   * Check if a trade should be taken based on risk limits
   */
  shouldTakeTrade(params: RiskCheckParams): boolean {
    const { equity, dailyPnl, proposedTrade, currentPositions, riskLimits } = params;

    // Circuit breaker on intraday drawdowns
    if (riskEngine.shouldTriggerCircuitBreaker(dailyPnl, equity, riskLimits.circuitBreakerPct)) {
      logger.warn(
        { dailyPnl, equity, circuitBreakerPct: riskLimits.circuitBreakerPct },
        'Circuit breaker triggered'
      );
      riskRejectionsCounter.inc({ reason: 'circuit_breaker' });
      return false;
    }

    // Check daily loss limit
    const dailyLossPct = dailyPnl < 0 ? Math.abs(dailyPnl) / equity : 0;
    if (dailyLossPct >= riskLimits.maxDailyLossPct / 100) {
      logger.warn({ dailyLossPct, maxDailyLossPct: riskLimits.maxDailyLossPct }, 'Daily loss limit exceeded');
      riskRejectionsCounter.inc({ reason: 'daily_loss' });
      return false;
    }

    // Check position size limit
    const positionValue = proposedTrade.size * proposedTrade.price;
    const positionPct = (positionValue / equity) * 100;
    if (positionPct > riskLimits.maxPositionPct) {
      logger.warn({ positionPct, maxPositionPct: riskLimits.maxPositionPct }, 'Position size exceeds limit');
      riskRejectionsCounter.inc({ reason: 'position_size' });
      return false;
    }

    // Check total exposure across all positions
    const totalExposure = currentPositions.reduce((sum, pos) => sum + pos.size * pos.entryPrice, 0);
    const newTotalExposure = totalExposure + positionValue;
    const totalExposurePct = (newTotalExposure / equity) * 100;
    if (totalExposurePct > riskLimits.maxPositionPct * 2) {
      // Allow up to 2x max position for multiple positions
      logger.warn({ totalExposurePct }, 'Total exposure exceeds limit');
      riskRejectionsCounter.inc({ reason: 'exposure' });
      return false;
    }

    // Check leverage if specified
    if (riskLimits.maxLeverage) {
      const leverage = newTotalExposure / equity;
      if (leverage > riskLimits.maxLeverage) {
        logger.warn({ leverage, maxLeverage: riskLimits.maxLeverage }, 'Leverage exceeds limit');
        riskRejectionsCounter.inc({ reason: 'leverage' });
        return false;
      }
    }

    // Max drawdown guard
    if (riskLimits.maxDrawdownPct && params.maxDrawdownPct && params.maxDrawdownPct > riskLimits.maxDrawdownPct) {
      logger.warn(
        { maxDrawdownPct: params.maxDrawdownPct, limit: riskLimits.maxDrawdownPct },
        'Max drawdown limit exceeded'
      );
      riskRejectionsCounter.inc({ reason: 'drawdown' });
      return false;
    }

    // Tail-risk guard (VaR / CVaR)
    if (riskLimits.maxPortfolioVaRPct) {
      const tailRisk = riskEngine.violatesTailRiskLimits(params.recentReturns, riskLimits);
      if (tailRisk.violated) {
        logger.warn(
          { valueAtRiskPct: tailRisk.metrics?.valueAtRiskPct, limit: riskLimits.maxPortfolioVaRPct },
          'VaR limit exceeded'
        );
        riskRejectionsCounter.inc({ reason: 'var' });
        return false;
      }
    }

    return true;
  }

  /**
   * Clamp position size to risk limits
   */
  clampPositionSize(targetPct: number, equity: number, price: number, riskLimits: RiskLimits): number {
    const maxPct = Math.min(targetPct, riskLimits.maxPositionPct);
    const maxValue = (equity * maxPct) / 100;
    const maxSize = maxValue / price;
    return maxSize;
  }

  /**
   * Calculate position size from percentage
   * Optimized for small accounts (minimum trade size considerations)
   * For $5 accounts: ensures minimum $0.50 trades to cover fees
   */
  calculatePositionSize(positionPct: number, equity: number, price: number, kellyCapPct?: number): number {
    const pctToUse = kellyCapPct !== undefined ? Math.min(positionPct, kellyCapPct) : positionPct;
    
    // For very small accounts (< $100), optimize for fee efficiency
    let adjustedPct = pctToUse;
    if (equity < 100) {
      // For small accounts, ensure trades are large enough to cover fees
      // Minimum $0.50 trade for $5 account (10% of equity)
      const minTradePct = equity < 10 ? 10 : 5; // 10% for <$10, 5% for <$100
      adjustedPct = Math.max(pctToUse, minTradePct);
      adjustedPct = Math.min(adjustedPct, 20); // Cap at 20% for safety
    }
    
    const value = (equity * adjustedPct) / 100;
    const size = value / price;
    
    // Ensure minimum trade size (at least $0.50 worth for small accounts)
    // This ensures fees don't eat up the trade
    const minTradeValue = equity < 100 ? 0.5 : 0; // $0.50 minimum for small accounts
    const minSize = minTradeValue > 0 ? minTradeValue / price : 0;
    
    return Math.max(minSize, size);
  }

  /**
   * Kelly-based sizing cap (percent of equity)
   */
  calculateKellyPositionPct(winRate: number, payoffRatio: number, maxPositionPct: number): number {
    return riskEngine.calculateKellyPositionPct(winRate, payoffRatio, maxPositionPct);
  }

  /**
   * Check if daily loss limit is exceeded
   */
  isDailyLossLimitExceeded(dailyPnl: number, equity: number, maxDailyLossPct: number): boolean {
    if (dailyPnl >= 0) return false;
    const lossPct = Math.abs(dailyPnl) / equity;
    return lossPct >= maxDailyLossPct / 100;
  }

  /**
   * Unified risk evaluation for proposed trades
   * Returns structured result with metrics and adjusted size if needed
   */
  evaluateProposedTrade(params: RiskCheckParams): RiskDecisionResult {
    const { equity, dailyPnl, proposedTrade, currentPositions, riskLimits } = params;
    
    const positionValue = proposedTrade.size * proposedTrade.price;
    const positionPct = (positionValue / equity) * 100;
    const totalExposure = currentPositions.reduce((sum, pos) => sum + pos.size * pos.entryPrice, 0);
    const newTotalExposure = totalExposure + positionValue;
    const totalExposurePct = (newTotalExposure / equity) * 100;
    const dailyLossPct = dailyPnl < 0 ? Math.abs(dailyPnl) / equity : 0;
    const leverage = riskLimits.maxLeverage ? newTotalExposure / equity : undefined;

    const metrics = {
      positionPct,
      totalExposurePct,
      leverage,
      dailyLossPct,
    };

    // Check all risk limits
    if (!this.shouldTakeTrade(params)) {
      // Find the specific reason
      let reason = 'risk_limit_exceeded';
      if (riskEngine.shouldTriggerCircuitBreaker(dailyPnl, equity, riskLimits.circuitBreakerPct)) {
        reason = 'circuit_breaker';
      } else if (dailyLossPct >= riskLimits.maxDailyLossPct / 100) {
        reason = 'daily_loss_limit';
      } else if (positionPct > riskLimits.maxPositionPct) {
        reason = 'position_size_limit';
      } else if (totalExposurePct > riskLimits.maxPositionPct * 2) {
        reason = 'total_exposure_limit';
      } else if (leverage && leverage > riskLimits.maxLeverage) {
        reason = 'leverage_limit';
      } else if (riskLimits.maxDrawdownPct && params.maxDrawdownPct && params.maxDrawdownPct > riskLimits.maxDrawdownPct) {
        reason = 'drawdown_limit';
      } else if (riskLimits.maxPortfolioVaRPct) {
        const tailRisk = riskEngine.violatesTailRiskLimits(params.recentReturns, riskLimits);
        if (tailRisk.violated) {
          reason = 'var_limit';
        }
      }

      return {
        allowed: false,
        reason,
        metrics,
      };
    }

    // Trade is allowed, but may need size adjustment
    let adjustedSize = proposedTrade.size;
    if (positionPct > riskLimits.maxPositionPct * 0.95) {
      // Clamp to 95% of max to avoid edge cases
      const maxValue = (equity * riskLimits.maxPositionPct * 0.95) / 100;
      adjustedSize = maxValue / proposedTrade.price;
    }

    return {
      allowed: true,
      adjustedSize: adjustedSize !== proposedTrade.size ? adjustedSize : undefined,
      metrics,
    };
  }

  /**
   * Check if trading should stop for the day (daily loss limit hit)
   * Returns true if trading should be paused for the rest of the day
   */
  shouldStopForTheDay(dailyPnl: number, equity: number, maxDailyLossPct: number): boolean {
    return this.isDailyLossLimitExceeded(dailyPnl, equity, maxDailyLossPct);
  }
}

export const riskManager = new RiskManager();
