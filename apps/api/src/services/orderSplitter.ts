import type { ZeroXQuoteParams, ZeroXSwapTx } from '@matcha-ai/shared';
import { logger } from '../config/logger';
import { executionEngine } from './executionEngine';

export interface SplitOrder {
  quoteParams: ZeroXQuoteParams;
  size: number; // Size of this chunk
  delay: number; // Delay before executing (ms)
}

export interface SplitOrderConfig {
  minOrderSize?: number; // Default: $1000 (orders above this get split)
  numChunks?: number; // Default: 3-5 chunks
  timeWindow?: number; // Default: 30-60 seconds (TWAP window)
}

/**
 * Order Splitter
 * 
 * Splits large orders for TWAP execution:
 * - Split orders >$1000 into 3-5 chunks
 * - Execute with TWAP (Time-Weighted Average Price) over 30-60 seconds
 * - Reduces price impact and MEV risk
 */
export class OrderSplitter {
  private readonly DEFAULT_MIN_ORDER_SIZE = 1000; // $1000
  private readonly DEFAULT_NUM_CHUNKS = 4;
  private readonly DEFAULT_TIME_WINDOW_MS = 45000; // 45 seconds

  /**
   * Check if order should be split
   */
  shouldSplitOrder(orderSize: number, price: number, config: SplitOrderConfig = {}): boolean {
    const minOrderSize = config.minOrderSize || this.DEFAULT_MIN_ORDER_SIZE;
    const orderValue = orderSize * price;
    return orderValue > minOrderSize;
  }

  /**
   * Split order into chunks for TWAP execution
   */
  splitOrder(
    quoteParams: ZeroXQuoteParams,
    orderSize: number,
    price: number,
    config: SplitOrderConfig = {}
  ): SplitOrder[] {
    const numChunks = config.numChunks || this.DEFAULT_NUM_CHUNKS;
    const timeWindow = config.timeWindow || this.DEFAULT_TIME_WINDOW_MS;
    const chunkDelay = timeWindow / numChunks; // Delay between chunks

    const chunkSize = orderSize / numChunks;
    const chunks: SplitOrder[] = [];

    for (let i = 0; i < numChunks; i++) {
      // Calculate chunk amount (in wei/smallest unit)
      const chunkAmount = Math.floor(parseFloat(quoteParams.amount) / numChunks).toString();

      chunks.push({
        quoteParams: {
          ...quoteParams,
          amount: chunkAmount,
        },
        size: chunkSize,
        delay: i * chunkDelay,
      });
    }

    logger.info(
      {
        originalSize: orderSize,
        numChunks,
        chunkSize,
        timeWindow,
        chunkDelay,
      },
      'Split order into chunks for TWAP execution'
    );

    return chunks;
  }

  /**
   * Execute split order with TWAP
   */
  async executeSplitOrder(
    chunks: SplitOrder[],
    onChunkExecuted?: (chunk: SplitOrder, result: any) => void
  ): Promise<Array<{ chunk: SplitOrder; result: any; error?: Error }>> {
    const results: Array<{ chunk: SplitOrder; result: any; error?: Error }> = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      // Wait for delay (except first chunk)
      if (i > 0 && chunk.delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, chunk.delay));
      }

      try {
        logger.info(
          {
            chunkIndex: i + 1,
            totalChunks: chunks.length,
            delay: chunk.delay,
            size: chunk.size,
          },
          `Executing chunk ${i + 1}/${chunks.length}`
        );

        // Execute chunk
        const result = await executionEngine.executeTrade(chunk.quoteParams);

        results.push({ chunk, result });

        if (onChunkExecuted) {
          onChunkExecuted(chunk, result);
        }

        logger.info(
          {
            chunkIndex: i + 1,
            totalChunks: chunks.length,
            source: result.source,
            latency: result.latency,
          },
          `Chunk ${i + 1}/${chunks.length} executed successfully`
        );
      } catch (error: any) {
        logger.error(
          {
            chunkIndex: i + 1,
            totalChunks: chunks.length,
            error: error.message,
          },
          `Chunk ${i + 1}/${chunks.length} execution failed`
        );

        results.push({ chunk, result: null, error });

        // Continue with next chunk even if one fails
      }
    }

    const successful = results.filter((r) => !r.error).length;
    logger.info(
      {
        totalChunks: chunks.length,
        successful,
        failed: chunks.length - successful,
      },
      'Split order execution completed'
    );

    return results;
  }

  /**
   * Calculate optimal number of chunks based on order size
   */
  calculateOptimalChunks(orderSize: number, price: number): number {
    const orderValue = orderSize * price;

    // Larger orders = more chunks
    if (orderValue > 10000) {
      return 5; // Very large orders: 5 chunks
    } else if (orderValue > 5000) {
      return 4; // Large orders: 4 chunks
    } else if (orderValue > 2000) {
      return 3; // Medium orders: 3 chunks
    }

    return 2; // Small orders: 2 chunks
  }

  /**
   * Calculate optimal time window based on order size and volatility
   */
  calculateOptimalTimeWindow(orderSize: number, price: number, volatility?: number): number {
    const orderValue = orderSize * price;
    const baseWindow = 30000; // 30 seconds base

    // Larger orders = longer window
    if (orderValue > 10000) {
      return 60000; // 60 seconds for very large orders
    } else if (orderValue > 5000) {
      return 45000; // 45 seconds for large orders
    }

    // Adjust for volatility
    if (volatility && volatility > 0.02) {
      // High volatility: shorter window to reduce risk
      return Math.max(20000, baseWindow * 0.7);
    }

    return baseWindow;
  }
}

export const orderSplitter = new OrderSplitter();

