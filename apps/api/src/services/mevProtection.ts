import { logger } from '../config/logger';
import type { ZeroXQuote, ZeroXSwapTx, MarketContext } from '@matcha-ai/shared';
import { detectVolatilityRegime } from './features';

/**
 * MEV Protection Service
 * Protects against sandwich attacks, front-running, and other MEV exploits
 */
export class MEVProtection {
  /**
   * Analyze quote for MEV risk
   */
  analyzeMEVRisk(quote: ZeroXQuote, currentPrice: number, slippageBps?: number): {
    riskLevel: 'low' | 'medium' | 'high';
    priceImpact: number;
    recommendations: string[];
  } {
    const priceImpact = quote.priceImpactPct 
      ? parseFloat(quote.priceImpactPct) 
      : 0;

    const recommendations: string[] = [];
    let riskLevel: 'low' | 'medium' | 'high' = 'low';

    // High price impact = higher MEV risk
    if (priceImpact > 1.0) {
      riskLevel = 'high';
      recommendations.push('Price impact >1% - consider splitting order or waiting');
    } else if (priceImpact > 0.5) {
      riskLevel = 'medium';
      recommendations.push('Price impact >0.5% - monitor closely');
    }

    // Slippage protection
    const actualSlippageBps = slippageBps || 50;
    if (actualSlippageBps > 100) {
      riskLevel = 'high';
      recommendations.push('High slippage tolerance - reduce or reject');
    }

    return {
      riskLevel,
      priceImpact,
      recommendations,
    };
  }

  /**
   * Apply MEV protection to swap transaction
   * Enhanced with dynamic deadline adjustment and market condition awareness
   */
  applyMEVProtection(
    swapTx: ZeroXSwapTx,
    quote: ZeroXQuote,
    maxSlippageBps: number = 50,
    context?: MarketContext
  ): ZeroXSwapTx {
    // Ensure slippage is within limits
    const slippageBps = quote.slippageBps || 50;
    if (slippageBps > maxSlippageBps) {
      logger.warn({ slippageBps, maxSlippageBps }, 'Slippage exceeds limit - rejecting');
      throw new Error(`Slippage ${slippageBps}bps exceeds maximum ${maxSlippageBps}bps`);
    }

    // Dynamic deadline adjustment based on market conditions
    let deadlineSeconds = 300; // Default 5 minutes
    
    if (context) {
      const volRegime = detectVolatilityRegime(context.recentCandles, context.indicators);
      const volatility = context.indicators.volatility || 0;
      const price = context.recentCandles[context.recentCandles.length - 1]?.close || 1;
      const volatilityPct = price > 0 ? (volatility / price) * 100 : 0;

      // High volatility: Shorter deadline (reduce exposure time)
      if (volRegime === 'high' || volatilityPct > 2.0) {
        deadlineSeconds = 180; // 3 minutes
        logger.debug({ volatilityPct, deadlineSeconds }, 'Reduced deadline due to high volatility');
      }
      // Low volatility: Longer deadline (more time for execution)
      else if (volRegime === 'low' || volatilityPct < 0.5) {
        deadlineSeconds = 600; // 10 minutes
        logger.debug({ volatilityPct, deadlineSeconds }, 'Increased deadline due to low volatility');
      }
    }

    const deadline = Math.floor(Date.now() / 1000) + deadlineSeconds;

    // Return protected transaction
    // Note: deadline would need to be added to ZeroXSwapTx type or handled separately
    return {
      ...swapTx,
      // Deadline would be added to transaction data in production
    };
  }

  /**
   * Predict price impact before execution
   */
  predictPriceImpact(
    quote: ZeroXQuote,
    orderSize: number,
    currentPrice: number,
    liquidity?: number
  ): number {
    // Use quote's price impact if available
    if (quote.estimatedPriceImpact) {
      return parseFloat(quote.estimatedPriceImpact);
    }

    // Estimate price impact based on order size and liquidity
    if (liquidity && liquidity > 0) {
      const sizeRatio = orderSize / liquidity;
      // Simple model: impact = sizeRatio * 2 (linear impact)
      return Math.min(5.0, sizeRatio * 2 * 100); // Cap at 5%
    }

    // Fallback: estimate based on order size
    if (orderSize > 10000) {
      return 1.5; // Large orders: 1.5% impact
    } else if (orderSize > 5000) {
      return 0.8; // Medium orders: 0.8% impact
    } else if (orderSize > 1000) {
      return 0.4; // Small orders: 0.4% impact
    }

    return 0.2; // Very small orders: 0.2% impact
  }

  /**
   * Check for sandwich attack (simplified - would need mempool monitoring in production)
   */
  async checkSandwichAttack(
    quote: ZeroXQuote,
    pendingTransactions?: Array<{ to: string; data: string; value: string }>
  ): Promise<{ detected: boolean; risk: 'low' | 'medium' | 'high'; reason?: string }> {
    // In production, this would:
    // 1. Monitor mempool for pending transactions
    // 2. Check if any transactions target the same pool
    // 3. Detect sandwich patterns (buy before, sell after)

    // For now, simplified check:
    if (pendingTransactions && pendingTransactions.length > 0) {
      // Check if any pending transactions target the same contract
      const quoteTo = quote.to?.toLowerCase();
      const matchingTxs = pendingTransactions.filter(
        (tx) => tx.to?.toLowerCase() === quoteTo
      );

      if (matchingTxs.length > 2) {
        // Multiple transactions targeting same contract = potential sandwich
        return {
          detected: true,
          risk: 'high',
          reason: `Multiple pending transactions detected on same contract (${matchingTxs.length})`,
        };
      } else if (matchingTxs.length > 0) {
        return {
          detected: true,
          risk: 'medium',
          reason: `Pending transaction detected on same contract`,
        };
      }
    }

    return {
      detected: false,
      risk: 'low',
    };
  }

  /**
   * Get private mempool routing recommendation
   * (Placeholder - would integrate with Flashbots, Eden Network, etc.)
   */
  async getPrivateMempoolRouting(
    swapTx: ZeroXSwapTx,
    orderSize: number
  ): Promise<{ usePrivateMempool: boolean; provider?: 'flashbots' | 'eden' }> {
    // Use private mempool for large orders (>$5000) to avoid front-running
    if (orderSize > 5000) {
      logger.info({ orderSize }, 'Recommend using private mempool for large order');
      return {
        usePrivateMempool: true,
        provider: 'flashbots', // Default to Flashbots
      };
    }

    return {
      usePrivateMempool: false,
    };
  }

  /**
   * Check if transaction is safe from MEV
   */
  isTransactionSafe(quote: ZeroXQuote, maxPriceImpact: number = 1.0, slippageBps?: number): boolean {
    const priceImpact = quote.estimatedPriceImpact 
      ? parseFloat(quote.estimatedPriceImpact) 
      : 0;

    if (priceImpact > maxPriceImpact) {
      logger.warn({ priceImpact, maxPriceImpact }, 'Transaction rejected - high price impact');
      return false;
    }

    const actualSlippageBps = slippageBps || 50;
    if (actualSlippageBps > 100) {
      logger.warn({ slippageBps: actualSlippageBps }, 'Transaction rejected - high slippage');
      return false;
    }

    return true;
  }

  /**
   * Get optimal execution strategy to minimize MEV
   */
  getOptimalExecutionStrategy(
    size: number,
    priceImpact: number
  ): {
    strategy: 'immediate' | 'split' | 'twap' | 'delay';
    splits?: number;
    delay?: number;
  } {
    // Large orders should be split
    if (size > 10000 || priceImpact > 0.5) {
      const splits = Math.ceil(priceImpact * 2);
      return {
        strategy: 'split',
        splits: Math.min(splits, 5), // Max 5 splits
      };
    }

    // Medium orders can use TWAP
    if (size > 1000 || priceImpact > 0.2) {
      return {
        strategy: 'twap',
        splits: 3,
      };
    }

    // Small orders can execute immediately
    return {
      strategy: 'immediate',
    };
  }
}

export const mevProtection = new MEVProtection();




