import { priceService } from './priceService';
import { zeroExService } from './zeroExService';
import { solanaService } from './solanaService';
import { calculateRSI, extractIndicatorsSync } from './features';
import { logger } from '../config/logger';
import type { Decision, Candle } from '@matcha-ai/shared';

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
   * Enhanced RSI Mean Reversion signal
   * Focuses on extreme RSI levels (<25 or >75) for higher win rate
   * Adds volume confirmation (only trade if volume > average)
   * Quick profit targets (2-3%) for small account
   * Tight stops (1.5%) to protect capital
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

      // Calculate RSI (focus on extreme levels)
      const rsi = calculateRSI(candles, 14);
      
      // Calculate volume average for confirmation
      const volumes = candles.map((c) => c.volume || 0).filter((v) => v > 0);
      const avgVolume = volumes.length > 0 
        ? volumes.reduce((a, b) => a + b, 0) / volumes.length 
        : 0;
      const currentVolume = candles[candles.length - 1]?.volume || 0;
      const volumeConfirmation = avgVolume > 0 && currentVolume > avgVolume * 0.8; // At least 80% of average

      // Calculate price deviation from mean (for additional confirmation)
      const prices = candles.map((c) => c.close);
      const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
      const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
      const stdDev = Math.sqrt(variance);
      const currentPrice = candles[candles.length - 1]?.close || mean;
      const deviation = (currentPrice - mean) / stdDev;

      // Generate signal based on extreme RSI levels
      // Focus on <25 (oversold) for buys and >75 (overbought) for sells
      if (rsi < 25 && volumeConfirmation) {
        // Extremely oversold with volume confirmation - strong buy signal
        const size = Math.min(0.15, 0.12 + (25 - rsi) * 0.01); // 12-15% position size
        return {
          action: 'buy',
          size,
          rationale: `RSI extremely oversold (${rsi.toFixed(1)}) with volume confirmation. Quick profit target 2-3%, tight stop 1.5%`,
          deviation: -Math.abs(deviation), // Negative for oversold
        };
      } else if (rsi > 75 && volumeConfirmation) {
        // Extremely overbought with volume confirmation - strong sell signal
        const size = Math.min(0.15, 0.12 + (rsi - 75) * 0.01); // 12-15% position size
        return {
          action: 'sell',
          size,
          rationale: `RSI extremely overbought (${rsi.toFixed(1)}) with volume confirmation. Quick profit target 2-3%, tight stop 1.5%`,
          deviation: Math.abs(deviation), // Positive for overbought
        };
      } else if (rsi < 30 && volumeConfirmation) {
        // Moderately oversold - weaker buy signal
        return {
          action: 'buy',
          size: 0.12, // 12% position size
          rationale: `RSI oversold (${rsi.toFixed(1)}) with volume confirmation`,
          deviation: -Math.abs(deviation),
        };
      } else if (rsi > 70 && volumeConfirmation) {
        // Moderately overbought - weaker sell signal
        return {
          action: 'sell',
          size: 0.12, // 12% position size
          rationale: `RSI overbought (${rsi.toFixed(1)}) with volume confirmation`,
          deviation: Math.abs(deviation),
        };
      }

      return {
        action: 'hold',
        size: 0,
        rationale: `RSI neutral (${rsi.toFixed(1)}) or insufficient volume confirmation`,
        deviation: 0,
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
   * Detect Solana arbitrage opportunities using Jupiter API
   * Scans for price differences across Jupiter routes (which aggregates multiple DEXs)
   * Only executes if edge > 1.5% (after fees)
   */
  async detectSolanaArb(
    inputMint: string, // e.g., SOL mint address
    outputMint: string, // e.g., USDC mint address
    minEdge: number = 1.5 // Minimum 1.5% edge after fees
  ): Promise<Decision | null> {
    try {
      // Solana token mint addresses
      const SOL_MINT = 'So11111111111111111111111111111111111111112';
      const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
      
      // Use SOL/USDC as base pair for arbitrage detection
      const baseInputMint = inputMint || SOL_MINT;
      const baseOutputMint = outputMint || USDC_MINT;
      
      // Get quote for forward direction (SOL -> USDC)
      const amount = 1_000_000_000; // 1 SOL (9 decimals)
      const forwardQuote = await solanaService.getJupiterQuote({
        inputMint: baseInputMint,
        outputMint: baseOutputMint,
        amount,
        slippageBps: 50, // 0.5% slippage
      });
      
      // Get quote for reverse direction (USDC -> SOL)
      // Use the output amount from forward quote as input
      const reverseAmount = parseInt(forwardQuote.outAmount);
      const reverseQuote = await solanaService.getJupiterQuote({
        inputMint: baseOutputMint,
        outputMint: baseInputMint,
        amount: reverseAmount,
        slippageBps: 50,
      });
      
      // Calculate round-trip efficiency
      // If we start with 1 SOL, get USDC, then convert back to SOL
      const finalAmount = parseInt(reverseQuote.outAmount);
      const roundTripPct = ((finalAmount - amount) / amount) * 100;
      
      // Also check price impact - if too high, arbitrage may not be profitable
      const priceImpact = parseFloat(forwardQuote.priceImpactPct || '0');
      const reversePriceImpact = parseFloat(reverseQuote.priceImpactPct || '0');
      const totalPriceImpact = priceImpact + reversePriceImpact;
      
      // Calculate net edge after fees and price impact
      // Jupiter charges ~0.3% fee, so we need edge > 1.5% to be profitable
      const netEdge = roundTripPct - totalPriceImpact - 0.6; // 0.6% for fees (0.3% each direction)
      
      if (netEdge >= minEdge) {
        logger.info(
          { 
            netEdge: netEdge.toFixed(2), 
            roundTripPct: roundTripPct.toFixed(2),
            totalPriceImpact: totalPriceImpact.toFixed(2),
            inputMint: baseInputMint,
            outputMint: baseOutputMint,
          },
          'Solana arbitrage opportunity detected'
        );
        
        return {
          action: 'long', // Always long for arbitrage
          confidence: Math.min(0.95, 0.7 + (netEdge / 10)), // Higher edge = higher confidence, max 95%
          targetPositionSizePct: Math.min(0.3, netEdge / 5), // Scale position with edge, up to 30% for arbitrage
          notes: `Solana arbitrage: ${netEdge.toFixed(2)}% net edge detected (${roundTripPct.toFixed(2)}% round-trip, ${totalPriceImpact.toFixed(2)}% price impact)`,
        };
      }
      
      return null;
    } catch (error) {
      logger.error({ error, inputMint, outputMint }, 'Error detecting Solana arbitrage');
      return null;
    }
  }

  /**
   * Convert strategy signal to Decision format
   */
  arbToDecision(arb: ArbOpportunity): Decision {
    return {
      action: 'long', // Always long for arb
      confidence: Math.min(0.95, 0.7 + arb.edge / 10), // Higher edge = higher confidence
      targetPositionSizePct: Math.min(0.3, arb.edge / 5), // Scale position with edge, up to 30% for arbitrage
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

  /**
   * Enhanced Momentum Breakout detection
   * Detects breakouts above 20-period high with volume spike
   * Uses trailing stops (1.5%) to lock in profits
   * Targets 4-6% gains on breakouts
   * Only trades during high volume periods
   */
  async momentumBreakout(
    chainId: number,
    sellToken: string,
    buyToken: string,
    lookbackCandles: number = 20
  ): Promise<Decision> {
    try {
      const to = Date.now();
      const from = to - lookbackCandles * 60 * 60 * 1000; // Assume 1h candles

      const candles = await priceService.getHistoricalPrices(
        chainId,
        sellToken,
        buyToken,
        from,
        to,
        3600
      );

      if (candles.length < 20) {
        return {
          action: 'flat',
          confidence: 0,
          targetPositionSizePct: 0,
          notes: 'Insufficient data for momentum analysis (need 20+ candles)',
        };
      }

      // Get current price and recent candles
      const currentCandle = candles[candles.length - 1];
      const currentPrice = currentCandle.close;
      const currentVolume = currentCandle.volume || 0;
      
      // Calculate 20-period high and low
      const lookbackPeriod = candles.slice(-20, -1); // Exclude current candle
      const periodHigh = Math.max(...lookbackPeriod.map((c) => c.high));
      const periodLow = Math.min(...lookbackPeriod.map((c) => c.low));
      
      // Calculate average volume for volume spike detection
      const volumes = candles.map((c) => c.volume || 0).filter((v) => v > 0);
      const avgVolume = volumes.length > 0 
        ? volumes.reduce((a, b) => a + b, 0) / volumes.length 
        : 0;
      const volumeSpike = avgVolume > 0 && currentVolume > avgVolume * 1.5; // 1.5x average = spike
      
      // Enhanced breakout detection: price breaks above 20-period high with volume spike
      const breakoutAboveHigh = currentPrice > periodHigh * 1.005; // 0.5% above previous high
      const breakdownBelowLow = currentPrice < periodLow * 0.995; // 0.5% below previous low
      
      // Only trade during high volume periods (volume spike required)
      if (!volumeSpike && avgVolume > 0) {
        return {
          action: 'flat',
          confidence: 0.3,
          targetPositionSizePct: 0,
          notes: `No volume spike detected (current: ${currentVolume.toFixed(0)}, avg: ${avgVolume.toFixed(0)})`,
        };
      }

      // Breakout above 20-period high with volume spike = strong long signal
      if (breakoutAboveHigh && volumeSpike) {
        const breakoutPct = ((currentPrice - periodHigh) / periodHigh) * 100;
        return {
          action: 'long',
          confidence: Math.min(0.9, 0.75 + Math.min(breakoutPct / 10, 0.15)), // Higher confidence for larger breakouts
          targetPositionSizePct: Math.min(0.25, 0.15 + Math.min(breakoutPct / 20, 0.1)), // 15-25% position size
          notes: `Momentum breakout: Price broke above 20-period high (${breakoutPct.toFixed(2)}% above ${periodHigh.toFixed(2)}) with volume spike. Target 4-6% gains, trailing stop 1.5%`,
        };
      } 
      
      // Breakdown below 20-period low with volume spike = strong short signal
      if (breakdownBelowLow && volumeSpike) {
        const breakdownPct = ((periodLow - currentPrice) / periodLow) * 100;
        return {
          action: 'short',
          confidence: Math.min(0.9, 0.75 + Math.min(breakdownPct / 10, 0.15)),
          targetPositionSizePct: Math.min(0.25, 0.15 + Math.min(breakdownPct / 20, 0.1)),
          notes: `Momentum breakdown: Price broke below 20-period low (${breakdownPct.toFixed(2)}% below ${periodLow.toFixed(2)}) with volume spike. Target 4-6% gains, trailing stop 1.5%`,
        };
      }

      return {
        action: 'flat',
        confidence: 0.3,
        targetPositionSizePct: 0,
        notes: `No breakout detected (price: ${currentPrice.toFixed(2)}, high: ${periodHigh.toFixed(2)}, low: ${periodLow.toFixed(2)}, volume spike: ${volumeSpike})`,
      };
    } catch (error) {
      logger.error({ error, chainId }, 'Error detecting momentum breakout');
      return {
        action: 'flat',
        confidence: 0,
        targetPositionSizePct: 0,
        notes: 'Error in momentum analysis',
      };
    }
  }

  /**
   * Multi-timeframe confluence analysis
   * Checks alignment across multiple timeframes for stronger signals
   */
  async multiTimeframeConfluence(
    chainId: number,
    sellToken: string,
    buyToken: string
  ): Promise<Decision> {
    try {
      // Analyze multiple timeframes
      const timeframes = [
        { name: '1h', interval: 3600 },
        { name: '4h', interval: 14400 },
        { name: '1d', interval: 86400 },
      ];

      const signals: Array<{ timeframe: string; action: 'long' | 'short' | 'flat'; strength: number }> = [];

      for (const tf of timeframes) {
        const to = Date.now();
        const from = to - 30 * 24 * 60 * 60 * 1000; // 30 days

        const candles = await priceService.getHistoricalPrices(
          chainId,
          sellToken,
          buyToken,
          from,
          to,
          tf.interval
        );

        if (candles.length < 10) continue;

        // Simple trend detection
        const recent = candles.slice(-5);
        const older = candles.slice(-10, -5);
        const recentAvg = recent.reduce((sum, c) => sum + c.close, 0) / recent.length;
        const olderAvg = older.reduce((sum, c) => sum + c.close, 0) / older.length;
        const trend = (recentAvg - olderAvg) / olderAvg;

        if (trend > 0.01) {
          signals.push({ timeframe: tf.name, action: 'long', strength: Math.abs(trend) });
        } else if (trend < -0.01) {
          signals.push({ timeframe: tf.name, action: 'short', strength: Math.abs(trend) });
        } else {
          signals.push({ timeframe: tf.name, action: 'flat', strength: 0 });
        }
      }

      // Count confluence
      const longSignals = signals.filter(s => s.action === 'long').length;
      const shortSignals = signals.filter(s => s.action === 'short').length;
      const avgStrength = signals.reduce((sum, s) => sum + s.strength, 0) / signals.length;

      // Strong confluence = 2+ timeframes agree
      if (longSignals >= 2) {
        return {
          action: 'long',
          confidence: Math.min(0.95, 0.7 + avgStrength * 10),
          targetPositionSizePct: Math.min(0.2, longSignals * 0.05 + avgStrength * 2),
          notes: `Multi-timeframe confluence: ${longSignals}/${signals.length} timeframes bullish`,
        };
      } else if (shortSignals >= 2) {
        return {
          action: 'short',
          confidence: Math.min(0.95, 0.7 + avgStrength * 10),
          targetPositionSizePct: Math.min(0.2, shortSignals * 0.05 + avgStrength * 2),
          notes: `Multi-timeframe confluence: ${shortSignals}/${signals.length} timeframes bearish`,
        };
      }

      return {
        action: 'flat',
        confidence: 0.4,
        targetPositionSizePct: 0,
        notes: `No clear confluence (${longSignals} long, ${shortSignals} short)`,
      };
    } catch (error) {
      logger.error({ error, chainId }, 'Error in multi-timeframe analysis');
      return {
        action: 'flat',
        confidence: 0,
        targetPositionSizePct: 0,
        notes: 'Error in multi-timeframe analysis',
      };
    }
  }

  /**
   * Market regime detection (trending vs ranging)
   */
  async detectRegime(
    chainId: number,
    sellToken: string,
    buyToken: string
  ): Promise<'trending' | 'ranging' | 'volatile'> {
    try {
      const to = Date.now();
      const from = to - 7 * 24 * 60 * 60 * 1000; // 7 days

      const candles = await priceService.getHistoricalPrices(
        chainId,
        sellToken,
        buyToken,
        from,
        to,
        3600
      );

      if (candles.length < 20) return 'volatile';

      // Calculate ATR for volatility
      const atrValues: number[] = [];
      for (let i = 1; i < candles.length; i++) {
        const highLow = candles[i].high - candles[i].low;
        const highClose = Math.abs(candles[i].high - candles[i - 1].close);
        const lowClose = Math.abs(candles[i].low - candles[i - 1].close);
        atrValues.push(Math.max(highLow, highClose, lowClose));
      }
      const avgATR = atrValues.reduce((a, b) => a + b, 0) / atrValues.length;
      const avgPrice = candles.reduce((sum, c) => sum + c.close, 0) / candles.length;
      const volatility = (avgATR / avgPrice) * 100;

      // Calculate trend strength
      const prices = candles.map(c => c.close);
      const firstPrice = prices[0];
      const lastPrice = prices[prices.length - 1];
      const totalMove = Math.abs((lastPrice - firstPrice) / firstPrice) * 100;

      // High volatility = volatile regime
      if (volatility > 5) {
        return 'volatile';
      }

      // Strong directional move = trending
      if (totalMove > 10) {
        return 'trending';
      }

      // Otherwise = ranging
      return 'ranging';
    } catch (error) {
      logger.error({ error, chainId }, 'Error detecting market regime');
      return 'volatile'; // Default to volatile on error
    }
  }
}

export const strategyEngine = new StrategyEngine();

