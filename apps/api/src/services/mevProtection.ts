import { logger } from '../config/logger';
import type { ZeroXQuote, ZeroXSwapTx } from '@matcha-ai/shared';

/**
 * MEV Protection Service
 * Protects against sandwich attacks, front-running, and other MEV exploits
 */
export class MEVProtection {
  /**
   * Analyze quote for MEV risk
   */
  analyzeMEVRisk(quote: ZeroXQuote, currentPrice: number): {
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

    // Check for suspicious routing (too many hops = potential MEV)
    if (quote.routePlan && quote.routePlan.length > 3) {
      riskLevel = riskLevel === 'low' ? 'medium' : 'high';
      recommendations.push('Complex routing detected - verify quote');
    }

    // Slippage protection
    const slippageBps = quote.slippageBps || 50;
    if (slippageBps > 100) {
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
   */
  applyMEVProtection(
    swapTx: ZeroXSwapTx,
    quote: ZeroXQuote,
    maxSlippageBps: number = 50
  ): ZeroXSwapTx {
    // Ensure slippage is within limits
    const slippageBps = quote.slippageBps || 50;
    if (slippageBps > maxSlippageBps) {
      logger.warn({ slippageBps, maxSlippageBps }, 'Slippage exceeds limit - rejecting');
      throw new Error(`Slippage ${slippageBps}bps exceeds maximum ${maxSlippageBps}bps`);
    }

    // Add deadline to prevent stale transactions
    const deadline = Math.floor(Date.now() / 1000) + 300; // 5 minutes

    // Return protected transaction
    return {
      ...swapTx,
      // Add deadline if supported by protocol
      deadline: deadline.toString(),
    };
  }

  /**
   * Check if transaction is safe from MEV
   */
  isTransactionSafe(quote: ZeroXQuote, maxPriceImpact: number = 1.0): boolean {
    const priceImpact = quote.priceImpactPct 
      ? parseFloat(quote.priceImpactPct) 
      : 0;

    if (priceImpact > maxPriceImpact) {
      logger.warn({ priceImpact, maxPriceImpact }, 'Transaction rejected - high price impact');
      return false;
    }

    const slippageBps = quote.slippageBps || 50;
    if (slippageBps > 100) {
      logger.warn({ slippageBps }, 'Transaction rejected - high slippage');
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


