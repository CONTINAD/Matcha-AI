import OpenAI from 'openai';
import { config } from '../config/env';
import { logger } from '../config/logger';
import { decisionLatency } from './metrics';
import { PrismaClient } from '@prisma/client';
import { multiTimeframeAnalyzer } from './multiTimeframeAnalyzer';
import { advancedTrainer } from './advancedTrainer';
import { strategyEngine } from './strategyEngine';
import { priceService } from './priceService';
import { riskManager } from './riskManager';
import { predictionTrainer } from './predictionTrainer';
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
    strategyId?: string,
    options?: {
      mode?: 'OFF' | 'ASSIST' | 'FULL';
      model?: 'gpt-4o-mini' | 'gpt-4o' | 'gpt-5.1';
    }
  ): Promise<Decision> {
    const aiMode = options?.mode || 'ASSIST';
    const model = options?.model || (aiMode === 'FULL' ? 'gpt-5.1' : 'gpt-4o-mini');
    
    // Shortened system prompt (~150 tokens vs ~500)
    const systemPrompt = aiMode === 'FULL'
      ? `You are Matcha AI, a quantitative trading system. Maximize risk-adjusted returns.

RULES:
1. NEVER violate risk limits (maxPositionPct, maxDailyLossPct)
2. If daily loss limit exceeded, return action: "flat", confidence: 0
3. Only take positions when confidence >= 0.6 and multiple factors align
4. In ranging markets: prefer mean reversion or stay flat
5. In trending markets: prefer momentum/trend following
6. In high volatility: reduce position size or stay flat
7. Consider recent win rate and drawdown

ANALYSIS:
- Market Regime: trending/ranging/volatile/calm/choppy
- Technical Signals: RSI, EMA, MACD, Bollinger Bands, ATR
- Risk: Evaluate exposure and market conditions
- Performance: Win rate, drawdown, Sharpe ratio

Respond with JSON:
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
}`
      : `You are Matcha AI, a trading assistant. Provide trading decisions when fast engine is uncertain.

RULES:
1. NEVER violate risk limits
2. If daily loss limit exceeded, return action: "flat", confidence: 0
3. Only suggest trades when confidence >= 0.5
4. Consider market regime (trending/ranging/volatile)
5. Use indicators: RSI, EMA, MACD, Bollinger Bands

Respond with JSON:
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
        
        // 1. Check for arbitrage opportunities (>1.5% edge for Solana, >2% for EVM)
        let arb: any = null;
        if (chainId === 101) {
          // Solana: use Jupiter API for arbitrage detection
          const solanaArb = await strategyEngine.detectSolanaArb(
            symbol === 'SOL' ? 'So11111111111111111111111111111111111111112' : symbol,
            baseAsset === 'USDC' ? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' : baseAsset,
            1.5 // 1.5% min edge for Solana
          );
          if (solanaArb) {
            strategyDecision = solanaArb;
            logger.info({ strategyId, symbol, confidence: solanaArb.confidence }, 'Solana arbitrage opportunity detected - prioritizing over AI');
          }
        } else {
          // EVM: use 0x API for arbitrage detection
          arb = await strategyEngine.detectArb(chainId, baseAsset, [symbol], 2.0);
          if (arb) {
            strategyDecision = strategyEngine.arbToDecision(arb);
            logger.info({ strategyId, symbol, edge: arb.edge }, 'Arbitrage opportunity detected - prioritizing over AI');
          }
        }
        
        if (!strategyDecision) {
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

    // Analyze historical decisions for pattern learning (only for FULL mode)
    // ASSIST mode: Skip heavy analysis to reduce token usage
    const patternAnalysis = aiMode === 'FULL' && historicalDecisions 
      ? this.analyzeHistoricalPatterns(context, historicalDecisions)
      : null;

    // Get advanced training insights for better decisions (only for FULL mode)
    // ASSIST mode: Skip to reduce token usage and API calls
    let trainingInsights = null;
    if (aiMode === 'FULL') {
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

    // Shortened user prompt (~300 tokens vs 1000-2000)
    // Send summary instead of full candles/history
    const lastCandle = recentCandles[recentCandles.length - 1];
    const priceChangePct = recentCandles.length >= 2 
      ? ((lastCandle.close - recentCandles[0].close) / recentCandles[0].close) * 100
      : 0;
    
    // Top 5 historical decisions only (not 30)
    const topHistoricalDecisions = historicalDecisions?.slice(0, 5) || [];
    
    const userPrompt = `Market Summary:
- Price: ${lastCandle.close.toFixed(2)}, Change: ${priceChangePct.toFixed(2)}% (${recentCandles.length} candles)
- Regime: ${marketRegime}, Volatility: ${volatility > 0.05 ? 'HIGH' : volatility > 0.02 ? 'MEDIUM' : 'LOW'}
- Volume: ${(volumeRatio * 100).toFixed(0)}% of avg

Indicators:
- RSI: ${rsi.toFixed(1)} ${rsi > 70 ? '(OB)' : rsi < 30 ? '(OS)' : ''}
- EMA: ${emaTrend > 0 ? 'BULL' : 'BEAR'} ${(Math.abs(emaTrend) * 100).toFixed(1)}%
- MACD: ${macd > 0 ? '+' : '-'}${Math.abs(macd).toFixed(4)}
${bollingerUpper && bollingerLower ? `- BB: ${currentPrice > bollingerUpper ? 'ABOVE' : currentPrice < bollingerLower ? 'BELOW' : 'WITHIN'}` : ''}

Performance:
- Win Rate: ${(context.performance.winRate * 100).toFixed(1)}%, PnL: $${context.performance.realizedPnl.toFixed(2)}
- Drawdown: ${context.performance.maxDrawdown.toFixed(1)}%, Trades: ${context.performance.totalTrades || 0}
- Daily PnL: $${context.dailyPnl.toFixed(2)}, Equity: $${context.currentEquity.toFixed(2)}

Risk Limits:
- Max Position: ${context.riskLimits.maxPositionPct}%, Max Daily Loss: ${context.riskLimits.maxDailyLossPct}%

${topHistoricalDecisions.length > 0 ? `Recent Decisions (${topHistoricalDecisions.length}):\n${topHistoricalDecisions.map((h, i) => `${i + 1}. ${h.decision.action} (${(h.decision.confidence * 100).toFixed(0)}%) - ${h.outcome || 'pending'}`).join('\n')}` : ''}

Make a trading decision. Consider regime, indicators, and risk limits.`;

    // Define tools for function calling
    const tools = [
      {
        type: 'function' as const,
        function: {
          name: 'getCurrentPrice',
          description: 'Get current token price from 0x API or CoinGecko. Use this when you need real-time price data during decision making.',
          parameters: {
            type: 'object',
            properties: {
              symbol: { type: 'string', description: 'Token symbol (e.g., WETH, SOL)' },
              baseAsset: { type: 'string', description: 'Base asset for price quote (e.g., USDC)' },
              chainId: { type: 'number', description: 'Chain ID (1=Ethereum, 137=Polygon, 101=Solana)' },
            },
            required: ['symbol', 'baseAsset', 'chainId'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'checkRiskLimits',
          description: 'Check if a proposed trade would violate risk limits. Use this before finalizing position size.',
          parameters: {
            type: 'object',
            properties: {
              positionSizePct: { type: 'number', description: 'Proposed position size as percentage of equity (0-100)' },
              dailyPnl: { type: 'number', description: 'Current daily P&L' },
              currentEquity: { type: 'number', description: 'Current account equity' },
              maxPositionPct: { type: 'number', description: 'Maximum allowed position size percentage' },
              maxDailyLossPct: { type: 'number', description: 'Maximum allowed daily loss percentage' },
            },
            required: ['positionSizePct', 'dailyPnl', 'currentEquity', 'maxPositionPct', 'maxDailyLossPct'],
          },
        },
      },
      {
        type: 'function' as const,
        function: {
          name: 'getHistoricalPerformance',
          description: 'Get recent trade performance and patterns for learning. Use this to understand what has worked well recently.',
          parameters: {
            type: 'object',
            properties: {
              strategyId: { type: 'string', description: 'Strategy ID to analyze' },
              lookbackDays: { type: 'number', description: 'Number of days to look back (default: 7)' },
            },
            required: ['strategyId'],
          },
        },
      },
    ];

    // Structured output schema for guaranteed response format
    const decisionSchema = {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['long', 'short', 'flat'],
          description: 'Trading action to take',
        },
        confidence: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Confidence level (0-1)',
        },
        targetPositionSizePct: {
          type: 'number',
          minimum: 0,
          maximum: 100,
          description: 'Target position size as percentage of equity (0-100)',
        },
        notes: {
          type: 'string',
          description: 'Explanation of the decision',
        },
        reasoning: {
          type: 'object',
          properties: {
            marketRegime: {
              type: 'string',
              enum: ['trending', 'ranging', 'volatile', 'calm', 'choppy', 'uncertain'],
            },
            keyFactors: {
              type: 'array',
              items: { type: 'string' },
            },
            riskAssessment: {
              type: 'string',
              enum: ['low', 'medium', 'high'],
            },
            patternMatch: {
              type: ['string', 'null'],
            },
          },
        },
      },
      required: ['action', 'confidence', 'targetPositionSizePct', 'notes'],
    } as const;

    const endTimer = decisionLatency.startTimer({ mode: 'single' });
    
    try {
      // Get strategy chainId and baseAsset for tool calls
      let strategyChainId = 1;
      let strategyBaseAsset = 'USDC';
      if (strategyId) {
        try {
          const strategy = await prisma.strategy.findUnique({
            where: { id: strategyId },
            select: { chainId: true, baseAsset: true },
          });
          if (strategy) {
            strategyChainId = strategy.chainId || 1;
            strategyBaseAsset = strategy.baseAsset || 'USDC';
          }
        } catch (error) {
          logger.warn({ error }, 'Could not fetch strategy for tool calls');
        }
      }

      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ];

      let decision: Decision & { reasoning?: any };
      
      // Only use function calling for FULL mode
      const useFunctionCalling = aiMode === 'FULL';
      
      if (useFunctionCalling) {
        // FULL mode: Use function calling with tool loop
        let maxToolIterations = 3; // Allow up to 3 tool call iterations
        let iteration = 0;

        // Handle tool calls in a loop
        while (iteration < maxToolIterations) {
          const response = await this.openai.chat.completions.create({
            model,
            messages,
            tools: iteration === 0 ? tools : undefined, // Only send tools on first call
            tool_choice: iteration === 0 ? 'auto' : 'none', // Let AI decide when to use tools
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: 'trading_decision',
                schema: decisionSchema,
              },
            },
            temperature: 0.3,
            reasoning_effort: 'medium',
          });

          const message = response.choices[0]?.message;
          if (!message) {
            throw new Error('No response from OpenAI');
          }

          // Handle tool calls
          if (message.tool_calls && message.tool_calls.length > 0) {
            messages.push(message); // Add assistant message with tool calls

            // Execute tool calls
            for (const toolCall of message.tool_calls) {
              const functionName = toolCall.function.name;
              const args = JSON.parse(toolCall.function.arguments);

              let toolResult: any;
              try {
                if (functionName === 'getCurrentPrice') {
                const symbol = strategyConfig.universe[0] || args.symbol;
                const price = await priceService.getLivePrice(args.chainId, args.baseAsset, symbol);
                toolResult = {
                  price,
                  symbol,
                  baseAsset: args.baseAsset,
                  chainId: args.chainId,
                  timestamp: Date.now(),
                };
                logger.info({ symbol, price, chainId: args.chainId }, 'Tool: getCurrentPrice called');
              } else if (functionName === 'checkRiskLimits') {
                const dailyLossPct = args.dailyPnl < 0 ? Math.abs(args.dailyPnl) / args.currentEquity : 0;
                const allowed = 
                  args.positionSizePct <= args.maxPositionPct &&
                  dailyLossPct < args.maxDailyLossPct / 100;
                toolResult = {
                  allowed,
                  reason: allowed ? 'Within limits' : 
                    args.positionSizePct > args.maxPositionPct ? 'Position size exceeds maximum' :
                    'Daily loss limit exceeded',
                  positionSizePct: args.positionSizePct,
                  dailyLossPct: dailyLossPct * 100,
                  maxPositionPct: args.maxPositionPct,
                  maxDailyLossPct: args.maxDailyLossPct,
                };
                logger.info({ allowed, reason: toolResult.reason }, 'Tool: checkRiskLimits called');
              } else if (functionName === 'getHistoricalPerformance') {
                const historicalDecisions = await predictionTrainer.getHistoricalDecisions(
                  args.strategyId,
                  args.lookbackDays || 7
                );
                const recentTrades = await prisma.trade.findMany({
                  where: {
                    strategyId: args.strategyId,
                    exitPrice: { not: null }, // Only closed trades
                  },
                  orderBy: { timestamp: 'desc' },
                  take: 30,
                });
                const winRate = recentTrades.length > 0
                  ? recentTrades.filter(t => (t.pnl || 0) > 0).length / recentTrades.length
                  : 0;
                const avgPnl = recentTrades.length > 0
                  ? recentTrades.reduce((sum, t) => sum + (t.pnl || 0), 0) / recentTrades.length
                  : 0;
                toolResult = {
                  winRate: winRate * 100,
                  avgPnl,
                  totalTrades: recentTrades.length,
                  historicalDecisions: historicalDecisions.length,
                  recentPatterns: historicalDecisions.slice(0, 5).map(d => ({
                    action: d.decision.action,
                    confidence: d.decision.confidence,
                    outcome: d.outcome,
                  })),
                };
                logger.info({ winRate, avgPnl, totalTrades: recentTrades.length }, 'Tool: getHistoricalPerformance called');
              } else {
                toolResult = { error: `Unknown function: ${functionName}` };
              }
              } catch (error: any) {
                logger.error({ error, functionName }, 'Tool execution failed');
                toolResult = { error: error.message || 'Tool execution failed' };
              }

              // Add tool result to messages
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify(toolResult),
              });
            }

            iteration++;
            continue; // Continue loop to get final decision
          }

          // No tool calls - parse the decision
          const content = message.content;
          if (!content) {
            throw new Error('No content in OpenAI response');
          }

          decision = JSON.parse(content) as Decision & { reasoning?: any };
          break; // Exit loop with decision
        }

        if (!decision) {
          throw new Error('Failed to get decision after tool calls');
        }
      } else {
      // ASSIST mode: Simple call without function calling
      const response = await this.openai.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'trading_decision',
            schema: decisionSchema,
          },
        },
      });

      const message = response.choices[0]?.message;
      if (!message || !message.content) {
        throw new Error('No response from OpenAI');
      }

      decision = JSON.parse(message.content) as Decision & { reasoning?: any };

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

      // Clamp position size to max
      decision.targetPositionSizePct = Math.min(
        decision.targetPositionSizePct,
        context.riskLimits.maxPositionPct
      );
      }

      // Validate decision structure (shared for both modes)
      if (!decision || !['long', 'short', 'flat'].includes(decision.action)) {
        throw new Error(`Invalid action: ${decision?.action}`);
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

      // Adaptive confidence adjustment based on recent performance (only for FULL mode)
      if (useFunctionCalling) {
        const adjustedConfidence = this.adjustConfidenceByPerformance(decision.confidence, context.performance);
        const regimeAdjustment = this.getRegimePositionAdjustment(marketRegime);
        const adjustedPositionSize = decision.targetPositionSizePct * adjustedConfidence * regimeAdjustment;
        decision.targetPositionSizePct = Math.min(adjustedPositionSize, context.riskLimits.maxPositionPct);
        decision.confidence = adjustedConfidence;

        // Add reasoning to notes if available
        if (decision.reasoning) {
          decision.notes = `${decision.notes || ''}\n[Regime: ${decision.reasoning.marketRegime || marketRegime}, Risk: ${decision.reasoning.riskAssessment || 'medium'}]`.trim();
        }
      }

      // Enforce risk limits (shared for both modes)
      if (context.dailyPnl < 0 && Math.abs(context.dailyPnl) / context.currentEquity >= context.riskLimits.maxDailyLossPct / 100) {
        logger.warn('Daily loss limit exceeded, forcing flat position');
        return {
          action: 'flat',
          confidence: 0,
          targetPositionSizePct: 0,
          notes: 'Daily loss limit exceeded',
        };
      }

      // Clamp position size to max (shared for both modes)
      decision.targetPositionSizePct = Math.min(
        decision.targetPositionSizePct,
        context.riskLimits.maxPositionPct
      );

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
