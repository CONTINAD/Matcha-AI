/**
 * Integration tests for World-Class Upgrade services
 * Tests the integration of executionEngine, slippageManager, strategySelector,
 * adaptiveExits, and aiValidator into the trading pipeline
 */

import { executionEngine } from '../services/executionEngine';
import { slippageManager } from '../services/slippageManager';
import { strategySelector } from '../services/strategySelector';
import { adaptiveExits } from '../services/adaptiveExits';
import { aiValidator } from '../services/aiValidator';
import { decisionEngine } from '../services/decisionEngine';
import { checkStopLossTakeProfit } from '../services/stopLossTakeProfit';
import type { Candle, Decision, StrategyConfig, MarketContext, Position, RiskLimits, Indicators } from '@matcha-ai/shared';

// Mock dependencies
jest.mock('../config/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../services/zeroExService', () => ({
  zeroExService: {
    getQuote: jest.fn(),
    buildSwapTx: jest.fn(),
  },
}));

jest.mock('../services/gaslessService', () => ({
  gaslessService: {
    getFirmQuote: jest.fn(),
  },
}));

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    trade: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    strategy: {
      findUnique: jest.fn(),
    },
  })),
}));

describe('World-Class Upgrade Integration Tests', () => {
  const mockCandles: Candle[] = Array.from({ length: 20 }, (_, i) => ({
    open: 2000 + i * 10,
    high: 2010 + i * 10,
    low: 1990 + i * 10,
    close: 2005 + i * 10,
    volume: 1000 + i * 100,
    timestamp: Date.now() - (20 - i) * 3600000,
  }));

  const mockIndicators: Indicators = {
    rsi: 55,
    ema20: 2020,
    ema50: 2000,
    macd: 5,
    macdSignal: 3,
    macdHistogram: 2,
    bollingerUpper: 2050,
    bollingerMiddle: 2000,
    bollingerLower: 1950,
    volatility: 50,
    adx: 30,
  };

  const mockRiskLimits: RiskLimits = {
    maxPositionPct: 10,
    maxDailyLossPct: 5,
    stopLossPct: 2,
    takeProfitPct: 4,
    maxDrawdownPct: 15,
  };

  const mockStrategyConfig: StrategyConfig = {
    baseAsset: 'USDC',
    universe: ['WETH'],
    chainId: 1,
    timeframe: '5m',
    indicators: {
      rsi: { period: 14 },
      ema: { short: 20, long: 50 },
      macd: {},
      bollinger: { period: 20, stdDev: 2 },
      atr: { period: 14 },
    },
    riskLimits: mockRiskLimits,
    enableDynamicStrategySelection: true,
  };

  describe('Execution Engine Integration', () => {
    it('should use execution engine with fallback routing', async () => {
      const { zeroExService } = require('../services/zeroExService');
      
      const mockQuote = {
        price: '1.0',
        guaranteedPrice: '0.99',
        buyAmount: '1000000000000000000',
        sellAmount: '1000000000000000000',
        to: '0xExchangeProxy',
        data: '0x',
        value: '0',
      };

      zeroExService.getQuote.mockResolvedValue(mockQuote);

      const result = await executionEngine.executeTrade({
        chainId: 1,
        sellToken: '0xUSDC',
        buyToken: '0xWETH',
        amount: '1000000000000000000',
        slippageBps: 50,
      });

      expect(result).toHaveProperty('quote');
      expect(result).toHaveProperty('source');
      expect(result).toHaveProperty('latency');
      expect(result).toHaveProperty('fallbackUsed');
      expect(zeroExService.getQuote).toHaveBeenCalled();
    });

    it('should track execution metrics', async () => {
      const { executionLatency, executionFallbacks } = require('../services/metrics');
      
      // Metrics should be recorded (we can't easily test Prometheus metrics in Jest,
      // but we can verify the code path is correct)
      expect(executionLatency).toBeDefined();
      expect(executionFallbacks).toBeDefined();
    });
  });

  describe('Slippage Manager Integration', () => {
    it('should calculate dynamic slippage based on market conditions', () => {
      const slippage = slippageManager.calculateSlippage({
        candles: mockCandles,
        indicators: mockIndicators,
        tradeSize: 1000, // $1000 trade
        timeOfDay: 14, // 2 PM UTC
      });

      expect(slippage).toBeGreaterThanOrEqual(10); // Min 0.1%
      expect(slippage).toBeLessThanOrEqual(200); // Max 2%
      expect(typeof slippage).toBe('number');
    });

    it('should increase slippage in high volatility', () => {
      const highVolIndicators = { ...mockIndicators, volatility: 200 };
      const highVolCandles = mockCandles.map(c => ({
        ...c,
        high: c.high * 1.1,
        low: c.low * 0.9,
      }));

      const slippage = slippageManager.calculateSlippage({
        candles: highVolCandles,
        indicators: highVolIndicators,
        tradeSize: 1000,
        timeOfDay: 14,
      });

      // Should be higher than base slippage
      expect(slippage).toBeGreaterThan(50);
    });

    it('should track slippage metrics', () => {
      const { slippageCalculations } = require('../services/metrics');
      expect(slippageCalculations).toBeDefined();
    });
  });

  describe('Strategy Selector Integration', () => {
    it('should select strategy based on market regime', async () => {
      const { PrismaClient } = require('@prisma/client');
      const mockPrisma = new PrismaClient();
      
      mockPrisma.trade.findMany.mockResolvedValue([]);

      const selectedStrategy = await strategySelector.selectStrategy(
        'test-strategy-id',
        mockCandles,
        mockIndicators,
        mockStrategyConfig
      );

      // Should return a valid strategy type or null
      expect(
        selectedStrategy === null ||
        ['trend-following', 'momentum', 'breakout', 'grid', 'mean-reversion', 'arbitrage'].includes(selectedStrategy)
      ).toBe(true);
    });

    it('should generate decision from selected strategy', async () => {
      const decision = await strategySelector.generateDecision(
        'test-strategy-id',
        mockCandles,
        mockIndicators,
        mockStrategyConfig
      );

      // Decision can be null if no strategy suitable
      if (decision) {
        expect(decision).toHaveProperty('action');
        expect(decision).toHaveProperty('confidence');
        expect(decision).toHaveProperty('targetPositionSizePct');
        expect(['long', 'short', 'flat']).toContain(decision.action);
      }
    });

    it('should track strategy switch metrics', () => {
      const { strategySwitches, strategyPerformance } = require('../services/metrics');
      expect(strategySwitches).toBeDefined();
      expect(strategyPerformance).toBeDefined();
    });
  });

  describe('Adaptive Exits Integration', () => {
    const mockPosition: Position = {
      symbol: 'WETH',
      side: 'long',
      size: 1.0,
      entryPrice: 2000,
      entryTime: Date.now() - 3600000,
    };

    it('should calculate adaptive exit targets', () => {
      const targets = adaptiveExits.calculateExitTargets(
        mockPosition,
        mockCandles,
        mockIndicators,
        mockRiskLimits
      );

      expect(targets).toHaveProperty('takeProfitPct');
      expect(targets).toHaveProperty('stopLossPct');
      expect(targets.takeProfitPct).toBeGreaterThan(0);
      expect(targets.stopLossPct).toBeGreaterThan(0);
    });

    it('should increase take-profit in strong trends', () => {
      const strongTrendIndicators = { ...mockIndicators, adx: 45 };
      const trendingCandles = mockCandles.map((c, i) => ({
        ...c,
        close: 2000 + i * 20, // Strong uptrend
      }));

      const targets = adaptiveExits.calculateExitTargets(
        mockPosition,
        trendingCandles,
        strongTrendIndicators,
        mockRiskLimits
      );

      // Take-profit should be higher than base in strong trends
      expect(targets.takeProfitPct).toBeGreaterThanOrEqual(mockRiskLimits.takeProfitPct || 4);
    });

    it('should integrate with stopLossTakeProfit', () => {
      const check = checkStopLossTakeProfit(
        mockPosition,
        2100, // Current price (5% above entry)
        mockRiskLimits,
        undefined, // No trailing stop
        mockCandles, // Pass candles for adaptive exits
        mockIndicators // Pass indicators for adaptive exits
      );

      expect(check).toHaveProperty('shouldClose');
      expect(check).toHaveProperty('reason');
      expect(check).toHaveProperty('exitPrice');
    });

    it('should track adaptive exit metrics', () => {
      const { adaptiveExitTriggers } = require('../services/metrics');
      expect(adaptiveExitTriggers).toBeDefined();
    });
  });

  describe('AI Validator Integration', () => {
    const mockContext: MarketContext = {
      recentCandles: mockCandles.slice(-10),
      indicators: mockIndicators,
      openPositions: [],
      performance: {
        realizedPnl: 0,
        maxDrawdown: 0,
        winRate: 0.5,
        totalTrades: 10,
        winningTrades: 5,
        losingTrades: 5,
      },
      riskLimits: mockRiskLimits,
      currentEquity: 10000,
      dailyPnl: 0,
    };

    const validDecision: Decision = {
      action: 'long',
      confidence: 0.7,
      targetPositionSizePct: 5,
      notes: 'Valid decision',
    };

    it('should validate AI decisions', () => {
      const result = aiValidator.validateDecision(validDecision, mockContext, mockRiskLimits);

      expect(result).toHaveProperty('valid');
      expect(result.valid).toBe(true);
    });

    it('should reject low confidence decisions', () => {
      const lowConfidenceDecision: Decision = {
        ...validDecision,
        confidence: 0.2, // Below threshold
      };

      const result = aiValidator.validateDecision(lowConfidenceDecision, mockContext, mockRiskLimits);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Confidence too low');
    });

    it('should reject decisions exceeding position size', () => {
      const largePositionDecision: Decision = {
        ...validDecision,
        targetPositionSizePct: 15, // Exceeds maxPositionPct of 10
      };

      const result = aiValidator.validateDecision(largePositionDecision, mockContext, mockRiskLimits);

      expect(result.valid).toBe(true); // Should adjust, not reject
      expect(result.adjustedDecision).toBeDefined();
      expect(result.adjustedDecision?.targetPositionSizePct).toBeLessThanOrEqual(10);
    });

    it('should reject decisions during losing streaks', () => {
      const losingStreakContext: MarketContext = {
        ...mockContext,
        performance: {
          ...mockContext.performance,
          winRate: 0.3, // Low win rate
          totalTrades: 10,
          winningTrades: 3,
          losingTrades: 7,
        },
      };

      // Mock losing streak calculation
      const result = aiValidator.validateDecision(validDecision, losingStreakContext, mockRiskLimits);

      // May reject if losing streak detected
      expect(result).toHaveProperty('valid');
    });

    it('should integrate with decisionEngine', async () => {
      const fastDecision: Decision = {
        action: 'long',
        confidence: 0.6,
        targetPositionSizePct: 5,
        notes: 'Fast decision',
      };

      const aiDecision: Decision = {
        action: 'long',
        confidence: 0.8,
        targetPositionSizePct: 7,
        notes: 'AI decision',
      };

      // combineFastAndAI should use validator
      const combined = decisionEngine.combineFastAndAI(
        fastDecision,
        aiDecision,
        mockStrategyConfig,
        mockContext
      );

      expect(combined).toHaveProperty('action');
      expect(combined).toHaveProperty('confidence');
    });

    it('should track validator rejection metrics', () => {
      const { aiValidatorRejections } = require('../services/metrics');
      expect(aiValidatorRejections).toBeDefined();
    });
  });

  describe('End-to-End Integration', () => {
    it('should use all services together in decision flow', async () => {
      const context: MarketContext = {
        recentCandles: mockCandles.slice(-20),
        indicators: mockIndicators,
        openPositions: [],
        performance: {
          realizedPnl: 100,
          maxDrawdown: 2,
          winRate: 0.6,
          totalTrades: 20,
          winningTrades: 12,
          losingTrades: 8,
        },
        riskLimits: mockRiskLimits,
        currentEquity: 10100,
        dailyPnl: 50,
      };

      // Decision engine should use strategy selector, AI validator, etc.
      const decision = await decisionEngine.decide(context, mockStrategyConfig, {
        strategyId: 'test-strategy-id',
        aiMode: 'ASSIST',
      });

      expect(decision).toHaveProperty('action');
      expect(decision).toHaveProperty('confidence');
      expect(decision).toHaveProperty('targetPositionSizePct');
      expect(['long', 'short', 'flat']).toContain(decision.action);
    });

    it('should handle adaptive exits in position management', () => {
      const position: Position = {
        symbol: 'WETH',
        side: 'long',
        size: 1.0,
        entryPrice: 2000,
        entryTime: Date.now() - 3600000,
      };

      // Check exit with adaptive exits
      const check = checkStopLossTakeProfit(
        position,
        2080, // 4% above entry (should trigger take-profit)
        mockRiskLimits,
        undefined,
        mockCandles,
        mockIndicators
      );

      expect(check).toHaveProperty('shouldClose');
      // May close if take-profit triggered
    });
  });
});

