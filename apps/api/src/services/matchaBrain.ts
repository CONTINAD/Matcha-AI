import OpenAI from 'openai';
import { config } from '../config/env';
import { logger } from '../config/logger';
import { decisionLatency } from './metrics';
import { PrismaClient } from '@prisma/client';
import { multiTimeframeAnalyzer } from './multiTimeframeAnalyzer';
import { advancedTrainer } from './advancedTrainer';
import { strategyEngine } from './strategyEngine';
import type {
  MarketContext,
  Decision,
  StrategyConfig,
  PerformanceMetrics,
  Trade,
} from '@matcha-ai/shared';

const prisma = new PrismaClient();

export class MatchaBrain {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: config.openai.apiKey,
    });
  }

  /**
   * Get a trading decision from the AI based on market context
   * Enhanced with advanced reasoning and multi-factor analysis
   */
  async getDecision(
    context: MarketContext, 
    strategyConfig: StrategyConfig, 
    historicalDecisions?: Array<{ decision: Decision; outcome?: 'win' | 'loss' | 'neutral' }>,
    strategyId?: string
  ): Promise<Decision> {
    const systemPrompt = `You are Matcha AI, an advanced quantitative trading system with deep market analysis capabilities. Your goal is to maximize risk-adjusted returns through sophisticated pattern recognition and adaptive learning.

EXPERTISE AREAS:
- Technical analysis (indicators, patterns, trends, multi-timeframe)
- Market regime detection (trending, ranging, volatile, calm, choppy)
- Risk management and position sizing (Kelly Criterion, VaR)
- Learning from historical performance patterns
- Multi-factor decision making with ensemble methods
- Liquidity and volatility analysis

CRITICAL RULES:
1. NEVER violate risk limits (maxPositionPct, maxDailyLossPct, maxLeverage)
2. If daily loss exceeds maxDailyLossPct, return action: "flat" and confidence: 0
3. Avoid over-trading and revenge trading - quality over quantity
4. Only take positions when confidence is high (>= 0.6) and multiple factors align
5. Consider current positions and avoid over-concentration
6. Learn from past decisions - if similar conditions led to losses, be more cautious
7. Adapt confidence based on market conditions and recent performance
8. In ranging/choppy markets, prefer mean reversion or stay flat
9. In trending markets, prefer momentum/trend following
10. In high volatility, reduce position size or stay flat
11. When drawdown is high (>5%), be more conservative

ANALYSIS FRAMEWORK:
1. Market Regime: Identify if market is trending, ranging, volatile, calm, or choppy
   - Trending: Strong directional movement, high momentum
   - Ranging: Sideways movement, support/resistance levels
   - Volatile: High price swings, unpredictable
   - Calm: Low volatility, stable prices
   - Choppy: Erratic movements, no clear direction
2. Technical Signals: Analyze ALL indicators for confluence
   - RSI: Overbought (>70) or oversold (<30) conditions
   - EMA: Trend direction and strength
   - MACD: Momentum shifts
   - Bollinger Bands: Volatility and mean reversion opportunities
   - ATR: Volatility measurement
   - Volume: Confirmation of moves
3. Multi-Timeframe: Consider higher timeframe trends (if available)
4. Risk Assessment: Evaluate current risk exposure and market conditions
5. Performance Context: Consider recent win rate, drawdown, and Sharpe ratio
6. Pattern Recognition: Look for patterns that led to successful trades
7. Position Sizing: Adjust size based on confidence, risk, and market regime
8. Entry/Exit Timing: Wait for optimal entry, use stop loss/take profit

You must respond with a valid JSON object matching this structure:
{
  "action": "long" | "short" | "flat",
  "confidence": number (0-1),
  "targetPositionSizePct": number (0-100),
  "notes": string,
  "reasoning": {
    "marketRegime": "trending" | "ranging" | "volatile" | "uncertain",
    "keyFactors": string[],
    "riskAssessment": "low" | "medium" | "high",
    "patternMatch": string | null
  }
}`;

    // Build enhanced context with pattern analysis
    const recentCandles = context.recentCandles;
    const priceTrend = recentCandles.length >= 2 
      ? (recentCandles[recentCandles.length - 1].close - recentCandles[0].close) / recentCandles[0].close
      : 0;
    const volatility = context.indicators.volatility || 0;
    const marketRegime = this.detectMarketRegime(context);
    
    // Multi-timeframe analysis (if symbol available)
    let multiTimeframe = null;
    try {
      const symbol = strategyConfig.universe[0];
      if (symbol && strategyId) {
        // Get chainId from strategy if available
        const strategy = await prisma.strategy.findUnique({
          where: { id: strategyId },
          select: { chainId: true },
        });
        const chainId = strategy?.chainId || 1;
        
        multiTimeframe = await multiTimeframeAnalyzer.analyze(
          symbol,
          strategyConfig.timeframe,
          chainId
        );
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to get multi-timeframe analysis');
    }
    
    // Check for arbitrage and mean reversion opportunities FIRST (before AI)
    // These are high-probability edges that should be prioritized
    let strategyDecision: Decision | null = null;
    try {
      const symbol = strategyConfig.universe[0];
      if (symbol && strategyId) {
        const strategy = await prisma.strategy.findUnique({
          where: { id: strategyId },
          select: { chainId: true, baseAsset: true },
        });
        const chainId = strategy?.chainId || 1;
        const baseAsset = strategy?.baseAsset || 'USDC';
        
        // 1. Check for arbitrage opportunities (>2% edge)
        const arb = await strategyEngine.detectArb(chainId, baseAsset, [symbol], 2.0);
        if (arb) {
          strategyDecision = strategyEngine.arbToDecision(arb);
          logger.info({ strategyId, symbol, edge: arb.edge }, 'Arbitrage opportunity detected - prioritizing over AI');
        } else {
          // 2. Check for mean reversion signals
          const meanRev = await strategyEngine.meanReversionSignal(chainId, baseAsset, symbol, 30);
          if (meanRev.action !== 'hold') {
            strategyDecision = strategyEngine.meanReversionToDecision(meanRev);
            logger.info({ strategyId, symbol, action: meanRev.action, deviation: meanRev.deviation }, 'Mean reversion signal detected');
          }
        }
      }
    } catch (error) {
      logger.warn({ error }, 'Error checking strategy engine opportunities');
    }

    // If we have a high-confidence strategy signal, use it instead of AI
    if (strategyDecision && strategyDecision.confidence >= 0.7) {
      logger.info({ strategyId, decision: strategyDecision }, 'Using strategy engine decision (arb/mean reversion)');
      return strategyDecision;
    }

    // Analyze historical decisions for pattern learning
    const patternAnalysis = historicalDecisions 
      ? this.analyzeHistoricalPatterns(context, historicalDecisions)
      : null;

    // Get advanced training insights for better decisions
    let trainingInsights = null;
    try {
      const targetStrategyId = strategyId || '';
      if (targetStrategyId) {
        const metrics = await advancedTrainer.analyzePredictions(
          targetStrategyId,
          100
        );
        if (metrics.bestPatterns.length > 0 || metrics.worstPatterns.length > 0) {
          trainingInsights = {
            bestPatterns: metrics.bestPatterns.slice(0, 3),
            worstPatterns: metrics.worstPatterns.slice(0, 3),
            recentAccuracy: metrics.recentAccuracy,
            improvement: metrics.improvement,
          };
        }
      }
    } catch (error) {
      // Training insights are optional
      logger.debug({ error }, 'Could not get training insights');
    }

    // Enhanced context with more detail
    const recentPrices = recentCandles.map(c => c.close);
    const priceChange = recentPrices.length > 1 ? (recentPrices[recentPrices.length - 1] - recentPrices[0]) / recentPrices[0] : 0;
    const avgVolume = recentCandles.reduce((sum, c) => sum + c.volume, 0) / recentCandles.length;
    const currentVolume = recentCandles[recentCandles.length - 1]?.volume || 0;
    const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;
    
    const indicators = context.indicators;
    const rsi = indicators.rsi || 50;
    const emaTrend = indicators.emaTrend || 0;
    const macd = indicators.macd || 0;
    const bollingerUpper = indicators.bollingerUpper;
    const bollingerLower = indicators.bollingerLower;
    const currentPrice = recentCandles[recentCandles.length - 1]?.close || 0;
    const atr = indicators.atr || 0;
    
    // Multi-timeframe context (if available)
    const higherTimeframeTrend = indicators.higherTimeframeTrend || null;

    const userPrompt = `Market Context (Enhanced Multi-Factor Analysis):
- Recent candles: ${recentCandles.length} candles
- Price trend: ${(priceTrend * 100).toFixed(2)}% over period
- Price change: ${(priceChange * 100).toFixed(2)}%
- Market regime: ${marketRegime}
- Volatility (ATR): ${atr.toFixed(4)} (${volatility > 0.05 ? 'HIGH' : volatility > 0.02 ? 'MEDIUM' : 'LOW'})
- Volume: Current=${currentVolume.toFixed(0)}, Avg=${avgVolume.toFixed(0)}, Ratio=${volumeRatio.toFixed(2)}x

Technical Indicators:
- RSI: ${rsi.toFixed(1)} ${rsi > 70 ? '(OVERBOUGHT)' : rsi < 30 ? '(OVERSOLD)' : '(NEUTRAL)'}
- EMA Trend: ${emaTrend > 0 ? 'BULLISH' : 'BEARISH'} (${(Math.abs(emaTrend) * 100).toFixed(2)}% strength)
- MACD: ${macd > 0 ? 'POSITIVE' : 'NEGATIVE'} (${macd.toFixed(4)})
${bollingerUpper && bollingerLower ? `- Bollinger Bands: Price=${currentPrice.toFixed(2)}, Upper=${bollingerUpper.toFixed(2)}, Lower=${bollingerLower.toFixed(2)}, ${currentPrice > bollingerUpper ? 'ABOVE UPPER' : currentPrice < bollingerLower ? 'BELOW LOWER' : 'WITHIN BANDS'}` : ''}
${higherTimeframeTrend ? `- Higher Timeframe Trend: ${higherTimeframeTrend > 0 ? 'BULLISH' : 'BEARISH'}` : ''}
${multiTimeframe ? `
Multi-Timeframe Analysis:
- Primary (${multiTimeframe.primary.timeframe}): ${multiTimeframe.primary.trend.toUpperCase()} (${(multiTimeframe.primary.strength * 100).toFixed(1)}% strength)
- Higher (${multiTimeframe.higher.timeframe}): ${multiTimeframe.higher.trend.toUpperCase()} (${(multiTimeframe.higher.strength * 100).toFixed(1)}% strength)
- Lower (${multiTimeframe.lower.timeframe}): ${multiTimeframe.lower.trend.toUpperCase()} (${(multiTimeframe.lower.strength * 100).toFixed(1)}% strength)
- Alignment: ${multiTimeframe.alignment.toUpperCase()} (${(multiTimeframe.confidence * 100).toFixed(1)}% confidence)
${multiTimeframe.alignment === 'aligned' ? '✅ All timeframes aligned - high confidence trade' : multiTimeframe.alignment === 'conflicting' ? '⚠️ Timeframes conflicting - be cautious' : '⚡ Mixed signals - moderate confidence'}
` : ''}

Position Status:
- Open positions: ${context.openPositions.length} (${JSON.stringify(context.openPositions.map(p => `${p.symbol} ${p.side} ${p.size.toFixed(4)}`))})
- Current equity: ${context.currentEquity.toFixed(2)}
- Daily PnL: ${context.dailyPnl.toFixed(2)} ${context.dailyPnl < 0 ? '⚠️' : ''}

Performance History:
- Realized PnL: ${context.performance.realizedPnl.toFixed(2)}
- Max Drawdown: ${context.performance.maxDrawdown.toFixed(2)}% ${context.performance.maxDrawdown > 5 ? '⚠️ HIGH' : ''}
- Win Rate: ${(context.performance.winRate * 100).toFixed(2)}%
- Sharpe Ratio: ${context.performance.sharpe?.toFixed(2) || 'N/A'}
- Total Trades: ${context.performance.totalTrades || 0}

Risk Limits:
- Max Position: ${context.riskLimits.maxPositionPct}%
- Max Daily Loss: ${context.riskLimits.maxDailyLossPct}%
- Stop Loss: ${context.riskLimits.stopLossPct || 'N/A'}%
- Take Profit: ${context.riskLimits.takeProfitPct || 'N/A'}%

${patternAnalysis ? `\nPattern Learning (Historical Analysis):
${patternAnalysis}` : ''}
${trainingInsights ? `
Advanced Training Insights:
- Recent Accuracy: ${(trainingInsights.recentAccuracy * 100).toFixed(1)}%
- Improvement: ${(trainingInsights.improvement * 100).toFixed(1)}%
- Best Patterns to Favor:
${trainingInsights.bestPatterns.map((p: any) => `  * ${p.pattern}: ${(p.accuracy * 100).toFixed(1)}% accuracy, $${p.avgPnl.toFixed(2)} avg P&L`).join('\n')}
- Worst Patterns to Avoid:
${trainingInsights.worstPatterns.map((p: any) => `  * ${p.pattern}: ${(p.accuracy * 100).toFixed(1)}% accuracy, $${p.avgPnl.toFixed(2)} avg P&L`).join('\n')}
` : ''}

Strategy Config:
- Base asset: ${strategyConfig.baseAsset}
- Universe: ${strategyConfig.universe.join(', ')}
- Timeframe: ${strategyConfig.timeframe}
- Strategy type: ${strategyConfig.indicators?.ema ? 'Momentum/Trend' : strategyConfig.indicators?.rsi ? 'Mean Reversion' : 'General'}

DECISION REQUIREMENTS:
1. Analyze market regime and adapt strategy accordingly
2. Check for indicator confluence (multiple signals agreeing)
3. Consider volume confirmation (higher volume = stronger signal)
4. Evaluate risk/reward ratio
5. Respect current drawdown (be more conservative if high)
6. Avoid trading in unfavorable conditions (low liquidity, extreme volatility)
7. Only trade when confidence >= 0.6 and multiple factors align

Make a sophisticated trading decision considering ALL factors. Explain your reasoning in detail, including:
- Why this regime favors your chosen action
- Which indicators support your decision
- Risk/reward assessment
- Position sizing rationale`;

    const endTimer = decisionLatency.startTimer({ mode: 'single' });
    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-5.1', // Upgraded from gpt-4-turbo-preview
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3, // Lower temperature for more consistent decisions
        reasoning_effort: 'medium', // Adaptive reasoning: fast for simple, deep for complex
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from OpenAI');
      }

      const decision = JSON.parse(content) as Decision & { reasoning?: any };

      // Validate decision structure
      if (!['long', 'short', 'flat'].includes(decision.action)) {
        throw new Error(`Invalid action: ${decision.action}`);
      }
      if (typeof decision.confidence !== 'number' || decision.confidence < 0 || decision.confidence > 1) {
        throw new Error(`Invalid confidence: ${decision.confidence}`);
      }
      if (
        typeof decision.targetPositionSizePct !== 'number' ||
        decision.targetPositionSizePct < 0 ||
        decision.targetPositionSizePct > 100
      ) {
        throw new Error(`Invalid targetPositionSizePct: ${decision.targetPositionSizePct}`);
      }

      // Adaptive confidence adjustment based on recent performance
      const adjustedConfidence = this.adjustConfidenceByPerformance(decision.confidence, context.performance);

      // Enforce risk limits
      if (context.dailyPnl < 0 && Math.abs(context.dailyPnl) / context.currentEquity >= context.riskLimits.maxDailyLossPct / 100) {
        logger.warn('Daily loss limit exceeded, forcing flat position');
        return {
          action: 'flat',
          confidence: 0,
          targetPositionSizePct: 0,
          notes: 'Daily loss limit exceeded',
        };
      }

      // Adjust position size based on market regime and confidence
      const regimeAdjustment = this.getRegimePositionAdjustment(marketRegime);
      const adjustedPositionSize = decision.targetPositionSizePct * adjustedConfidence * regimeAdjustment;

      // Clamp position size to max
      decision.targetPositionSizePct = Math.min(
        adjustedPositionSize,
        context.riskLimits.maxPositionPct
      );

      // Update confidence with adjusted value
      decision.confidence = adjustedConfidence;

      // Add reasoning to notes if available
      if (decision.reasoning) {
        decision.notes = `${decision.notes || ''}\n[Regime: ${decision.reasoning.marketRegime || marketRegime}, Risk: ${decision.reasoning.riskAssessment || 'medium'}]`.trim();
      }

      return decision;
    } catch (error) {
      logger.error({ error }, 'Error getting decision from OpenAI');
      throw error;
    } finally {
      endTimer();
    }
  }

  /**
   * Get config suggestions based on recent performance
   */
  async getConfigSuggestions(
    strategyName: string,
    currentConfig: StrategyConfig,
    recentPerformance: PerformanceMetrics,
    recentTrades: Trade[]
  ): Promise<{ suggestedConfigJson: string; reasoning: string }> {
    const systemPrompt = `You are Matcha AI's learning system. Analyze trading performance and suggest improvements to strategy configuration.

CRITICAL RULES:
1. NEVER suggest increasing risk limits (maxPositionPct, maxDailyLossPct, maxLeverage)
2. You can suggest decreasing risk limits if performance is poor
3. You can adjust indicator parameters, thresholds, and filters
4. Provide clear reasoning for each suggestion
5. Focus on improving risk-adjusted returns

Respond with JSON:
{
  "suggestedConfig": { ... },
  "reasoning": "string explaining the changes"
}`;

    const userPrompt = `Strategy: ${strategyName}

Current Config:
${JSON.stringify(currentConfig, null, 2)}

Recent Performance (last 30 trades or period):
- Realized PnL: ${recentPerformance.realizedPnl}
- Max Drawdown: ${recentPerformance.maxDrawdown}%
- Win Rate: ${recentPerformance.winRate}%
- Sharpe: ${recentPerformance.sharpe || 'N/A'}
- Total Trades: ${recentTrades.length}

Recent Trades Sample:
${JSON.stringify(recentTrades.slice(-10), null, 2)}

Suggest improvements to the configuration. Remember: NEVER increase risk limits.`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-5.1', // Upgraded from gpt-4-turbo-preview
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.5,
        reasoning_effort: 'medium',
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from OpenAI');
      }

      const result = JSON.parse(content) as { suggestedConfig: StrategyConfig; reasoning: string };

      // Ensure risk limits are not increased
      const suggested = result.suggestedConfig;
      if (suggested.riskLimits.maxPositionPct > currentConfig.riskLimits.maxPositionPct) {
        suggested.riskLimits.maxPositionPct = currentConfig.riskLimits.maxPositionPct;
        result.reasoning += ' (Note: maxPositionPct was capped at current value for safety)';
      }
      if (suggested.riskLimits.maxDailyLossPct > currentConfig.riskLimits.maxDailyLossPct) {
        suggested.riskLimits.maxDailyLossPct = currentConfig.riskLimits.maxDailyLossPct;
        result.reasoning += ' (Note: maxDailyLossPct was capped at current value for safety)';
      }
      if (
        suggested.riskLimits.maxLeverage &&
        currentConfig.riskLimits.maxLeverage &&
        suggested.riskLimits.maxLeverage > currentConfig.riskLimits.maxLeverage
      ) {
        suggested.riskLimits.maxLeverage = currentConfig.riskLimits.maxLeverage;
        result.reasoning += ' (Note: maxLeverage was capped at current value for safety)';
      }

      return {
        suggestedConfigJson: JSON.stringify(suggested),
        reasoning: result.reasoning,
      };
    } catch (error) {
      logger.error({ error }, 'Error getting config suggestions from OpenAI');
      throw error;
    }
  }

  /**
   * Detect market regime (trending, ranging, volatile)
   */
  private detectMarketRegime(context: MarketContext): string {
    const { indicators, recentCandles } = context;
    const volatility = indicators.volatility || 0;
    const rsi = indicators.rsi || 50;
    const emaTrend = indicators.emaTrend || 0;

    // High volatility = volatile regime
    if (volatility > 0.05) {
      return 'volatile';
    }

    // Strong trend indicators = trending
    if (Math.abs(emaTrend) > 0.5 && (rsi > 60 || rsi < 40)) {
      return 'trending';
    }

    // RSI in middle range, low volatility = ranging
    if (rsi > 40 && rsi < 60 && volatility < 0.02) {
      return 'ranging';
    }

    return 'uncertain';
  }

  /**
   * Analyze historical patterns to learn what works
   */
  private analyzeHistoricalPatterns(
    context: MarketContext,
    historicalDecisions: Array<{ decision: Decision; outcome?: 'win' | 'loss' | 'neutral' }>
  ): string {
    if (historicalDecisions.length === 0) return '';

    const wins = historicalDecisions.filter((h) => h.outcome === 'win').length;
    const losses = historicalDecisions.filter((h) => h.outcome === 'loss').length;
    const winRate = wins / (wins + losses) || 0;

    // Find patterns in winning trades
    const winningConditions = historicalDecisions
      .filter((h) => h.outcome === 'win')
      .map((h) => {
        const rsi = context.indicators.rsi || 50;
        const regime = this.detectMarketRegime(context);
        return { rsi, regime, action: h.decision.action };
      });

    // Find patterns in losing trades
    const losingConditions = historicalDecisions
      .filter((h) => h.outcome === 'loss')
      .map((h) => {
        const rsi = context.indicators.rsi || 50;
        const regime = this.detectMarketRegime(context);
        return { rsi, regime, action: h.decision.action };
      });

    let analysis = `Historical Performance: ${(winRate * 100).toFixed(1)}% win rate (${wins}W/${losses}L)\n`;

    if (winningConditions.length > 0) {
      const avgWinningRSI = winningConditions.reduce((sum, c) => sum + c.rsi, 0) / winningConditions.length;
      analysis += `Winning patterns: Avg RSI ${avgWinningRSI.toFixed(1)}, common regime: ${winningConditions[0]?.regime}\n`;
    }

    if (losingConditions.length > 0) {
      const avgLosingRSI = losingConditions.reduce((sum, c) => sum + c.rsi, 0) / losingConditions.length;
      analysis += `Losing patterns: Avg RSI ${avgLosingRSI.toFixed(1)}, common regime: ${losingConditions[0]?.regime}\n`;
      analysis += `⚠️ Be cautious if current conditions match losing patterns\n`;
    }

    return analysis;
  }

  /**
   * Adjust confidence based on recent performance
   */
  private adjustConfidenceByPerformance(baseConfidence: number, performance: PerformanceMetrics): number {
    let adjusted = baseConfidence;

    // Reduce confidence if win rate is low
    if (performance.winRate < 0.4 && performance.totalTrades && performance.totalTrades > 10) {
      adjusted *= 0.8;
    }

    // Reduce confidence if in drawdown
    if (performance.maxDrawdown > 10) {
      adjusted *= 0.9;
    }

    // Increase confidence if performing well
    if (performance.winRate > 0.6 && performance.sharpe && performance.sharpe > 1) {
      adjusted = Math.min(1, adjusted * 1.1);
    }

    return Math.max(0, Math.min(1, adjusted));
  }

  /**
   * Get position size adjustment based on market regime
   */
  private getRegimePositionAdjustment(regime: string): number {
    const adjustments: Record<string, number> = {
      trending: 1.0, // Full size in trends
      ranging: 0.7, // Reduce size in ranging markets
      volatile: 0.5, // Much smaller in volatile markets
      uncertain: 0.6, // Conservative when uncertain
    };
    return adjustments[regime] || 0.8;
  }

  /**
   * Get ensemble decision from multiple AI calls (voting mechanism)
   */
  async getEnsembleDecision(
    context: MarketContext,
    strategyConfig: StrategyConfig,
    numVotes = 3
  ): Promise<Decision> {
    const endTimer = decisionLatency.startTimer({ mode: 'ensemble' });
    const decisions: Decision[] = [];

    try {
      // Get multiple decisions
      for (let i = 0; i < numVotes; i++) {
        try {
          const decision = await this.getDecision(context, strategyConfig);
          decisions.push(decision);
        } catch (error) {
          logger.error({ error, vote: i }, 'Error getting ensemble vote');
        }
      }

      if (decisions.length === 0) {
        throw new Error('No valid decisions from ensemble');
      }

      // Voting mechanism
      const actionVotes: Record<string, number> = { long: 0, short: 0, flat: 0 };
      let totalConfidence = 0;
      let totalPositionSize = 0;

      for (const decision of decisions) {
        actionVotes[decision.action]++;
        totalConfidence += decision.confidence;
        totalPositionSize += decision.targetPositionSizePct;
      }

      // Get majority action
      const majorityAction = Object.entries(actionVotes).reduce((a, b) => (a[1] > b[1] ? a : b))[0] as 'long' | 'short' | 'flat';

      // Average confidence and position size
      const avgConfidence = totalConfidence / decisions.length;
      const avgPositionSize = totalPositionSize / decisions.length;

      // If no clear majority, go flat
      const maxVotes = Math.max(...Object.values(actionVotes));
      if (maxVotes < decisions.length / 2) {
        return {
          action: 'flat',
          confidence: avgConfidence * 0.5, // Lower confidence if no consensus
          targetPositionSizePct: 0,
          notes: `No consensus (${decisions.length} votes: ${JSON.stringify(actionVotes)})`,
        };
      }

      return {
        action: majorityAction,
        confidence: avgConfidence,
        targetPositionSizePct: avgPositionSize,
        notes: `Ensemble decision (${maxVotes}/${decisions.length} votes for ${majorityAction})`,
      };
    } finally {
      endTimer();
    }
  }
}

export const matchaBrain = new MatchaBrain();
