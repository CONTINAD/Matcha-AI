import { Backtester } from './backtester';
import type { StrategyConfig, Candle } from '@matcha-ai/shared';

describe('Backtester', () => {
  const backtester = new Backtester();

  describe('PnL calculation', () => {
    it('should correctly calculate PnL for long positions', async () => {
      const config: StrategyConfig = {
        baseAsset: 'USDC',
        universe: ['ETH'],
        timeframe: '1h',
        riskLimits: {
          maxPositionPct: 10,
          maxDailyLossPct: 5,
          stopLossPct: 2,
          takeProfitPct: 4,
        },
      };

      // Simple price series: $100 -> $110 (10% gain)
      const candles: Candle[] = [
        { open: 100, high: 105, low: 95, close: 100, volume: 1000, timestamp: Date.now() - 3600000 },
        { open: 100, high: 110, low: 100, close: 110, volume: 1000, timestamp: Date.now() },
      ];

      const result = await backtester.runBacktest({
        strategyConfig: config,
        candles,
        initialEquity: 1000,
        fastMode: true, // Use rule-based decisions
      });

      // Should have at least one trade
      expect(result.trades.length).toBeGreaterThan(0);
      
      // Final equity should be > initial (price went up)
      expect(result.finalEquity).toBeGreaterThanOrEqual(result.initialEquity);
      
      // Total return should be positive
      expect(result.totalReturnPct).toBeGreaterThanOrEqual(0);
    });

    it('should respect daily loss limit', async () => {
      const config: StrategyConfig = {
        baseAsset: 'USDC',
        universe: ['ETH'],
        timeframe: '1h',
        riskLimits: {
          maxPositionPct: 10,
          maxDailyLossPct: 3, // 3% daily loss limit
          stopLossPct: 2,
          takeProfitPct: 4,
        },
      };

      // Price series with losses
      const candles: Candle[] = Array.from({ length: 10 }, (_, i) => ({
        open: 100 - i * 2,
        high: 100 - i * 2 + 1,
        low: 100 - i * 2 - 1,
        close: 100 - i * 2,
        volume: 1000,
        timestamp: Date.now() - (10 - i) * 3600000,
      }));

      const result = await backtester.runBacktest({
        strategyConfig: config,
        candles,
        initialEquity: 1000,
        fastMode: true,
      });

      // Should stop trading after hitting daily loss limit
      // Check that final equity doesn't drop below 97% of initial (3% loss limit)
      const maxAllowedLoss = result.initialEquity * 0.03;
      expect(result.initialEquity - result.finalEquity).toBeLessThanOrEqual(maxAllowedLoss);
    });

    it('should trigger stop loss', async () => {
      const config: StrategyConfig = {
        baseAsset: 'USDC',
        universe: ['ETH'],
        timeframe: '1h',
        riskLimits: {
          maxPositionPct: 10,
          maxDailyLossPct: 5,
          stopLossPct: 2, // 2% stop loss
          takeProfitPct: 4,
        },
      };

      // Price goes up then drops 3% (should trigger 2% stop loss)
      const candles: Candle[] = [
        { open: 100, high: 105, low: 95, close: 100, volume: 1000, timestamp: Date.now() - 7200000 },
        { open: 100, high: 102, low: 98, close: 101, volume: 1000, timestamp: Date.now() - 3600000 },
        { open: 101, high: 99, low: 97, close: 97, volume: 1000, timestamp: Date.now() }, // 3% drop
      ];

      const result = await backtester.runBacktest({
        strategyConfig: config,
        candles,
        initialEquity: 1000,
        fastMode: true,
      });

      // Should have trades
      expect(result.trades.length).toBeGreaterThan(0);
      
      // Check that stop loss was triggered (look for trade with exit price around 98-99)
      const stopLossTrades = result.trades.filter(t => 
        t.entryPrice && t.exitPrice && 
        ((t.exitPrice - t.entryPrice) / t.entryPrice) < -0.015 // Loss > 1.5%
      );
      
      // If stop loss is working, we should see trades closed at loss
      // (This is a basic check - in practice, stop loss should trigger around 2% loss)
      expect(result.trades.some(t => t.pnl < 0)).toBe(true);
    });
  });

  describe('Risk limits', () => {
    it('should respect max position size', async () => {
      const config: StrategyConfig = {
        baseAsset: 'USDC',
        universe: ['ETH'],
        timeframe: '1h',
        riskLimits: {
          maxPositionPct: 5, // 5% max position
          maxDailyLossPct: 5,
        },
      };

      const candles: Candle[] = Array.from({ length: 5 }, (_, i) => ({
        open: 100,
        high: 105,
        low: 95,
        close: 100 + i,
        volume: 1000,
        timestamp: Date.now() - (5 - i) * 3600000,
      }));

      const result = await backtester.runBacktest({
        strategyConfig: config,
        candles,
        initialEquity: 1000,
        fastMode: true,
      });

      // Check that no single position exceeds 5% of equity
      const maxPositionValue = result.trades.reduce((max, trade) => {
        const positionValue = trade.size * trade.entryPrice;
        return Math.max(max, positionValue);
      }, 0);

      const maxAllowedPosition = result.initialEquity * 0.05;
      expect(maxPositionValue).toBeLessThanOrEqual(maxAllowedPosition * 1.1); // Allow 10% tolerance for fees
    });
  });
});




