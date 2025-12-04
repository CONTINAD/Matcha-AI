import { FastifyInstance } from 'fastify';
import { analyticsRoutes } from './analytics';
import { analyticsService } from '../services/analyticsService';
import { tradeAnalyticsService } from '../services/tradeAnalyticsService';

// Mock services
jest.mock('../services/analyticsService');
jest.mock('../services/tradeAnalyticsService');
jest.mock('../config/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('Analytics Routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = require('fastify')();
    await app.register(analyticsRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /analytics/trades', () => {
    it('should return trade analytics', async () => {
      const mockData = {
        totalTrades: 10,
        profitableTrades: 6,
        losingTrades: 4,
        bestTrade: null,
        worstTrade: null,
        avgProfit: 100,
        avgLoss: 50,
        tradesByHour: {},
        tradesByDay: {},
        strategyPerformance: [],
      };

      (analyticsService.getTradeAnalytics as jest.Mock).mockResolvedValue(mockData);

      const response = await app.inject({
        method: 'GET',
        url: '/analytics/trades',
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data.totalTrades).toBe(10);
      expect(analyticsService.getTradeAnalytics).toHaveBeenCalled();
    });

    it('should handle query parameters', async () => {
      const mockData = {
        totalTrades: 5,
        profitableTrades: 3,
        losingTrades: 2,
        bestTrade: null,
        worstTrade: null,
        avgProfit: 100,
        avgLoss: 50,
        tradesByHour: {},
        tradesByDay: {},
        strategyPerformance: [],
      };

      (analyticsService.getTradeAnalytics as jest.Mock).mockResolvedValue(mockData);

      const response = await app.inject({
        method: 'GET',
        url: '/analytics/trades?strategyIds=strategy-1,strategy-2&fromTime=1000&toTime=2000',
      });

      expect(response.statusCode).toBe(200);
      expect(analyticsService.getTradeAnalytics).toHaveBeenCalledWith(
        ['strategy-1', 'strategy-2'],
        1000,
        2000
      );
    });
  });

  describe('GET /analytics/execution-quality', () => {
    it('should return execution quality metrics', async () => {
      const mockData = {
        avgSlippageBps: 50,
        avgFillRate: 0.98,
        avgExecutionTimeMs: 3000,
        qualityScore: 0.85,
        tradesAnalyzed: 100,
      };

      (analyticsService.getExecutionQualityMetrics as jest.Mock).mockResolvedValue(mockData);

      const response = await app.inject({
        method: 'GET',
        url: '/analytics/execution-quality',
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data.avgSlippageBps).toBe(50);
      expect(data.qualityScore).toBe(0.85);
    });
  });

  describe('GET /analytics/performance', () => {
    it('should return performance metrics', async () => {
      const mockData = {
        realizedPnl: 1000,
        maxDrawdown: 5.5,
        winRate: 0.6,
        sharpe: 1.2,
        totalTrades: 50,
        winningTrades: 30,
        losingTrades: 20,
      };

      (analyticsService.getPerformanceMetrics as jest.Mock).mockResolvedValue(mockData);

      const response = await app.inject({
        method: 'GET',
        url: '/analytics/performance?strategyId=strategy-1',
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data.realizedPnl).toBe(1000);
      expect(data.winRate).toBe(0.6);
    });
  });

  describe('GET /analytics/strategy/:id', () => {
    it('should return strategy analytics', async () => {
      const mockData = {
        strategyId: 'strategy-1',
        timeRange: {
          from: 1000,
          to: 2000,
        },
        performance: {
          realizedPnl: 500,
          maxDrawdown: 3.0,
          winRate: 0.65,
        },
        executionQuality: {
          avgSlippageBps: 40,
          avgFillRate: 0.99,
          avgExecutionTimeMs: 2500,
          qualityScore: 0.9,
          tradesAnalyzed: 25,
        },
        trades: [],
      };

      (analyticsService.getStrategyAnalytics as jest.Mock).mockResolvedValue(mockData);

      const response = await app.inject({
        method: 'GET',
        url: '/analytics/strategy/strategy-1',
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data.strategyId).toBe('strategy-1');
      expect(data.performance.realizedPnl).toBe(500);
    });
  });

  describe('GET /analytics/trade/:tradeId', () => {
    it('should return trade analytics if found', async () => {
      const mockData = {
        tradeId: 'trade-1',
        strategyId: 'strategy-1',
        executionQuality: {
          expectedPrice: '1.0',
          actualPrice: '1.01',
          slippageBps: 100,
          fillRate: 1.0,
          executionTimeMs: 3000,
        },
        timestamp: 1000,
        chainId: 1,
        txHash: '0x123',
        sellToken: '0xTokenA',
        buyToken: '0xTokenB',
        sellAmount: '1000000000000000000',
        buyAmount: '1010000000000000000',
      };

      (tradeAnalyticsService.getTradeAnalytics as jest.Mock).mockResolvedValue(mockData);

      const response = await app.inject({
        method: 'GET',
        url: '/analytics/trade/trade-1',
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.body);
      expect(data.tradeId).toBe('trade-1');
    });

    it('should return 404 if trade analytics not found', async () => {
      (tradeAnalyticsService.getTradeAnalytics as jest.Mock).mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/analytics/trade/nonexistent',
      });

      expect(response.statusCode).toBe(404);
    });
  });
});

