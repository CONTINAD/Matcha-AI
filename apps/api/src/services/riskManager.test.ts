import { RiskManager } from './riskManager';
import type { RiskLimits } from '@matcha-ai/shared';

describe('RiskManager', () => {
  const riskManager = new RiskManager();
  const riskLimits: RiskLimits = {
    maxPositionPct: 10,
    maxDailyLossPct: 5,
    maxLeverage: 2,
  };

  describe('shouldTakeTrade', () => {
    it('should allow trade within limits', () => {
      const result = riskManager.shouldTakeTrade({
        equity: 10000,
        dailyPnl: 0,
        proposedTrade: {
          side: 'BUY',
          size: 100,
          price: 100,
        },
        currentPositions: [],
        riskLimits,
      });

      expect(result).toBe(true);
    });

    it('should reject trade exceeding position size', () => {
      const result = riskManager.shouldTakeTrade({
        equity: 10000,
        dailyPnl: 0,
        proposedTrade: {
          side: 'BUY',
          size: 2000, // 20% of equity
          price: 100,
        },
        currentPositions: [],
        riskLimits,
      });

      expect(result).toBe(false);
    });

    it('should reject trade when daily loss limit exceeded', () => {
      const result = riskManager.shouldTakeTrade({
        equity: 10000,
        dailyPnl: -600, // 6% loss
        proposedTrade: {
          side: 'BUY',
          size: 100,
          price: 100,
        },
        currentPositions: [],
        riskLimits,
      });

      expect(result).toBe(false);
    });
  });

  describe('advanced risk checks', () => {
    it('should reject trade when circuit breaker is hit', () => {
      const result = riskManager.shouldTakeTrade({
        equity: 10000,
        dailyPnl: -1500, // 15% loss
        proposedTrade: {
          side: 'BUY',
          size: 50,
          price: 100,
        },
        currentPositions: [],
        riskLimits: { ...riskLimits, circuitBreakerPct: 10 },
      });

      expect(result).toBe(false);
    });

    it('should reject trade when VaR exceeds limit', () => {
      const result = riskManager.shouldTakeTrade({
        equity: 10000,
        dailyPnl: 0,
        proposedTrade: {
          side: 'BUY',
          size: 50,
          price: 100,
        },
        currentPositions: [],
        riskLimits: { ...riskLimits, maxPortfolioVaRPct: 5, varConfidence: 0.95 },
        recentReturns: [-0.12, -0.08, -0.09, 0.03], // heavy tail losses
      });

      expect(result).toBe(false);
    });
  });

  describe('clampPositionSize', () => {
    it('should clamp to max position size', () => {
      const size = riskManager.clampPositionSize(20, 10000, 100, riskLimits);
      const value = size * 100;
      const pct = (value / 10000) * 100;
      expect(pct).toBeLessThanOrEqual(10);
    });
  });
});
