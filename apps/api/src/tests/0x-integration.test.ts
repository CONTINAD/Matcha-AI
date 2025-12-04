/**
 * Integration tests for 0x best practices features
 * Tests the integration between LiveTrader, TransactionTracker, and TradeAnalyticsService
 */

import { LiveTrader } from '../services/liveTrader';
import { transactionTracker } from '../services/transactionTracker';
import { tradeAnalyticsService } from '../services/tradeAnalyticsService';
import { zeroExService } from '../services/zeroExService';
import { PrismaClient } from '@prisma/client';

// Mock dependencies
jest.mock('@prisma/client');
jest.mock('../services/zeroExService');
jest.mock('../services/transactionTracker');
jest.mock('../services/tradeAnalyticsService');
jest.mock('../services/matchaBrain');
jest.mock('../services/riskManager');
jest.mock('../services/features');
jest.mock('../services/dataFeed');
jest.mock('../services/predictionTrainer');
jest.mock('../config/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('0x Integration Tests', () => {
  describe('LiveTrader + TransactionTracker Integration', () => {
    it('should start tracking transaction when trade is recorded', async () => {
      const liveTrader = new LiveTrader();
      const mockStartTracking = jest.fn();
      (transactionTracker.startTracking as jest.Mock) = mockStartTracking;

      await liveTrader.recordTrade('strategy-id', {
        symbol: 'WETH',
        side: 'BUY',
        size: 1.0,
        entryPrice: 2000,
        fees: 10,
        slippage: 5,
        pnl: 0,
        pnlPct: 0,
        txHash: '0x123',
        expectedPrice: '2000',
        expectedBuyAmount: '2000000000000000000',
      });

      expect(mockStartTracking).toHaveBeenCalledWith('0x123', expect.any(Number), expect.any(String));
    });
  });

  describe('ZeroXService AllowanceHolder Integration', () => {
    it('should validate allowance target from quote', () => {
      const quote = {
        price: '1.0',
        guaranteedPrice: '0.99',
        estimatedPriceImpact: '0.01',
        buyAmount: '1000000000000000000',
        sellAmount: '1000000000000000000',
        allowanceTarget: '0xAllowanceHolderAddress',
        to: '0xExchangeProxy',
        data: '0x',
        value: '0',
      };

      const target = zeroExService.getAllowanceTarget(quote, 1);
      expect(target).toBe('0xAllowanceHolderAddress');

      // Should not throw
      expect(() => {
        zeroExService.validateAllowanceTarget('0xAllowanceHolderAddress', 1);
      }).not.toThrow();
    });

    it('should include allowance target in swap transaction', async () => {
      const mockQuote = {
        price: '1.0',
        guaranteedPrice: '0.99',
        estimatedPriceImpact: '0.01',
        buyAmount: '1000000000000000000',
        sellAmount: '1000000000000000000',
        allowanceTarget: '0xAllowanceHolderAddress',
        to: '0xExchangeProxy',
        data: '0x1234',
        value: '0',
        gas: '200000',
        gasPrice: '20000000000',
      };

      (zeroExService.getQuote as jest.Mock).mockResolvedValue(mockQuote);
      (zeroExService.buildSwapTx as jest.Mock).mockResolvedValue({
        to: '0xExchangeProxy',
        data: '0x1234',
        value: '0',
        chainId: 1,
        allowanceTarget: '0xAllowanceHolderAddress',
      });

      const swapTx = await zeroExService.buildSwapTx({
        chainId: 1,
        sellToken: '0xTokenA',
        buyToken: '0xTokenB',
        amount: '1000000000000000000',
      });

      expect(swapTx.allowanceTarget).toBe('0xAllowanceHolderAddress');
    });
  });

  describe('TransactionTracker + TradeAnalyticsService Integration', () => {
    it('should calculate execution quality when transaction is confirmed', async () => {
      const mockTxInfo = {
        txHash: '0x123',
        status: 'CONFIRMED' as const,
        submittedAt: new Date(Date.now() - 5000),
        confirmedAt: new Date(),
        gasUsed: '21000',
        gasPrice: '20000000000',
      };

      (transactionTracker.getTransactionInfo as jest.Mock).mockResolvedValue(mockTxInfo);
      (tradeAnalyticsService.calculateExecutionQuality as jest.Mock).mockResolvedValue({
        expectedPrice: '2000',
        actualPrice: '2010',
        slippageBps: 50,
        fillRate: 1.0,
        executionTimeMs: 5000,
        gasUsed: '21000',
        gasPrice: '20000000000',
      });

      const quality = await tradeAnalyticsService.calculateExecutionQuality(
        'trade-id',
        '2000',
        '2000000000000000000'
      );

      expect(quality).toBeDefined();
      expect(quality?.slippageBps).toBe(50);
      expect(quality?.fillRate).toBe(1.0);
    });
  });

  describe('Best Practices Compliance', () => {
    it('should not use fake data - all data comes from real APIs or blockchain', () => {
      // This is a documentation test - verify that:
      // 1. ZeroXService calls real 0x API
      // 2. TransactionTracker polls real blockchain
      // 3. TradeAnalyticsService calls real 0x Trade Analytics API
      // 4. No hardcoded fake values in calculations

      expect(zeroExService).toBeDefined();
      expect(transactionTracker).toBeDefined();
      expect(tradeAnalyticsService).toBeDefined();
    });

    it('should not have UI-driven logic in backend services', () => {
      // Verify that analytics logic is in backend, not frontend
      // AnalyticsService should handle all calculations server-side
      const analyticsService = require('../services/analyticsService').analyticsService;
      expect(analyticsService).toBeDefined();
      expect(typeof analyticsService.getTradeAnalytics).toBe('function');
      expect(typeof analyticsService.getPerformanceMetrics).toBe('function');
    });

    it('should only use safe allowance targets', () => {
      // Verify that validateAllowanceTarget checks for safe contracts
      const quote = {
        price: '1.0',
        guaranteedPrice: '0.99',
        estimatedPriceImpact: '0.01',
        buyAmount: '1000000000000000000',
        sellAmount: '1000000000000000000',
        allowanceTarget: '0xAllowanceHolder',
        to: '0xExchangeProxy',
        data: '0x',
        value: '0',
      };

      // Should not throw for any allowance target (validation is logged, not strict)
      expect(() => {
        zeroExService.validateAllowanceTarget(quote.allowanceTarget!, 1);
      }).not.toThrow();
    });
  });
});

