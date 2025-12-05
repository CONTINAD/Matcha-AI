import type {
  Candle,
  MarketContext,
  Decision,
  StrategyConfig,
  PerformanceMetrics,
  Position,
  Trade,
  RiskLimits,
} from '@matcha-ai/shared';
import { extractIndicatorsSync, detectTrendRegime, detectVolatilityRegime, detectRSIRegime } from './features';
import { calculateMaxDrawdown, calculateSharpe } from '@matcha-ai/shared';
import { logger } from '../config/logger';
import { matchaBrain } from './matchaBrain';
import { riskManager } from './riskManager';
import { strategySelector } from './strategySelector';
import { aiValidator } from './aiValidator';

export interface DecisionOptions {
  aiMode?: 'OFF' | 'ASSIST' | 'FULL';
  strategyId?: string;
  historicalDecisions?: Array<{ decision: Decision; outcome?: 'win' | 'loss' | 'neutral' }>;
}

/**
 * Unified Decision Engine
 * 
 * Provides a single entry point for trading decisions across backtest, paper, and live modes.
 * Uses rule-based fast decisions as primary, with optional AI assistance.
 */
export class DecisionEngine {
  /**
   * Build MarketContext consistently across all modes
   */
  buildContext(
    recentCandles: Candle[],
    positions: Position[],
    trades: Trade[],
    equity: number,
    dailyPnl: number,
    riskLimits: RiskLimits,
    equityCurve?: number[],
    returns?: number[]
  ): MarketContext {
    const realizedPnl = trades.filter((t) => t.exitPrice).reduce((sum, t) => sum + t.pnl, 0);
    const closedTrades = trades.filter((t) => t.exitPrice);
    const winRate =
      closedTrades.length > 0
        ? closedTrades.filter((t) => t.pnl > 0).length / closedTrades.length
        : 0;

    const performance: PerformanceMetrics = {
      realizedPnl,
      maxDrawdown: equityCurve && equityCurve.length > 0 ? calculateMaxDrawdown(equityCurve) : 0,
      winRate,
      sharpe: returns && returns.length > 0 ? calculateSharpe(returns) : undefined,
      totalTrades: trades.length,
      winningTrades: closedTrades.filter((t) => t.pnl > 0).length,
      losingTrades: closedTrades.filter((t) => t.pnl < 0).length,
    };

    return {
      recentCandles: recentCandles.slice(-20), // Last 20 candles for consistency
      indicators: {}, // Will be populated by extractIndicatorsSync
      openPositions: positions,
      performance,
      riskLimits,
      currentEquity: equity,
      dailyPnl,
    };
  }

  /**
   * Fast rule-based decision (no AI)
   * 
   * Uses multiple technical indicators:
   * - RSI: Momentum and overbought/oversold conditions
   * - EMA/SMA: Trend direction and strength
   * - MACD: Momentum confirmation
   * - Bollinger Bands: Volatility and mean reversion
   * - ADX: Trend strength
   * - Price Momentum: Recent price action
   */
  getFastDecision(context: MarketContext, indicators: any): Decision {
    const rsi = indicators?.rsi;
    const ema20 = indicators?.ema20;
    const ema50 = indicators?.ema50;
    const sma20 = indicators?.sma20;
    const sma50 = indicators?.sma50;
    const macd = indicators?.macd;
    const macdSignal = indicators?.macdSignal;
    const macdHistogram = indicators?.macdHistogram;
    const bbUpper = indicators?.bollingerUpper || indicators?.bbUpper;
    const bbLower = indicators?.bollingerLower || indicators?.bbLower;
    const bbMiddle = indicators?.bollingerMiddle || indicators?.bbMiddle;
    const adx = indicators?.adx;
    const price = context.recentCandles[context.recentCandles.length - 1]?.close || 0;
    const candles = context.recentCandles;

    // Detect market regimes (CRITICAL: Must be called before using regime variables)
    const trendRegime = detectTrendRegime(candles, indicators);
    const volRegime = detectVolatilityRegime(candles, indicators);
    const rsiRegime = detectRSIRegime(rsi);

    let action: 'long' | 'short' | 'flat' = 'flat';
    let confidence = 0.3;
    let signalStrength = 0;

    // Use EMA or SMA, whichever is available
    const shortMA = ema20 || sma20;
    const longMA = ema50 || sma50;

    if (price > 0 && shortMA && longMA) {
      // 1. TREND SIGNAL (Strongest signal)
      const bullishTrend = shortMA > longMA;
      const bearishTrend = shortMA < longMA;
      const trendStrength = Math.abs((shortMA - longMA) / longMA);

      if (bullishTrend && trendStrength > 0.005) {
        // 0.5% separation minimum
        signalStrength += 3;
      } else if (bearishTrend && trendStrength > 0.005) {
        signalStrength -= 3;
      }

      // 2. RSI MOMENTUM (Confirms trend)
      if (rsi) {
        if (bullishTrend && rsi > 50 && rsi < 70) {
          // Not overbought, but strong
          signalStrength += 2;
        } else if (bullishTrend && rsi > 40 && rsi < 50) {
          // Building momentum
          signalStrength += 1;
        } else if (bearishTrend && rsi < 50 && rsi > 30) {
          // Not oversold, but weak
          signalStrength -= 2;
        } else if (bearishTrend && rsi < 60 && rsi > 50) {
          // Losing momentum
          signalStrength -= 1;
        }

        // Avoid extreme RSI (overbought/oversold reversals)
        if (rsi > 75) signalStrength -= 2; // Overbought - avoid longs
        if (rsi < 25) signalStrength += 2; // Oversold - avoid shorts
      }

      // 3. MACD CROSSOVER (Momentum confirmation)
      if (macd && macdSignal && macdHistogram) {
        if (macd > macdSignal && macdHistogram > 0) {
          // Bullish MACD
          signalStrength += 2;
        } else if (macd < macdSignal && macdHistogram < 0) {
          // Bearish MACD
          signalStrength -= 2;
        }
      }

      // 4. BOLLINGER BANDS (Volatility and mean reversion)
      // Regime-based: Use mean reversion in ranging markets, trend following in trending markets
      if (bbUpper && bbLower && bbMiddle) {
        const bbPosition = (price - bbLower) / (bbUpper - bbLower);
        
        if (trendRegime === 'ranging') {
          // Ranging: Mean reversion signals
          if (bbPosition < 0.3 && rsiRegime === 'oversold') {
            // Near lower band + oversold RSI = strong buy signal
            signalStrength += 2.5; // Increased from 1.5
          } else if (bbPosition > 0.7 && rsiRegime === 'overbought') {
            // Near upper band + overbought RSI = strong sell signal
            signalStrength -= 2.5; // Increased from -1.5
          }
        } else if (trendRegime === 'trending') {
          // Trending: Trend continuation signals
          if (bullishTrend && bbPosition < 0.3 && price < bbMiddle) {
            // Near lower band in uptrend = pullback buy
            signalStrength += 1.5;
          } else if (bearishTrend && bbPosition > 0.7 && price > bbMiddle) {
            // Near upper band in downtrend = pullback sell
            signalStrength -= 1.5;
          }
        } else {
          // Choppy: Use original logic but reduced
          if (bullishTrend && bbPosition < 0.3 && price < bbMiddle) {
            signalStrength += 1;
          } else if (bearishTrend && bbPosition > 0.7 && price > bbMiddle) {
            signalStrength -= 1;
          }
        }
      }

      // 5. ADX (Trend strength - only trade in strong trends)
      if (adx) {
        if (adx > 25) {
          // Strong trend
          signalStrength *= 1.2; // Boost all signals
        } else if (adx < 20) {
          // Weak trend
          signalStrength *= 0.7; // Reduce signals in choppy markets
        }
      }

      // 6. PRICE MOMENTUM (Recent price action)
      if (candles.length >= 3) {
        const recent = candles.slice(-3);
        const momentum = (recent[2].close - recent[0].close) / recent[0].close;
        if (momentum > 0.02 && bullishTrend) {
          // 2%+ momentum up
          signalStrength += 1;
        } else if (momentum < -0.02 && bearishTrend) {
          // 2%+ momentum down
          signalStrength -= 1;
        }
      }

      // Convert signal strength to action and confidence
      // Regime-based thresholds
      let minSignalStrength = 3;
      if (trendRegime === 'trending' && volRegime !== 'high') {
        // Trending markets: Lower threshold for entry
        minSignalStrength = 2.5;
      } else if (trendRegime === 'ranging') {
        // Ranging markets: Require stronger signals
        minSignalStrength = 3.5;
      } else if (trendRegime === 'choppy' || volRegime === 'high') {
        // Choppy/high volatility: Much higher threshold or stay flat
        minSignalStrength = 5;
      }
      
      if (signalStrength >= minSignalStrength) {
        action = 'long';
        // Scale confidence based on signal strength and regime
        const baseConfidence = 0.4 + (signalStrength - minSignalStrength) * 0.15;
        // Boost confidence in trending markets
        const regimeBoost = trendRegime === 'trending' ? 1.1 : 1.0;
        confidence = Math.min(0.85, baseConfidence * regimeBoost);
      } else if (signalStrength <= -minSignalStrength) {
        action = 'short';
        const baseConfidence = 0.4 + (Math.abs(signalStrength) - minSignalStrength) * 0.15;
        const regimeBoost = trendRegime === 'trending' ? 1.1 : 1.0;
        confidence = Math.min(0.85, baseConfidence * regimeBoost);
      } else {
        // Weak signal - stay flat (especially in choppy markets)
        action = 'flat';
        confidence = trendRegime === 'choppy' ? 0.1 : 0.2;
      }

      // Adjust confidence based on recent performance
      const totalTrades = context.performance.totalTrades || 0;
      if (context.performance.winRate > 0.55 && totalTrades > 10) {
        confidence = Math.min(0.9, confidence * 1.15); // Boost if winning
      } else if (context.performance.winRate < 0.45 && totalTrades > 10) {
        confidence = Math.max(0.3, confidence * 0.85); // Reduce if losing
      }

      // Additional filter: Only take trades if we have enough indicators confirming
      const indicatorsPresent = [rsi, shortMA, longMA, macd, bbUpper, bbLower].filter(Boolean).length;
      if (indicatorsPresent < 3 && action !== 'flat') {
        // Need at least 3 indicators to confirm
        action = 'flat';
        confidence = 0.2;
      }
    } else if (price > 0 && candles.length >= 5) {
      // Fallback: Enhanced price momentum with multiple candles
      const recent = candles.slice(-5);
      const shortMomentum = (recent[4].close - recent[2].close) / recent[2].close;
      const longMomentum = (recent[4].close - recent[0].close) / recent[0].close;

      if (shortMomentum > 0.015 && longMomentum > 0.01) {
        // Consistent upward momentum
        action = 'long';
        confidence = 0.5;
      } else if (shortMomentum < -0.015 && longMomentum < -0.01) {
        // Consistent downward momentum
        action = 'short';
        confidence = 0.5;
      }
    }

    // Ensure minimum confidence for taking trades
    if (action !== 'flat' && confidence < 0.4) {
      action = 'flat';
      confidence = 0.2;
    }

    return {
      action,
      confidence,
      targetPositionSizePct: confidence * (context.riskLimits?.maxPositionPct || 10),
      notes: `Fast decision: signal strength ${signalStrength.toFixed(1)}, ${action} with ${(confidence * 100).toFixed(0)}% confidence`,
    };
  }

  /**
   * Combine fast decision with AI decision
   * 
   * - Rejects AI ideas that violate risk limits
   * - Blends position sizes intelligently
   * - Prefers fast decision if confidence is similar
   * - Validates AI decision using AIValidator
   */
  combineFastAndAI(
    fastDecision: Decision,
    aiDecision: Decision,
    strategyConfig: StrategyConfig,
    context?: MarketContext
  ): Decision {
    // Validate AI decision using AIValidator
    if (context) {
      const validation = aiValidator.validateDecision(aiDecision, context, strategyConfig.riskLimits);
      if (!validation.valid) {
        logger.warn(
          {
            reason: validation.reason,
            aiDecision: aiDecision.action,
            confidence: aiDecision.confidence,
          },
          'AI decision rejected by validator'
        );
        return fastDecision;
      }
      
      // Use adjusted decision if validator modified it
      if (validation.adjustedDecision) {
        aiDecision = validation.adjustedDecision;
      }
    }
    
    // Reject AI decision if it violates risk limits (fallback check)
    if (aiDecision.targetPositionSizePct > (strategyConfig.riskLimits.maxPositionPct || 10)) {
      logger.warn(
        {
          aiPositionSize: aiDecision.targetPositionSizePct,
          maxAllowed: strategyConfig.riskLimits.maxPositionPct,
        },
        'AI decision rejected: exceeds max position size'
      );
      return fastDecision;
    }

    // If fast decision is flat and AI suggests action, use AI (with caution)
    if (fastDecision.action === 'flat' && aiDecision.action !== 'flat') {
      // Reduce AI confidence by 20% when fast is flat
      return {
        ...aiDecision,
        confidence: aiDecision.confidence * 0.8,
        targetPositionSizePct: Math.min(
          aiDecision.targetPositionSizePct * 0.8,
          strategyConfig.riskLimits.maxPositionPct || 10
        ),
        notes: `AI override (fast was flat): ${aiDecision.notes}`,
      };
    }

    // If both suggest same action, blend confidence and position size
    if (fastDecision.action === aiDecision.action) {
      const blendedConfidence = (fastDecision.confidence * 0.7 + aiDecision.confidence * 0.3);
      const blendedSize = (fastDecision.targetPositionSizePct * 0.7 + aiDecision.targetPositionSizePct * 0.3);
      return {
        action: fastDecision.action,
        confidence: Math.min(0.9, blendedConfidence),
        targetPositionSizePct: Math.min(blendedSize, strategyConfig.riskLimits.maxPositionPct || 10),
        notes: `Blended (fast + AI): ${fastDecision.action} with ${(blendedConfidence * 100).toFixed(0)}% confidence`,
      };
    }

    // If actions conflict, prefer fast decision if confidence is similar
    if (fastDecision.confidence >= aiDecision.confidence * 0.9) {
      return fastDecision;
    }

    // AI is significantly more confident, but reduce position size
    return {
      ...aiDecision,
      targetPositionSizePct: Math.min(
        aiDecision.targetPositionSizePct * 0.8,
        strategyConfig.riskLimits.maxPositionPct || 10
      ),
      notes: `AI override (higher confidence): ${aiDecision.notes}`,
    };
  }

  /**
   * Unified decision entry point
   * 
   * This is the single method that all modes (backtest, paper, live) should use.
   * It handles:
   * - Dynamic strategy selection based on market regime
   * - Fast rule-based decisions
   * - Optional AI assistance (when enabled and conditions met)
   * - Risk limit enforcement
   */
  async decide(
    context: MarketContext,
    strategyConfig: StrategyConfig,
    options: DecisionOptions = {}
  ): Promise<Decision> {
    // Extract indicators (using sync version for performance)
    const indicators = extractIndicatorsSync(context.recentCandles, strategyConfig.indicators) as any;
    
    // Update context with computed indicators
    context.indicators = indicators;

    // Try dynamic strategy selection if enabled
    let strategyDecision: Decision | null = null;
    if (options.strategyId && strategyConfig.enableDynamicStrategySelection !== false) {
      try {
        const selectedStrategy = await strategySelector.selectStrategy(
          options.strategyId,
          context.recentCandles,
          indicators,
          strategyConfig
        );
        
        if (selectedStrategy) {
          strategyDecision = await strategySelector.generateDecision(
            selectedStrategy,
            context.recentCandles,
            indicators,
            strategyConfig
          );
          
          if (strategyDecision && strategyDecision.confidence > 0.6) {
            logger.info(
              { 
                strategyId: options.strategyId,
                selectedStrategy,
                confidence: strategyDecision.confidence,
                action: strategyDecision.action 
              },
              'Using dynamic strategy selection'
            );
            // Use strategy decision if confidence is high enough
            // Otherwise fall through to fast decision
          }
        }
      } catch (error) {
        logger.warn({ error }, 'Strategy selector failed, using fast decision');
      }
    }

    // Get fast decision first (always)
    const fastDecision = this.getFastDecision(context, indicators);

    // Determine AI mode
    const aiConfig = strategyConfig.ai || { mode: 'ASSIST' };
    const requestedMode = options.aiMode || aiConfig.mode;

    // If AI is OFF, return fast decision immediately
    if (requestedMode === 'OFF') {
      return fastDecision;
    }

    // Check if we should use AI (ASSIST mode only uses AI when fast is uncertain)
    const shouldUseAI =
      requestedMode === 'FULL' ||
      (requestedMode === 'ASSIST' &&
        fastDecision.confidence < (aiConfig.confidenceThreshold || 0.5) &&
        (context.performance.totalTrades || 0) >= (aiConfig.minTradesForAI || 10));

    if (shouldUseAI) {
      try {
        // Get AI decision (with shortened context)
        const historicalDecisions = options.historicalDecisions?.slice(0, 5) || []; // Only top 5
        const aiDecision = await matchaBrain.getDecision(
          context,
          strategyConfig,
          historicalDecisions,
          options.strategyId,
          {
            mode: requestedMode,
            model: aiConfig.model || (requestedMode === 'FULL' ? 'gpt-5.1' : 'gpt-4o-mini'),
          }
        );

        // Combine fast and AI decisions (use strategy decision if available, otherwise fast)
        const baseDecision = strategyDecision && strategyDecision.confidence > fastDecision.confidence 
          ? strategyDecision 
          : fastDecision;
        return this.combineFastAndAI(baseDecision, aiDecision, strategyConfig, context);
      } catch (error: any) {
        logger.warn({ error: error.message }, 'AI decision failed, using fast decision');
        return fastDecision;
      }
    }

    // Return best decision (strategy > fast > flat)
    if (strategyDecision && strategyDecision.confidence > fastDecision.confidence) {
      return strategyDecision;
    }
    return fastDecision;
  }
}

export const decisionEngine = new DecisionEngine();

