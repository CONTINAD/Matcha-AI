import { TradeAnalyticsService } from './tradeAnalyticsService';
import { PrismaClient } from '@prisma/client';

// Mock Prisma
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    trade: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    tradeAnalytics: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
  })),
}));

// Mock axios
jest.mock('axios');

// Mock config
jest.mock('../config/env', () => ({
  config: {
    zeroX: {
      apiKey: 'test-api-key',
    },
    logging: {
      level: 'info',
    },
    server: {
      nodeEnv: 'test',
    },
  },
}));
jest.mock('../config/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock getChainConfig
jest.mock('@matcha-ai/shared', () => ({
  ...jest.requireActual('@matcha-ai/shared'),
  getChainConfig: jest.fn((chainId: number) => {
    if (chainId === 1) {
      return {
        chainId: 1,
        name: 'Ethereum',
        rpcUrl: 'https://eth.llamarpc.com',
        zeroXApiUrl: 'https://api.0x.org',
      };
    }
    return null;
  }),
}));

// Mock transactionTracker
jest.mock('./transactionTracker', () => ({
  transactionTracker: {
    getTransactionInfo: jest.fn(),
  },
}));

describe('TradeAnalyticsService', () => {
  let tradeAnalyticsService: TradeAnalyticsService;
  let mockPrisma: any;
  const mockAxios = require('axios');

  beforeEach(() => {
    tradeAnalyticsService = new TradeAnalyticsService();
    mockPrisma = (PrismaClient as jest.Mock).mock.results[0].value;
    jest.clearAllMocks();
  });

  describe('calculateExecutionQuality', () => {
    it('should return null if trade not found', async () => {
      mockPrisma.trade.findUnique.mockResolvedValue(null);

      const result = await tradeAnalyticsService.calculateExecutionQuality(
        'trade-id',
        '1000000000000000000',
        '1000000000000000000'
      );

      expect(result).toBeNull();
    });

    it('should calculate execution quality from analytics API', async () => {
      const mockTrade = {
        id: 'trade-id',
        strategyId: 'strategy-id',
        txHash: '0x123',
        symbol: 'WETH',
        size: 1.0,
        entryPrice: 2000,
        strategy: {
          chainId: 1,
        },
      };

      const mockTxInfo = {
        txHash: '0x123',
        status: 'CONFIRMED',
        submittedAt: new Date(Date.now() - 5000),
        confirmedAt: new Date(),
        gasUsed: '21000',
        gasPrice: '20000000000',
      };

      const mockAnalyticsResponse = {
        data: {
          txHash: '0x123',
          chainId: 1,
          sellToken: '0xTokenA',
          buyToken: '0xTokenB',
          sellAmount: '1000000000000000000',
          buyAmount: '1000000000000000000',
          price: '1.01',
          slippageBps: 100,
          fillRate: 1.0,
          executionTimeMs: 5000,
          gasUsed: '21000',
          gasPrice: '20000000000',
          priceImpact: '0.01',
        },
      };

      mockPrisma.trade.findUnique.mockResolvedValue(mockTrade);
      require('./transactionTracker').transactionTracker.getTransactionInfo.mockResolvedValue(mockTxInfo);
      mockAxios.get.mockResolvedValue(mockAnalyticsResponse);
      mockPrisma.tradeAnalytics.upsert.mockResolvedValue({});
      mockPrisma.trade.update.mockResolvedValue({});

      const result = await tradeAnalyticsService.calculateExecutionQuality(
        'trade-id',
        '1.0',
        '1000000000000000000'
      );

      expect(result).toBeDefined();
      expect(result?.slippageBps).toBe(100);
      expect(result?.fillRate).toBe(1.0);
      expect(result?.executionTimeMs).toBe(5000);
    });

    it('should fallback to trade data if analytics API unavailable', async () => {
      const mockTrade = {
        id: 'trade-id',
        strategyId: 'strategy-id',
        txHash: '0x123',
        symbol: 'WETH',
        size: 1.0,
        entryPrice: 2000,
        exitPrice: 2010,
        strategy: {
          chainId: 1,
        },
      };

      const mockTxInfo = {
        txHash: '0x123',
        status: 'CONFIRMED',
        submittedAt: new Date(Date.now() - 5000),
        confirmedAt: new Date(),
        gasUsed: '21000',
        gasPrice: '20000000000',
      };

      mockPrisma.trade.findUnique.mockResolvedValue(mockTrade);
      require('./transactionTracker').transactionTracker.getTransactionInfo.mockResolvedValue(mockTxInfo);
      mockAxios.get.mockResolvedValue({ status: 404 }); // Analytics not available
      mockPrisma.tradeAnalytics.create.mockResolvedValue({});
      mockPrisma.trade.update.mockResolvedValue({});

      const result = await tradeAnalyticsService.calculateExecutionQuality(
        'trade-id',
        '2000',
        '2000000000000000000'
      );

      expect(result).toBeDefined();
      expect(result?.fillRate).toBe(1.0); // Assumed full fill
    });
  });

  describe('getTradeAnalytics', () => {
    it('should return trade analytics if found', async () => {
      const mockAnalytics = {
        tradeId: 'trade-id',
        strategyId: 'strategy-id',
        chainId: 1,
        txHash: '0x123',
        expectedPrice: '1.0',
        actualPrice: '1.01',
        slippageBps: 100,
        fillRate: 1.0,
        executionTimeMs: 5000,
        gasUsed: '21000',
        gasPrice: '20000000000',
        priceImpact: '0.01',
        sellToken: '0xTokenA',
        buyToken: '0xTokenB',
        sellAmount: '1000000000000000000',
        buyAmount: '1000000000000000000',
        timestamp: new Date(),
      };

      mockPrisma.tradeAnalytics.findUnique.mockResolvedValue(mockAnalytics);

      const result = await tradeAnalyticsService.getTradeAnalytics('trade-id');

      expect(result).toBeDefined();
      expect(result?.tradeId).toBe('trade-id');
      expect(result?.executionQuality.slippageBps).toBe(100);
    });

    it('should return null if analytics not found', async () => {
      mockPrisma.tradeAnalytics.findUnique.mockResolvedValue(null);

      const result = await tradeAnalyticsService.getTradeAnalytics('trade-id');

      expect(result).toBeNull();
    });
  });
});

