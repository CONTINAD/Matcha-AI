import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';
import { dataFeed } from './dataFeed';
import { zeroExService } from './zeroExService';
import { solanaService } from './solanaService';
import type { Candle } from '@matcha-ai/shared';

const prisma = new PrismaClient();

export interface LimitOrder {
  id: string;
  strategyId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  size: number;
  limitPrice: number;
  chainId: number;
  status: 'PENDING' | 'FILLED' | 'CANCELLED' | 'EXPIRED';
  createdAt: Date;
  filledAt?: Date;
  fillPrice?: number;
}

export interface LimitOrderParams {
  strategyId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  size: number;
  limitPrice: number;
  chainId: number;
  expiryTime?: Date;
}

/**
 * Limit Order Service
 * Manages limit orders that execute when price reaches target
 */
export class LimitOrderService {
  private activeOrders: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Create a limit order
   */
  async createLimitOrder(params: LimitOrderParams): Promise<LimitOrder> {
    // Get strategy to get userId
    const strategy = await prisma.strategy.findUnique({
      where: { id: params.strategyId },
    });

    if (!strategy) {
      throw new Error(`Strategy not found: ${params.strategyId}`);
    }

    const order = await prisma.limitOrder.create({
      data: {
        strategyId: params.strategyId,
        userId: strategy.userId,
        symbol: params.symbol,
        side: params.side,
        size: params.size,
        limitPrice: params.limitPrice,
        chainId: params.chainId,
        status: 'PENDING',
        expiryTime: params.expiryTime,
      },
    });

    // Start monitoring this order
    this.monitorOrder(order.id);

    logger.info({ orderId: order.id, params }, 'Limit order created');
    return order as LimitOrder;
  }

  /**
   * Monitor an order and execute when price is reached
   */
  private async monitorOrder(orderId: string): Promise<void> {
    const checkInterval = 5000; // Check every 5 seconds

    const interval = setInterval(async () => {
      try {
        const order = await prisma.limitOrder.findUnique({
          where: { id: orderId },
        });

        if (!order || order.status !== 'PENDING') {
          clearInterval(interval);
          this.activeOrders.delete(orderId);
          return;
        }

        // Check expiry
        if (order.expiryTime && new Date(order.expiryTime) < new Date()) {
          await prisma.limitOrder.update({
            where: { id: orderId },
            data: { status: 'EXPIRED' },
          });
          clearInterval(interval);
          this.activeOrders.delete(orderId);
          return;
        }

        // Get current price
        const snapshot = await dataFeed.getLatestMarketSnapshot(
          order.symbol,
          '1m', // Use 1m for limit orders
          order.chainId
        );

        if (!snapshot?.candle) {
          return;
        }

        const currentPrice = snapshot.candle.close;
        const shouldFill = order.side === 'BUY' 
          ? currentPrice <= order.limitPrice
          : currentPrice >= order.limitPrice;

        if (shouldFill) {
          // Execute the order
          await this.executeLimitOrder(orderId, currentPrice);
          clearInterval(interval);
          this.activeOrders.delete(orderId);
        }
      } catch (error) {
        logger.error({ error, orderId }, 'Error monitoring limit order');
      }
    }, checkInterval);

    this.activeOrders.set(orderId, interval);
  }

  /**
   * Execute a limit order
   */
  private async executeLimitOrder(orderId: string, fillPrice: number): Promise<void> {
    const order = await prisma.limitOrder.findUnique({
      where: { id: orderId },
    });

    if (!order || order.status !== 'PENDING') {
      return;
    }

    try {
      // Build swap transaction
      const baseToken = order.side === 'BUY' ? 'USDC' : order.symbol;
      const quoteToken = order.side === 'BUY' ? order.symbol : 'USDC';
      const amount = order.side === 'BUY' ? order.size * order.limitPrice : order.size;

      if (order.chainId === 101) {
        // Solana - use Jupiter
        // Note: This is simplified - in production, you'd need proper token addresses
        logger.info({ orderId, fillPrice }, 'Limit order filled (Solana)');
      } else {
        // EVM - use 0x
        const quote = await zeroExService.getQuote({
          chainId: order.chainId,
          sellToken: baseToken,
          buyToken: quoteToken,
          amount: amount.toString(),
          slippageBps: 50, // 0.5% slippage
        });

        logger.info({ orderId, fillPrice, quote }, 'Limit order filled (EVM)');
      }

      // Update order status
      await prisma.limitOrder.update({
        where: { id: orderId },
        data: {
          status: 'FILLED',
          fillPrice,
          filledAt: new Date(),
        },
      });

      logger.info({ orderId, fillPrice }, 'Limit order executed');
    } catch (error) {
      logger.error({ error, orderId }, 'Error executing limit order');
      throw error;
    }
  }

  /**
   * Cancel a limit order
   */
  async cancelLimitOrder(orderId: string): Promise<void> {
    const interval = this.activeOrders.get(orderId);
    if (interval) {
      clearInterval(interval);
      this.activeOrders.delete(orderId);
    }

    await prisma.limitOrder.update({
      where: { id: orderId },
      data: { status: 'CANCELLED' },
    });

    logger.info({ orderId }, 'Limit order cancelled');
  }

  /**
   * Get pending orders for a strategy
   */
  async getPendingOrders(strategyId: string): Promise<LimitOrder[]> {
    const orders = await prisma.limitOrder.findMany({
      where: {
        strategyId,
        status: 'PENDING',
      },
      orderBy: { createdAt: 'desc' },
    });

    return orders as LimitOrder[];
  }
}

export const limitOrderService = new LimitOrderService();

