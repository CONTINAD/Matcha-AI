import { priceService } from './priceService';
import { zeroExService } from './zeroExService';
import { logger } from '../config/logger';
import type { Decision } from '@matcha-ai/shared';

export interface ArbOpportunity {
  chainId: number;
  sellToken: string;
  buyToken: string;
  edge: number; // Percentage edge (e.g., 2.5 = 2.5%)
  sellAmount: string;
  expectedBuyAmount: string;
  guaranteedPrice: string;
}

export interface MeanReversionSignal {
  action: 'buy' | 'sell' | 'hold';
  size: number; // Position size (0-1)
  rationale: string;
  deviation: number; // How many std devs from mean
}

export class StrategyEngine {
  /**
   * Detect arbitrage opportunities across 0x liquidity
   * Scans for >2% edges between tokens
   */
  async detectArb(
    chainId: number,
    baseToken: string,
    targetTokens: string[],
    minEdge: number = 2.0 // Minimum 2% edge
  ): Promise<ArbOpportunity | null> {
    try {
      const sellAmount = '1000000000000000000'; // 1 token (18 decimals)
      const opportunities: ArbOpportunity[] = [];

      // Get quotes for all pairs
      for (const targetToken of targetTokens) {
        try {
          const quote = await zeroExService.getQuote({
            chainId,
            sellToken: baseToken,
            buyToken: targetToken,
            amount: sellAmount,
            slippageBps: 50, // 0.5% slippage
          });

          if (quote && quote.guaranteedPrice) {
            const guaranteedPrice = parseFloat(quote.guaranteedPrice);
            const price = parseFloat(quote.price || '0');

            if (guaranteedPrice > 0 && price > 0) {
              const edge = ((guaranteedPrice - price) / price) * 100;

              if (edge >= minEdge) {
                opportunities.push({
                  chainId,
                  sellToken: baseToken,
                  buyToken: targetToken,
                  edge,
                  sellAmount,
                  expectedBuyAmount: quote.buyAmount || '0',
                  guaranteedPrice: quote.guaranteedPrice,
                });
              }
            }
          }
        } catch (error) {
          logger.warn({ error, chainId, baseToken, targetToken }, 'Failed to get quote for arb check');
        }
      }

      // Return best opportunity
      if (opportunities.length > 0) {
        const best = opportunities.reduce((a, b) => (a.edge > b.edge ? a : b));
        logger.info({ best }, 'Arbitrage opportunity detected');
        return best;
      }

      return null;
    } catch (error) {
      logger.error({ error, chainId }, 'Error detecting arbitrage');
      return null;
    }
  }

  /**
   * Mean reversion signal based on price deviation from mean
   * Buys when price is below mean - 1 std dev
   * Sells when price is above mean + 1 std dev
   */
  async meanReversionSignal(
    chainId: number,
    sellToken: string,
    buyToken: string,
    lookbackDays: number = 30
  ): Promise<MeanReversionSignal> {
    try {
      const to = Date.now();
      const from = to - lookbackDays * 24 * 60 * 60 * 1000;

      // Get historical prices
      const candles = await priceService.getHistoricalPrices(
        chainId,
        sellToken,
        buyToken,
        from,
        to,
        3600 // 1 hour intervals
      );

      if (candles.length < 20) {
        return {
          action: 'hold',
          size: 0,
          rationale: 'Insufficient historical data',
          deviation: 0,
        };
      }

      // Calculate mean and std dev
      const prices = candles.map((c) => c.close);
      const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
      const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
      const stdDev = Math.sqrt(variance);

      // Get current price
      const currentPrice = await priceService.getLivePrice(chainId, sellToken, buyToken);

      // Calculate deviation
      const deviation = (currentPrice - mean) / stdDev;

      // Generate signal
      if (deviation < -1) {
        // Price is >1 std dev below mean - buy
        return {
          action: 'buy',
          size: Math.min(0.1, Math.abs(deviation) * 0.05), // Max 10% position, scale with deviation
          rationale: `Price ${deviation.toFixed(2)} std devs below mean (undervalued)`,
          deviation,
        };
      } else if (deviation > 1) {
        // Price is >1 std dev above mean - sell
        return {
          action: 'sell',
          size: Math.min(0.1, Math.abs(deviation) * 0.05),
          rationale: `Price ${deviation.toFixed(2)} std devs above mean (overvalued)`,
          deviation,
        };
      }

      return {
        action: 'hold',
        size: 0,
        rationale: `Price within normal range (${deviation.toFixed(2)} std devs from mean)`,
        deviation,
      };
    } catch (error) {
      logger.error({ error, chainId, sellToken, buyToken }, 'Error generating mean reversion signal');
      return {
        action: 'hold',
        size: 0,
        rationale: 'Error calculating mean reversion',
        deviation: 0,
      };
    }
  }

  /**
   * Convert strategy signal to Decision format
   */
  arbToDecision(arb: ArbOpportunity): Decision {
    return {
      action: 'long', // Always long for arb
      confidence: Math.min(0.95, 0.7 + arb.edge / 10), // Higher edge = higher confidence
      targetPositionSizePct: Math.min(0.1, arb.edge / 20), // Scale position with edge
      notes: `Arbitrage: ${arb.edge.toFixed(2)}% edge on ${arb.buyToken}`,
    };
  }

  /**
   * Convert mean reversion signal to Decision format
   */
  meanReversionToDecision(signal: MeanReversionSignal): Decision {
    return {
      action: signal.action === 'buy' ? 'long' : signal.action === 'sell' ? 'short' : 'flat',
      confidence: Math.min(0.9, 0.6 + Math.abs(signal.deviation) * 0.1),
      targetPositionSizePct: signal.size,
      notes: signal.rationale,
    };
  }
}

export const strategyEngine = new StrategyEngine();

