import { Backtester } from '../services/backtester';
import { PaperTrader } from '../services/paperTrader';
import { LiveTrader } from '../services/liveTrader';
import { getTemplate } from '../services/strategyTemplates';
import type { StrategyConfig, Candle } from '@matcha-ai/shared';

/**
 * Smoke tests for core trading paths
 * Run with: pnpm --filter @matcha-ai/api test smoke.test.ts
 */

describe('Smoke Tests - Core Trading Paths', () => {
  describe('Backtester', () => {
    it('should run a basic backtest without errors', async () => {
      const backtester = new Backtester();
      const config: StrategyConfig = {
        baseAsset: 'USDC',
        universe: ['WETH'],
        timeframe: '1h',
        riskLimits: {
          maxPositionPct: 10,
          maxDailyLossPct: 3,
          stopLossPct: 2,
          takeProfitPct: 4,
        },
      };

      const candles: Candle[] = [];
      const now = Date.now();
      let price = 100;
      for (let i = 0; i < 100; i++) {
        price += (Math.random() - 0.5) * 2; // Random walk
        candles.push({
          open: price,
          high: price * 1.01,
          low: price * 0.99,
          close: price,
          volume: 1000 + Math.random() * 500,
          timestamp: now - (100 - i) * 3600000,
        });
      }

      const result = await backtester.runBacktest({
        strategyConfig: config,
        candles,
        initialEquity: 1000,
        fastMode: true,
      });

      expect(result).toBeDefined();
      expect(result.trades).toBeDefined();
      expect(Array.isArray(result.trades)).toBe(true);
      expect(result.finalEquity).toBeGreaterThan(0);
      expect(result.totalReturnPct).toBeDefined();
    });

    it('should respect risk limits', async () => {
      const backtester = new Backtester();
      const config: StrategyConfig = {
        baseAsset: 'USDC',
        universe: ['WETH'],
        timeframe: '1h',
        riskLimits: {
          maxPositionPct: 5, // Very small position
          maxDailyLossPct: 1, // Very tight loss limit
          stopLossPct: 1,
          takeProfitPct: 2,
        },
      };

      const candles: Candle[] = [];
      const now = Date.now();
      let price = 100;
      for (let i = 0; i < 50; i++) {
        price -= 0.5; // Downward trend to trigger loss limit
        candles.push({
          open: price,
          high: price * 1.01,
          low: price * 0.99,
          close: price,
          volume: 1000,
          timestamp: now - (50 - i) * 3600000,
        });
      }

      const result = await backtester.runBacktest({
        strategyConfig: config,
        candles,
        initialEquity: 1000,
        fastMode: true,
      });

      // Check that no position exceeded maxPositionPct
      const maxPosition = Math.max(
        ...result.trades.map((t) => (t.size * t.entryPrice) / result.initialEquity * 100),
        0
      );
      expect(maxPosition).toBeLessThanOrEqual(config.riskLimits.maxPositionPct * 1.1); // Allow 10% tolerance
    });
  });

  describe('Strategy Templates', () => {
    it('should have all required templates', () => {
      const momentum = getTemplate('momentum-ema');
      expect(momentum).toBeDefined();
      expect(momentum?.category).toBe('momentum');

      const meanRev = getTemplate('mean-reversion-rsi');
      expect(meanRev).toBeDefined();
      expect(meanRev?.category).toBe('mean-reversion');

      const breakout = getTemplate('breakout-atr');
      expect(breakout).toBeDefined();
      expect(breakout?.category).toBe('breakout');

      const trend = getTemplate('trend-following-multi');
      expect(trend).toBeDefined();
      expect(trend?.category).toBe('trend-following');
    });

    it('should have valid configs for all templates', () => {
      const templates = ['momentum-ema', 'mean-reversion-rsi', 'breakout-atr', 'trend-following-multi'];
      
      for (const id of templates) {
        const template = getTemplate(id);
        expect(template).toBeDefined();
        expect(template?.config.baseAsset).toBe('USDC');
        expect(template?.config.universe.length).toBeGreaterThan(0);
        expect(template?.config.riskLimits.maxPositionPct).toBeGreaterThan(0);
        expect(template?.config.riskLimits.maxPositionPct).toBeLessThanOrEqual(100);
      }
    });
  });

  describe('Paper Trader', () => {
    it('should initialize without errors', () => {
      const paperTrader = new PaperTrader();
      expect(paperTrader).toBeDefined();
    });

    // Note: Full paper trader test would require database and data feed setup
    // This is a smoke test to ensure the class can be instantiated
  });

  describe('Live Trader', () => {
    it('should initialize without errors', () => {
      const liveTrader = new LiveTrader();
      expect(liveTrader).toBeDefined();
    });

    // Note: Full live trader test would require wallet and 0x service setup
    // This is a smoke test to ensure the class can be instantiated
  });
});




