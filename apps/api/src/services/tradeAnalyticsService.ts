import axios, { AxiosError } from 'axios';
import { PrismaClient } from '@prisma/client';
import { config } from '../config/env';
import { logger } from '../config/logger';
import type { ExecutionQuality, TradeAnalytics } from '@matcha-ai/shared';
import { getChainConfig } from '@matcha-ai/shared';
import { transactionTracker } from './transactionTracker';

const prisma = new PrismaClient();

export interface TradeAnalyticsApiResponse {
  txHash: string;
  chainId: number;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  buyAmount: string;
  price: string;
  slippageBps: number;
  fillRate: number;
  executionTimeMs: number;
  gasUsed?: string;
  gasPrice?: string;
  priceImpact?: string;
}

export class TradeAnalyticsService {
  private apiKey: string;

  constructor() {
    this.apiKey = config.zeroX.apiKey;
  }

  /**
   * Get trade analytics from 0x Trade Analytics API
   * This should be called after a trade is confirmed
   */
  async getTradeAnalyticsFromApi(txHash: string, chainId: number): Promise<TradeAnalyticsApiResponse | null> {
    const chainConfig = getChainConfig(chainId);
    if (!chainConfig?.zeroXApiUrl) {
      logger.warn({ chainId, txHash }, '0x API URL not configured for chain - skipping analytics');
      return null;
    }

    if (!this.apiKey) {
      logger.warn({ txHash }, '0x API key not configured - skipping analytics');
      return null;
    }

    try {
      // 0x Trade Analytics API endpoint
      // Note: The actual endpoint may vary - this is a placeholder based on 0x API structure
      const endpoint = `${chainConfig.zeroXApiUrl}/trade-analytics/v1/trade`;

      const response = await axios.get<TradeAnalyticsApiResponse>(endpoint, {
        params: {
          txHash,
          chainId,
        },
        headers: {
          '0x-api-key': this.apiKey,
          '0x-version': 'v1',
        },
        timeout: 10000,
      });

      if (!response.data) {
        logger.warn({ txHash, chainId }, 'No analytics data returned from 0x API');
        return null;
      }

      logger.info({ txHash, chainId, slippageBps: response.data.slippageBps }, 'Trade analytics retrieved from 0x API');

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<{ reason?: string; code?: string }>;

        // 404 means trade not found in analytics (might be too new)
        if (axiosError.response?.status === 404) {
          logger.debug({ txHash, chainId }, 'Trade not found in analytics API (may be too new)');
          return null;
        }

        logger.error(
          {
            error: axiosError.response?.data,
            status: axiosError.response?.status,
            txHash,
            chainId,
          },
          'Error fetching trade analytics from 0x API'
        );
      } else {
        logger.error({ error, txHash, chainId }, 'Unknown error fetching trade analytics');
      }

      // Don't throw - analytics is optional
      return null;
    }
  }

  /**
   * Calculate execution quality from trade data
   * Compares expected vs actual execution
   */
  async calculateExecutionQuality(
    tradeId: string,
    expectedPrice: string,
    expectedBuyAmount: string
  ): Promise<ExecutionQuality | null> {
    const trade = await prisma.trade.findUnique({
      where: { id: tradeId },
      include: { 
        strategy: {
          select: {
            chainId: true,
          },
        },
      },
    });

    if (!trade || !trade.txHash) {
      logger.warn({ tradeId }, 'Trade not found or no txHash - cannot calculate execution quality');
      return null;
    }

    const txInfo = await transactionTracker.getTransactionInfo(trade.txHash);
    if (!txInfo || txInfo.status !== 'CONFIRMED') {
      logger.debug({ tradeId, txHash: trade.txHash }, 'Transaction not confirmed - cannot calculate execution quality');
      return null;
    }

    // Get chainId once
    const chainId = trade.strategy?.chainId || 1; // Default to Ethereum if not found

    // Get analytics from 0x API
    const analytics = await this.getTradeAnalyticsFromApi(trade.txHash, chainId);

    if (analytics) {
      // Use analytics data if available
      const executionQuality: ExecutionQuality = {
        expectedPrice,
        actualPrice: analytics.price,
        slippageBps: analytics.slippageBps,
        fillRate: analytics.fillRate,
        executionTimeMs: analytics.executionTimeMs,
        gasUsed: analytics.gasUsed,
        gasPrice: analytics.gasPrice,
        priceImpact: analytics.priceImpact,
      };

      // Store in database
      await this.storeTradeAnalytics(tradeId, chainId, trade.txHash, analytics, executionQuality);

      return executionQuality;
    }

    // Fallback: Calculate from trade data if analytics not available
    const actualPrice = trade.exitPrice ? trade.exitPrice.toString() : trade.entryPrice.toString();
    const actualBuyAmount = (trade.size * parseFloat(actualPrice)).toString();
    const slippageBps = this.calculateSlippage(expectedPrice, actualPrice);

    // Estimate execution time from transaction timestamps
    const executionTimeMs = txInfo.confirmedAt && txInfo.submittedAt
      ? txInfo.confirmedAt.getTime() - txInfo.submittedAt.getTime()
      : 0;

    const executionQuality: ExecutionQuality = {
      expectedPrice,
      actualPrice,
      slippageBps,
      fillRate: 1.0, // Assume full fill if no analytics
      executionTimeMs,
      gasUsed: txInfo.gasUsed,
      gasPrice: txInfo.gasPrice,
    };

    // Store basic analytics (chainId already defined above)
    await prisma.tradeAnalytics.create({
        data: {
          tradeId,
          strategyId: trade.strategyId,
          chainId,
          txHash: trade.txHash,
        expectedPrice,
        actualPrice,
        slippageBps,
        fillRate: 1.0,
        executionTimeMs,
        gasUsed: txInfo.gasUsed,
        gasPrice: txInfo.gasPrice,
        sellToken: trade.symbol, // Simplified - should use actual token addresses
        buyToken: trade.symbol,
        sellAmount: trade.size.toString(),
        buyAmount: actualBuyAmount,
      },
    });

    return executionQuality;
  }

  /**
   * Store trade analytics in database
   */
  private async storeTradeAnalytics(
    tradeId: string,
    chainId: number,
    txHash: string,
    analytics: TradeAnalyticsApiResponse,
    executionQuality: ExecutionQuality
  ): Promise<void> {
    try {
      await prisma.tradeAnalytics.upsert({
        where: { tradeId },
        create: {
          tradeId,
          strategyId: (await prisma.trade.findUnique({ where: { id: tradeId } }))?.strategyId || '',
          chainId,
          txHash,
          expectedPrice: executionQuality.expectedPrice,
          actualPrice: executionQuality.actualPrice,
          slippageBps: executionQuality.slippageBps,
          fillRate: executionQuality.fillRate,
          executionTimeMs: executionQuality.executionTimeMs,
          gasUsed: executionQuality.gasUsed,
          gasPrice: executionQuality.gasPrice,
          priceImpact: executionQuality.priceImpact,
          sellToken: analytics.sellToken,
          buyToken: analytics.buyToken,
          sellAmount: analytics.sellAmount,
          buyAmount: analytics.buyAmount,
        },
        update: {
          actualPrice: executionQuality.actualPrice,
          slippageBps: executionQuality.slippageBps,
          fillRate: executionQuality.fillRate,
          executionTimeMs: executionQuality.executionTimeMs,
          gasUsed: executionQuality.gasUsed,
          gasPrice: executionQuality.gasPrice,
          priceImpact: executionQuality.priceImpact,
        },
      });

      // Update trade with execution quality
      await prisma.trade.update({
        where: { id: tradeId },
        data: {
          executionQuality: this.calculateQualityScore(executionQuality),
          actualSlippage: executionQuality.slippageBps,
          fillRate: executionQuality.fillRate,
        },
      });

      logger.info({ tradeId, txHash, slippageBps: executionQuality.slippageBps }, 'Trade analytics stored');
    } catch (error) {
      logger.error({ error, tradeId, txHash }, 'Error storing trade analytics');
      throw error;
    }
  }

  /**
   * Calculate overall execution quality score (0-1)
   */
  private calculateQualityScore(quality: ExecutionQuality): number {
    // Score based on slippage, fill rate, and execution time
    // Lower slippage = higher score
    // Higher fill rate = higher score
    // Faster execution = higher score

    const slippageScore = Math.max(0, 1 - quality.slippageBps / 10000); // 0-1, where 0 slippage = 1.0
    const fillRateScore = quality.fillRate; // Already 0-1
    const timeScore = Math.max(0, 1 - quality.executionTimeMs / 60000); // 0-1, where <1min = 1.0

    // Weighted average
    return (slippageScore * 0.5 + fillRateScore * 0.3 + timeScore * 0.2);
  }

  /**
   * Calculate slippage between expected and actual price
   */
  private calculateSlippage(expectedPrice: string, actualPrice: string): number {
    const expected = parseFloat(expectedPrice);
    const actual = parseFloat(actualPrice);

    if (expected === 0) {
      return 0;
    }

    const slippagePct = ((actual - expected) / expected) * 100;
    return Math.round(slippagePct * 100); // Convert to basis points
  }

  /**
   * Get analytics for a specific trade
   */
  async getTradeAnalytics(tradeId: string): Promise<TradeAnalytics | null> {
    const analytics = await prisma.tradeAnalytics.findUnique({
      where: { tradeId },
    });

    if (!analytics) {
      return null;
    }

    return {
      tradeId: analytics.tradeId,
      strategyId: analytics.strategyId,
      executionQuality: {
        expectedPrice: analytics.expectedPrice,
        actualPrice: analytics.actualPrice,
        slippageBps: analytics.slippageBps,
        fillRate: analytics.fillRate,
        executionTimeMs: analytics.executionTimeMs,
        gasUsed: analytics.gasUsed || undefined,
        gasPrice: analytics.gasPrice || undefined,
        priceImpact: analytics.priceImpact || undefined,
      },
      timestamp: analytics.timestamp.getTime(),
      chainId: analytics.chainId,
      txHash: analytics.txHash,
      sellToken: analytics.sellToken,
      buyToken: analytics.buyToken,
      sellAmount: analytics.sellAmount,
      buyAmount: analytics.buyAmount,
    };
  }

  /**
   * Get analytics for a strategy
   */
  async getStrategyAnalytics(strategyId: string, limit: number = 100): Promise<TradeAnalytics[]> {
    const analytics = await prisma.tradeAnalytics.findMany({
      where: { strategyId },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    return analytics.map((a) => ({
      tradeId: a.tradeId,
      strategyId: a.strategyId,
      executionQuality: {
        expectedPrice: a.expectedPrice,
        actualPrice: a.actualPrice,
        slippageBps: a.slippageBps,
        fillRate: a.fillRate,
        executionTimeMs: a.executionTimeMs,
        gasUsed: a.gasUsed || undefined,
        gasPrice: a.gasPrice || undefined,
        priceImpact: a.priceImpact || undefined,
      },
      timestamp: a.timestamp.getTime(),
      chainId: a.chainId,
      txHash: a.txHash,
      sellToken: a.sellToken,
      buyToken: a.buyToken,
      sellAmount: a.sellAmount,
      buyAmount: a.buyAmount,
    }));
  }
}

export const tradeAnalyticsService = new TradeAnalyticsService();

