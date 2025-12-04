import { AnalyticsService } from './analyticsService';
import { PrismaClient } from '@prisma/client';

// Mock Prisma
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    trade: {
      findMany: jest.fn(),
    },
    tradeAnalytics: {
      findMany: jest.fn(),
    },
  })),
}));
jest.mock('../config/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock tradeAnalyticsService
jest.mock('./tradeAnalyticsService', () => ({
  tradeAnalyticsService: {
    getTradeAnalytics: jest.fn(),
    getStrategyAnalytics: jest.fn(),
  },
}));

describe('AnalyticsService', () => {
  let analyticsService: AnalyticsService;
  let mockPrisma: any;

  beforeEach(() => {
    analyticsService = new AnalyticsService();
    mockPrisma = (PrismaClient as jest.Mock).mock.results[0].value;
    jest.clearAllMocks();
  });

  describe('getTradeAnalytics', () => {
    it('should return empty analytics if no trades', async () => {
      mockPrisma.trade.findMany.mockResolvedValue([]);

      const result = await analyticsService.getTradeAnalytics();

      expect(result.totalTrades).toBe(0);
      expect(result.profitableTrades).toBe(0);
      expect(result.losingTrades).toBe(0);
    });

    it('should calculate trade analytics correctly', async () => {
      const mockTrades = [
        {
          id: '1',
          strategyId: 'strategy-1',
          symbol: 'WETH',
          side: 'BUY',
          size: 1.0,
          entryPrice: 2000,
          exitPrice: 2100,
          fees: 10,
          slippage: 5,
          pnl: 90,
          pnlPct: 4.5,
          timestamp: new Date(),
          strategy: { name: 'Test Strategy' },
        },
        {
          id: '2',
          strategyId: 'strategy-1',
          symbol: 'WETH',
          side: 'BUY',
          size: 1.0,
          entryPrice: 2000,
          exitPrice: 1900,
          fees: 10,
          slippage: 5,
          pnl: -110,
          pnlPct: -5.5,
          timestamp: new Date(),
          strategy: { name: 'Test Strategy' },
        },
      ];

      mockPrisma.trade.findMany.mockResolvedValue(mockTrades);

      const result = await analyticsService.getTradeAnalytics(['strategy-1']);

      expect(result.totalTrades).toBe(2);
      expect(result.profitableTrades).toBe(1);
      expect(result.losingTrades).toBe(1);
      expect(result.avgProfit).toBe(90);
      expect(result.avgLoss).toBe(110);
    });
  });

  describe('getExecutionQualityMetrics', () => {
    it('should return zero metrics if no analytics', async () => {
      mockPrisma.tradeAnalytics.findMany.mockResolvedValue([]);

      const result = await analyticsService.getExecutionQualityMetrics();

      expect(result.avgSlippageBps).toBe(0);
      expect(result.avgFillRate).toBe(0);
      expect(result.tradesAnalyzed).toBe(0);
    });

    it('should calculate execution quality metrics', async () => {
      const mockAnalytics = [
        {
          slippageBps: 50,
          fillRate: 1.0,
          executionTimeMs: 3000,
        },
        {
          slippageBps: 100,
          fillRate: 0.95,
          executionTimeMs: 5000,
        },
      ];

      mockPrisma.tradeAnalytics.findMany.mockResolvedValue(mockAnalytics);

      const result = await analyticsService.getExecutionQualityMetrics();

      expect(result.avgSlippageBps).toBe(75); // (50 + 100) / 2
      expect(result.avgFillRate).toBe(0.975); // (1.0 + 0.95) / 2
      expect(result.avgExecutionTimeMs).toBe(4000); // (3000 + 5000) / 2
      expect(result.tradesAnalyzed).toBe(2);
      expect(result.qualityScore).toBeGreaterThan(0);
    });
  });

  describe('getPerformanceMetrics', () => {
    it('should return zero metrics if no trades', async () => {
      mockPrisma.trade.findMany.mockResolvedValue([]);

      const result = await analyticsService.getPerformanceMetrics();

      expect(result.realizedPnl).toBe(0);
      expect(result.maxDrawdown).toBe(0);
      expect(result.winRate).toBe(0);
      expect(result.totalTrades).toBe(0);
    });

    it('should calculate performance metrics correctly', async () => {
      const mockTrades = [
        {
          id: '1',
          exitPrice: 2100,
          pnl: 100,
          pnlPct: 5.0,
        },
        {
          id: '2',
          exitPrice: 1900,
          pnl: -100,
          pnlPct: -5.0,
        },
        {
          id: '3',
          exitPrice: 2200,
          pnl: 200,
          pnlPct: 10.0,
        },
      ];

      mockPrisma.trade.findMany.mockResolvedValue(mockTrades);

      const result = await analyticsService.getPerformanceMetrics();

      expect(result.realizedPnl).toBe(200); // 100 - 100 + 200
      expect(result.winRate).toBeCloseTo(0.667, 2); // 2 wins / 3 trades
      expect(result.totalTrades).toBe(3);
      expect(result.winningTrades).toBe(2);
      expect(result.losingTrades).toBe(1);
    });
  });
});

