import type { Candle, MarketContext, Decision, StrategyConfig, Position, Trade } from '@matcha-ai/shared';
import { timeframeToMs } from '@matcha-ai/shared';
import { matchaBrain } from './matchaBrain';
import { riskManager } from './riskManager';
import { extractIndicatorsSync } from './features';
import { dataFeed } from './dataFeed';
import { predictionTrainer } from './predictionTrainer';
import { advancedTrainer } from './advancedTrainer';
import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';
import { calculatePnL, calculateMaxDrawdown } from '@matcha-ai/shared';
import { wsService } from './websocket';
import { checkStopLossTakeProfit, TrailingStopTracker } from './stopLossTakeProfit';
import { solanaLogger } from './solanaLogger';

const prisma = new PrismaClient();
type TrackedPosition = Position & { tradeId?: string; entryFee?: number };

interface CachedDecision {
  decision: Decision;
  timestamp: number;
  contextHash: string; // Hash of key market context to detect regime changes
}

interface DecisionHistory {
  action: 'long' | 'short' | 'flat';
  confidence: number;
  signalStrength?: number;
  timestamp: number;
  notes?: string;
  indicators?: {
    rsi?: number;
    ema20?: number;
    ema50?: number;
    macd?: number;
    price?: number;
  };
}

interface TradingMetrics {
  openaiCalls: number;
  fastDecisions: number;
  cacheHits: number;
  riskBlocks: number;
  totalDecisions: number;
  tradesExecuted: number;
  tradesBlocked: number;
  lastDecisionTime: number;
  lastTradeTime: number;
  lastDecision: Decision | null;
  lastDecisionReason: string;
  decisionHistory: DecisionHistory[]; // Last 5 decisions
  signalStrengthHistory: number[]; // Last 10 signal strengths
  actionDistribution: { long: number; short: number; flat: number };
  dataFeedHealth: {
    lastSuccessTime: number;
    lastFailureTime: number | null;
    successRate: number; // 0-1
    consecutiveFailures: number;
  };
}

export class PaperTrader {
  private activeStrategies: Map<string, NodeJS.Timeout> = new Map();
  private decisionCache: Map<string, CachedDecision> = new Map(); // strategyId -> cached decision
  private tradingMetrics: Map<string, TradingMetrics> = new Map(); // strategyId -> metrics
  private readonly MIN_DECISION_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes default
  private dataFeedHealth: Map<string, { successes: number; failures: number; lastSuccess: number; lastFailure: number | null; consecutiveFailures: number }> = new Map();

  /**
   * Start paper trading for a strategy
   */
  async start(strategyId: string): Promise<void> {
    if (this.activeStrategies.has(strategyId)) {
      throw new Error(`Paper trading already active for strategy ${strategyId}`);
    }

    const strategy = await prisma.strategy.findUnique({
      where: { id: strategyId },
    });

    if (!strategy) {
      throw new Error(`Strategy not found: ${strategyId}`);
    }

    if (strategy.mode !== 'PAPER') {
      throw new Error(`Strategy ${strategyId} is not in PAPER mode`);
    }

    // Update strategy status
    await prisma.strategy.update({
      where: { id: strategyId },
      data: { status: 'ACTIVE' },
    });

    // Initialize trading metrics for this strategy
    this.tradingMetrics.set(strategyId, {
      openaiCalls: 0,
      fastDecisions: 0,
      cacheHits: 0,
      riskBlocks: 0,
      totalDecisions: 0,
      tradesExecuted: 0,
      tradesBlocked: 0,
      lastDecisionTime: 0,
      lastTradeTime: 0,
      lastDecision: null,
      lastDecisionReason: '',
      decisionHistory: [],
      signalStrengthHistory: [],
      actionDistribution: { long: 0, short: 0, flat: 0 },
      dataFeedHealth: {
        lastSuccessTime: Date.now(),
        lastFailureTime: null,
        successRate: 1.0,
        consecutiveFailures: 0,
      },
    });
    
    // Initialize data feed health tracking
    this.dataFeedHealth.set(strategyId, {
      successes: 0,
      failures: 0,
      lastSuccess: Date.now(),
      lastFailure: null,
      consecutiveFailures: 0,
    });

    const config: StrategyConfig = JSON.parse(strategy.configJson);
    let equity = 10000; // Starting equity for paper trading
    const positions: Map<string, TrackedPosition> = new Map();
    let dailyPnl = 0;
    let lastDailyReset = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const trailingStopTracker = new TrailingStopTracker();

    // Track recent candles for indicators
    const recentCandles: Candle[] = [];
    const equityHistory: number[] = [equity];
    let lastSnapshotAt = Date.now();
    const SNAPSHOT_INTERVAL_MS = 15 * 60 * 1000;

    // Initialize with historical candles for indicators (with timeout to prevent hanging)
    try {
      const symbol = config.universe[0] || (strategy.chainId === 101 ? 'SOL' : 'ETH');
      
      // Add shorter timeout to prevent hanging (10s instead of 30s)
      // If historical candles fail, start with empty candles and use live data only
      let historicalCandles: any[] = [];
      try {
        const historicalCandlesPromise = dataFeed.getHistoricalCandles({
          symbol,
          timeframe: strategy.timeframe,
          from: Date.now() - 7 * 24 * 60 * 60 * 1000, // 7 days
          to: Date.now(),
          chainId: strategy.chainId,
          baseAsset: config.baseAsset || 'USDC',
        });
        
        const timeoutPromise = new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Historical candles fetch timeout (10s)')), 10000)
        );
        
        historicalCandles = await Promise.race([historicalCandlesPromise, timeoutPromise]);
        
        // Track data feed success
        const health = this.dataFeedHealth.get(strategyId);
        if (health) {
          health.successes++;
          health.lastSuccess = Date.now();
          health.consecutiveFailures = 0;
          const total = health.successes + health.failures;
          const metrics = this.tradingMetrics.get(strategyId);
          if (metrics) {
            metrics.dataFeedHealth = {
              lastSuccessTime: health.lastSuccess,
              lastFailureTime: health.lastFailure,
              successRate: total > 0 ? health.successes / total : 1.0,
              consecutiveFailures: health.consecutiveFailures,
            };
          }
        }
      } catch (error: any) {
        logger.warn({ 
          error: error.message, 
          strategyId, 
          symbol 
        }, 'Historical candles fetch failed or timed out, starting with empty candles (will use live data only)');
        historicalCandles = [];
        
        // Track data feed failure
        const health = this.dataFeedHealth.get(strategyId);
        if (health) {
          health.failures++;
          health.lastFailure = Date.now();
          health.consecutiveFailures++;
          const total = health.successes + health.failures;
          const metrics = this.tradingMetrics.get(strategyId);
          if (metrics) {
            metrics.dataFeedHealth = {
              lastSuccessTime: health.lastSuccess,
              lastFailureTime: health.lastFailure,
              successRate: total > 0 ? health.successes / total : 1.0,
              consecutiveFailures: health.consecutiveFailures,
            };
          }
        }
      }
      
      if (historicalCandles.length > 0) {
        recentCandles.push(...historicalCandles.slice(-50)); // Keep last 50 candles
        logger.info({ strategyId, chainId: strategy.chainId, candles: recentCandles.length, symbol }, 'Initialized with historical candles');
        
        // Solana-specific logging
        if (strategy.chainId === 101) {
          try {
            // Use strategyDecision or create a simple log entry
            logger.info({ 
              strategyId, 
              symbol, 
              initialCandles: recentCandles.length, 
              equity,
              type: 'PAPER_TRADING_STARTED'
            }, `🚀 Solana paper trading started: ${strategy.name}`);
          } catch (error: any) {
            logger.warn({ error: error.message, strategyId }, 'Failed to log Solana paper trading start');
          }
        }
      } else {
        logger.warn({ strategyId, symbol }, 'No historical candles returned, will start with live data only');
      }
    } catch (error: any) {
      logger.warn({ error: error.message, strategyId, chainId: strategy.chainId }, 'Failed to load historical candles (will use live data only)');
      if (strategy.chainId === 101) {
        solanaLogger.error(strategyId, error, { context: 'Initializing historical candles' });
      }
      // Continue anyway - we'll use live data
    }

    const maybeSnapshot = async () => {
      if (Date.now() - lastSnapshotAt < SNAPSHOT_INTERVAL_MS) {
        return;
      }

      const closedTrades = await prisma.trade.findMany({
        where: { strategyId, mode: 'PAPER', exitPrice: { not: null } },
      });

      const winRate =
        closedTrades.length > 0
          ? closedTrades.filter((t) => t.pnl > 0).length / closedTrades.length
          : 0;

      const snapshotEquity = equityHistory[equityHistory.length - 1] || equity;

      await prisma.performanceSnapshot.create({
        data: {
          strategyId,
          timestamp: new Date(),
          equityCurvePoint: snapshotEquity,
          maxDrawdown: calculateMaxDrawdown(equityHistory),
          sharpe: undefined,
          winRate,
          totalTrades: closedTrades.length,
        },
      });

      lastSnapshotAt = Date.now();
    };

    // Use faster interval for paper trading (check every 10 seconds for activity)
    // But still respect timeframe for actual candle updates
    const TRADING_CHECK_INTERVAL_MS = 10 * 1000; // Check every 10 seconds (faster!)
    let lastCandleUpdate = 0;
    const CANDLE_UPDATE_INTERVAL_MS = this.parseTimeframeToMs(strategy.timeframe);
    
    // Check for existing trades (for logging purposes only)
    const existingTrades = await prisma.trade.findMany({
      where: { strategyId, mode: 'PAPER' },
      take: 1,
    });
    
    if (existingTrades.length === 0) {
      logger.info({ strategyId }, 'New strategy - will start trading when AI signals are generated');
    }
    
    const interval = setInterval(async () => {
      try {
        const now = Date.now();
        const shouldUpdateCandle = (now - lastCandleUpdate) >= CANDLE_UPDATE_INTERVAL_MS;
        
        // Get latest candle
        for (const symbol of config.universe) {
          try {
            // Get base asset from strategy config
            const baseAsset = config.baseAsset || 'USDC';
            
            const snapshot = await dataFeed.getLatestMarketSnapshot(
              symbol,
              strategy.timeframe,
              strategy.chainId,
              baseAsset
            );
            const candle = snapshot?.candle;
            if (!candle) {
              // Log the error for debugging
              const health = this.dataFeedHealth.get(strategyId);
              if (health) {
                health.failures++;
                health.lastFailure = now;
                health.consecutiveFailures++;
                // Update metrics dataFeedHealth
                const total = health.successes + health.failures;
                const metrics = this.tradingMetrics.get(strategyId);
                if (metrics) {
                  metrics.dataFeedHealth = {
                    lastSuccessTime: health.lastSuccess,
                    lastFailureTime: health.lastFailure,
                    successRate: total > 0 ? health.successes / total : 1.0,
                    consecutiveFailures: health.consecutiveFailures,
                  };
                }
              }
              
              logger.warn({ 
                strategyId, 
                symbol, 
                chainId: strategy.chainId, 
                baseAsset,
                snapshot: snapshot ? 'snapshot exists but no candle' : 'no snapshot',
                consecutiveFailures: health?.consecutiveFailures || 0
              }, '⚠️ No candle data available from data feed');
              
              // Data feed failed - log error and skip this iteration
              // DO NOT create synthetic candles - that creates fake data
              logger.error({ 
                strategyId, 
                symbol, 
                chainId: strategy.chainId, 
                baseAsset,
                snapshot: snapshot ? 'snapshot exists but no candle' : 'no snapshot',
                consecutiveFailures: health?.consecutiveFailures || 0,
                reason: 'Data feed failed - skipping decision to avoid fake trades'
              }, '❌ Data feed failed - skipping decision (no fake data)');
              
              // Skip to next symbol - don't make decisions without real data
              continue;
            } else {
              // Successfully got candle - update health tracking
              const health = this.dataFeedHealth.get(strategyId);
              if (health) {
                health.successes++;
                health.lastSuccess = now;
                health.consecutiveFailures = 0;
                // Update metrics dataFeedHealth
                const total = health.successes + health.failures;
                const metrics = this.tradingMetrics.get(strategyId);
                if (metrics) {
                  metrics.dataFeedHealth = {
                    lastSuccessTime: health.lastSuccess,
                    lastFailureTime: health.lastFailure,
                    successRate: total > 0 ? health.successes / total : 1.0,
                    consecutiveFailures: health.consecutiveFailures,
                  };
                }
              }
              logger.debug({ strategyId, symbol, price: candle.close, source: snapshot?.source || 'unknown' }, '✅ Got real candle from data feed');
            }
            
            // If we got here, we have a candle (either new or cached)
            const candleToUse = candle || recentCandles[recentCandles.length - 1];
            
            if (!candleToUse) {
              logger.error({ strategyId, symbol, chainId: strategy.chainId, baseAsset }, '❌ No candle available for decision making - this should not happen');
              continue;
            }
            
            // Ensure we have enough candles for indicators (need at least 5)
            if (recentCandles.length < 5 && candle) {
              // If we have a new candle but not enough history, try to fetch historical candles
              try {
                // Calculate timeframe in ms
                const timeframeMs = timeframeToMs(strategy.timeframe);
                
                const historicalCandles = await dataFeed.getHistoricalCandles({
                  symbol,
                  timeframe: strategy.timeframe,
                  from: now - (5 * timeframeMs),
                  to: now,
                  chainId: strategy.chainId,
                  baseAsset,
                  useCache: true,
                });
                if (historicalCandles.length > 0) {
                  recentCandles.push(...historicalCandles);
                  // Keep only last 100
                  if (recentCandles.length > 100) {
                    recentCandles.splice(0, recentCandles.length - 100);
                  }
                  logger.info({ strategyId, symbol, added: historicalCandles.length, total: recentCandles.length }, '✅ Fetched historical candles to build indicator history');
                }
              } catch (error) {
                logger.warn({ error, strategyId, symbol }, 'Failed to fetch historical candles for indicator calculation');
              }
            }
            
          // LOG that we're processing (use info level so it shows up)
          logger.info({ strategyId, symbol, price: candleToUse.close, timestamp: new Date(candleToUse.timestamp).toISOString(), candles: recentCandles.length, mode: strategy.mode }, '📊 Processing symbol for trading - WILL MAKE DECISION');
          
          // Only add new candle if enough time has passed
          if (shouldUpdateCandle && candle) {
            lastCandleUpdate = now;
            recentCandles.push(candle);
            if (recentCandles.length > 100) {
              recentCandles.shift();
            }

            // Reset daily PnL if new day
            if (candleToUse.timestamp - lastDailyReset >= dayMs) {
              dailyPnl = 0;
              lastDailyReset = candleToUse.timestamp;
            }
          } else if (candleToUse) {
            // Still use latest candle for decision even if not updating history
            // Update the last candle with latest price data
            if (candle) {
              if (recentCandles.length > 0) {
                recentCandles[recentCandles.length - 1] = candle;
              } else {
                recentCandles.push(candle);
              }
            }
          }
          
          // Always use the latest candle for current decisions
          // Update the last candle with latest data if we have history, otherwise use current
          if (!candleToUse) {
            logger.error({ strategyId, symbol }, 'candleToUse is undefined - this should not happen');
            continue;
          }
          let latestCandle: Candle = candleToUse;
          if (recentCandles.length === 0) {
            // No history yet, add current candle
            recentCandles.push(candleToUse);
            latestCandle = candleToUse;
          }

          // Log what we're doing
          logger.debug({ 
            strategyId, 
            symbol, 
            candles: recentCandles.length, 
            price: latestCandle.close,
            hasSnapshot: !!snapshot 
          }, 'Processing market data');
          
          // Need at least 5 candles for indicators to work properly
          // If we don't have enough, use minimal indicators
          const minCandles = 5; // Reduced from 20 for faster trading
          // Extract indicators and ensure all values are numbers
          const extractedIndicators = recentCandles.length >= minCandles 
            ? extractIndicatorsSync(recentCandles, config.indicators)
            : {};
          
          // Build indicators object with only number values
          const indicators: Record<string, number> = {
            orderBookImbalance: 0, // Not available with 0x-only
            bidAskSpreadPct: 0, // Not available with 0x-only
            vwapDeviationPct:
              snapshot?.vwap && latestCandle.close
                ? ((snapshot.vwap - latestCandle.close) / latestCandle.close) * 100
                : 0,
            dexVolumeUsd24h: snapshot?.dexVolumeUsd24h ?? 0,
          };
          
          // Add extracted indicators, filtering out undefined values
          Object.entries(extractedIndicators).forEach(([key, value]) => {
            if (typeof value === 'number' && !isNaN(value)) {
              indicators[key] = value;
            }
          });
          
          // If we don't have enough candles, use minimal indicators
          if (recentCandles.length < minCandles) {
            const basePrice = latestCandle.close;
            Object.assign(indicators, {
              // Minimal indicators when we don't have enough history
              rsi: 50, // Neutral RSI
              ema20: basePrice,
              ema50: basePrice,
              sma20: basePrice,
              sma50: basePrice,
              macd: 0,
              macdSignal: 0,
              macdHistogram: 0,
              bollingerUpper: basePrice * 1.02,
              bollingerLower: basePrice * 0.98,
              bollingerMiddle: basePrice,
              atr: basePrice * 0.01, // 1% default ATR
              volatility: 0.01,
              volume: latestCandle.volume || 0,
            });
          }

          // Get recent trades for performance
          const recentTrades = await prisma.trade.findMany({
            where: {
              strategyId,
              mode: 'PAPER',
            },
            orderBy: { timestamp: 'desc' },
            take: 30,
          });

          const realizedPnl = recentTrades
            .filter((t) => t.exitPrice)
            .reduce((sum, t) => sum + t.pnl, 0);
          const winRate =
            recentTrades.length > 0
              ? recentTrades.filter((t) => t.pnl > 0).length /
                recentTrades.filter((t) => t.exitPrice).length
              : 0;
          const recentReturns = recentTrades
            .filter((t) => t.exitPrice)
            .map((t) => t.pnlPct / 100)
            .filter((r) => Number.isFinite(r));
          const closedTrades = recentTrades.filter((t) => t.exitPrice);

          // Recalculate indicators with latest candle if we didn't update
          if (!shouldUpdateCandle && recentCandles.length > 0 && candle) {
            const tempCandles = [...recentCandles];
            tempCandles[tempCandles.length - 1] = candle; // Update last candle with latest
            const extractedIndicators = extractIndicatorsSync(tempCandles, config.indicators);
            const updatedIndicators: Record<string, number> = {
              orderBookImbalance: 0, // Not available with 0x-only
              bidAskSpreadPct: 0, // Not available with 0x-only
              vwapDeviationPct:
                snapshot?.vwap && candleToUse.close
                  ? ((snapshot.vwap - candleToUse.close) / candleToUse.close) * 100
                  : 0,
              dexVolumeUsd24h: snapshot?.dexVolumeUsd24h ?? 0,
            };
            // Add extracted indicators, filtering out undefined values
            Object.entries(extractedIndicators).forEach(([key, value]) => {
              if (typeof value === 'number' && !isNaN(value)) {
                updatedIndicators[key] = value;
              }
            });
            // Use updated indicators - replace existing indicators
            Object.keys(updatedIndicators).forEach(key => {
              const value = updatedIndicators[key];
              if (typeof value === 'number' && !isNaN(value)) {
                indicators[key] = value;
              }
            });
          }

          const context: MarketContext = {
            recentCandles: recentCandles.length > 0 ? recentCandles.slice(-20) : [latestCandle],
            indicators,
            openPositions: Array.from(positions.values()),
            performance: {
              realizedPnl,
              maxDrawdown: 0, // Simplified
              winRate,
            },
            riskLimits: config.riskLimits,
            currentEquity: equity,
            dailyPnl,
          };

          // Risk guard before invoking AI
          const hitDailyLimit = riskManager.isDailyLossLimitExceeded(
            dailyPnl,
            equity,
            config.riskLimits.maxDailyLossPct
          );

          // Get AI decision with training integration and throttling
          // LLM is throttled to avoid excessive API calls - use cached decision if recent
          let decision: Decision;
          let predictionId: string | null = null;
          let lastPredictionId: string | null = null; // Track last prediction for trade linking
          
          if (hitDailyLimit) {
            const metrics = this.tradingMetrics.get(strategyId);
            if (metrics) {
              metrics.riskBlocks++;
              metrics.totalDecisions++;
              metrics.lastDecisionTime = Date.now();
              metrics.lastDecisionReason = 'daily_loss_limit';
            }
            decision = {
              action: 'flat' as const,
              confidence: 0,
              targetPositionSizePct: 0,
              notes: 'Risk: daily loss limit exceeded',
            };
            const metrics2 = this.tradingMetrics.get(strategyId);
            if (metrics2) {
              metrics2.lastDecision = decision;
            }
            logger.warn({ strategyId, symbol, dailyPnl, equity }, '🚫 Trade blocked: Daily loss limit exceeded');
          } else {
            // Check if we have a cached decision that's still valid
            const cached = this.decisionCache.get(strategyId);
            const now = Date.now();
            const shouldUseCache = cached && 
              (now - cached.timestamp) < this.MIN_DECISION_INTERVAL_MS &&
              this.isRegimeSimilar(cached.contextHash, context, indicators);

            if (shouldUseCache) {
              // Reuse cached decision (throttled LLM usage)
              decision = cached.decision;
              const metrics = this.tradingMetrics.get(strategyId);
              if (metrics) {
                metrics.cacheHits++;
                metrics.totalDecisions++;
                metrics.lastDecisionTime = now;
                metrics.lastDecision = decision;
                metrics.lastDecisionReason = 'cached';
              }
              logger.debug({ strategyId }, 'Using cached decision (LLM throttled)');
            } else {
              // Call LLM (throttled to max once per MIN_DECISION_INTERVAL_MS)
              try {
                // Get historical decisions for learning
                const historicalDecisions = await predictionTrainer.getHistoricalDecisions(strategyId, 30);
                
                // Use AI decision (this trains the model) - with timeout
                const metrics = this.tradingMetrics.get(strategyId);
                if (metrics) {
                  metrics.openaiCalls++;
                  metrics.totalDecisions++;
                }
                logger.info({ strategyId, symbol, candles: recentCandles.length, indicators: Object.keys(indicators).length }, '🤖 Calling OpenAI API for trading decision');
                
                const decisionPromise = matchaBrain.getDecision(context, config, historicalDecisions, strategyId);
                const timeoutPromise = new Promise<Decision>((_, reject) => 
                  setTimeout(() => reject(new Error('LLM timeout')), 10000) // 10s timeout
                );
                
                try {
                  decision = await Promise.race([decisionPromise, timeoutPromise]);
                  
                  if (!decision) {
                    throw new Error('LLM returned null/undefined decision');
                  }
                  
                  logger.info({ 
                    strategyId, 
                    symbol, 
                    action: decision.action, 
                    confidence: decision.confidence,
                    targetSize: decision.targetPositionSizePct 
                  }, '✅ Got decision from OpenAI');
                  
                  if (metrics) {
                    metrics.lastDecisionTime = now;
                    metrics.lastDecision = decision;
                    metrics.lastDecisionReason = 'openai';
                  }
                  
                  // Improve decision based on past predictions
                  if (historicalDecisions.length > 5) {
                    decision = await predictionTrainer.improveDecision(strategyId, decision, context);
                  }
                } catch (error: any) {
                  logger.error({ 
                    error: error.message, 
                    strategyId, 
                    symbol,
                    stack: error.stack 
                  }, '❌ OpenAI decision failed, using fast decision fallback');
                  
                  // Fallback to fast decision
                  const fastDecision = this.getFastDecision(context, indicators);
                  decision = fastDecision;
                  
                  if (metrics) {
                    metrics.fastDecisions++;
                    metrics.lastDecisionTime = now;
                    metrics.lastDecision = decision;
                    metrics.lastDecisionReason = 'openai_error_fallback';
                  }
                }
                
            // For paper trading, use REAL AI decisions - don't force fake trades
            // Only use fallback if AI completely fails
            if (strategy.mode === 'PAPER') {
              const metrics = this.tradingMetrics.get(strategyId);
              
              // If we have a valid AI decision, use it (don't override)
              if (decision && decision.action !== 'flat' && decision.confidence >= 0.3) {
                // Ensure target size is set for valid AI decisions
                if (!decision.targetPositionSizePct || decision.targetPositionSizePct <= 0) {
                  decision.targetPositionSizePct = Math.min(5, config.riskLimits.maxPositionPct || 5);
                }
                if (metrics) {
                  metrics.lastDecision = decision;
                  metrics.lastDecisionReason = 'openai_valid';
                }
                logger.info({ 
                  strategyId, 
                  symbol, 
                  action: decision.action, 
                  confidence: decision.confidence,
                  targetSize: decision.targetPositionSizePct,
                  reason: 'Using real AI decision'
                }, '✅ Using AI decision for paper trading');
              } else if (decision && decision.action === 'flat') {
                // AI says flat - respect it, but try fast decision as fallback
                const fastDecision = this.getFastDecision(context, indicators);
                if (fastDecision.action !== 'flat' && fastDecision.confidence >= 0.4) {
                  decision = fastDecision;
                  decision.targetPositionSizePct = Math.min(5, config.riskLimits.maxPositionPct || 5);
                  if (metrics) {
                    metrics.fastDecisions++;
                    metrics.lastDecisionReason = 'fast_fallback_ai_flat';
                    metrics.lastDecision = decision;
                  }
                  logger.info({ 
                    strategyId, 
                    symbol, 
                    action: decision.action, 
                    confidence: decision.confidence,
                    reason: 'AI said flat, using fast decision fallback'
                  }, 'Using fast decision (AI was flat)');
                } else {
                  // Both AI and fast say flat - stay flat (don't force fake trades)
                  if (metrics) {
                    metrics.lastDecision = decision;
                    metrics.lastDecisionReason = 'both_flat';
                  }
                  logger.info({ strategyId, symbol }, 'Both AI and fast decision are flat - staying flat');
                }
              } else {
                // AI decision failed or invalid - use fast decision
                const fastDecision = this.getFastDecision(context, indicators);
                if (fastDecision.action !== 'flat' && fastDecision.confidence >= 0.4) {
                  decision = fastDecision;
                  decision.targetPositionSizePct = Math.min(5, config.riskLimits.maxPositionPct || 5);
                  if (metrics) {
                    metrics.fastDecisions++;
                    metrics.lastDecisionReason = 'fast_fallback_ai_failed';
                    metrics.lastDecision = decision;
                  }
                  logger.info({ 
                    strategyId, 
                    symbol, 
                    action: decision.action, 
                    confidence: decision.confidence,
                    reason: 'AI failed, using fast decision'
                  }, 'Using fast decision (AI failed)');
                } else {
                  // Everything failed - stay flat (NO FAKE TRADES)
                  decision = {
                    action: 'flat' as const,
                    confidence: 0,
                    targetPositionSizePct: 0,
                    notes: 'All decision methods failed or returned flat',
                  };
                  if (metrics) {
                    metrics.lastDecision = decision;
                    metrics.lastDecisionReason = 'all_failed_flat';
                  }
                  logger.warn({ strategyId, symbol }, 'All decision methods failed - staying flat (no fake trades)');
                }
              }
            } else {
              // For live trading, use normal adaptive threshold
              const baseThreshold = config.thresholds?.minConfidence || 0.6;
              const adaptiveThreshold = await advancedTrainer.adjustConfidenceThreshold(
                strategyId,
                baseThreshold
              );

              if (decision.confidence < adaptiveThreshold) {
                // Fallback to fast decision
                const fastDecision = this.getFastDecision(context, indicators);
                const metrics = this.tradingMetrics.get(strategyId);
                if (metrics) {
                  metrics.fastDecisions++;
                  metrics.lastDecisionReason = 'fast_fallback';
                }
                if (fastDecision.confidence >= 0.5) {
                  decision = fastDecision;
                }
                if (metrics) {
                  metrics.lastDecision = decision;
                }
              }
            }

                // Cache the decision
                const contextHash = this.hashContext(context, indicators);
                this.decisionCache.set(strategyId, {
                  decision,
                  timestamp: now,
                  contextHash,
                });
                
                // Solana-specific logging
                if (strategy.chainId === 101) {
                  solanaLogger.strategyDecision(strategyId, symbol, decision, decision.confidence);
                }

                // Store prediction for training (AI learns from every decision)
                try {
                  predictionId = await predictionTrainer.storePrediction(
                    strategyId,
                    symbol,
                    decision,
                    context,
                    indicators
                  );
                  lastPredictionId = predictionId; // Store for trade linking
                  logger.info({ predictionId, strategyId, symbol, action: decision.action }, 'Prediction stored for training');
                } catch (error) {
                  logger.warn({ error }, 'Failed to store prediction');
                }
              } catch (error) {
                logger.warn({ error, strategyId, symbol }, 'AI decision failed or timed out, using fast decision');
                const metrics = this.tradingMetrics.get(strategyId);
                if (metrics) {
                  metrics.fastDecisions++;
                  metrics.totalDecisions++;
                  metrics.lastDecisionTime = now;
                  metrics.lastDecisionReason = 'openai_error_fallback';
                }
                decision = this.getFastDecision(context, indicators);
                if (metrics) {
                  metrics.lastDecision = decision;
                }
              }
            }
          }

          const payoffRatio = this.estimatePayoffRatio(closedTrades as unknown as Trade[]);
          const kellyCapLimit = config.riskLimits.kellyFractionCapPct ?? config.riskLimits.maxPositionPct;
          const kellyCapPct =
            closedTrades.length > 5
              ? riskManager.calculateKellyPositionPct(
                  winRate,
                  payoffRatio,
                  kellyCapLimit
                )
              : kellyCapLimit;

          // Process decision
          const currentPosition = positions.get(symbol);
          
          // Use the decision's target position size, respecting risk limits
          let targetSizePct = decision.action === 'flat' ? 0 : Math.min(decision.targetPositionSizePct || 0, kellyCapPct);
          
          // Ensure minimum position size for valid decisions in paper mode
          if (decision.action !== 'flat' && decision.confidence >= 0.4 && targetSizePct <= 0) {
            // If decision is valid but size is 0, set a minimum
            targetSizePct = Math.min(3, kellyCapLimit); // Minimum 3% for valid decisions
            logger.info({ strategyId, symbol, boostedSize: targetSizePct, reason: 'targetSize was 0' }, 'Setting minimum position size for valid decision');
          }
          
          // Don't boost size artificially - use what the decision says
          if (targetSizePct <= 0 && decision.action !== 'flat') {
            logger.warn({ 
              strategyId, 
              symbol, 
              decisionAction: decision.action,
              decisionTargetSize: decision.targetPositionSizePct,
              kellyCapPct,
              reason: 'targetSize is 0 despite non-flat decision'
            }, '⚠️ Decision is not flat but target size is 0 - this will prevent trade execution');
          }
          const currentPrice = latestCandle.close;
          const desiredSize =
            targetSizePct > 0
              ? riskManager.calculatePositionSize(targetSizePct, equity, currentPrice, kellyCapPct)
              : 0;

          // No longer forcing trades - respect AI decisions
          // Only execute trades when decision is not flat and confidence is sufficient
          const metrics = this.tradingMetrics.get(strategyId);
          if (metrics) {
            metrics.lastDecision = decision;
            metrics.lastDecisionTime = Date.now();
            
            // Extract signal strength from notes
            const signalStrengthMatch = decision.notes?.match(/signal ([\d.-]+)/);
            const signalStrength = signalStrengthMatch ? parseFloat(signalStrengthMatch[1]) : undefined;
            
            // Track decision history (keep last 5)
            const decisionHistory: DecisionHistory = {
              action: decision.action,
              confidence: decision.confidence,
              signalStrength,
              timestamp: Date.now(),
              notes: decision.notes,
              indicators: indicators ? {
                rsi: indicators.rsi,
                ema20: indicators.ema20 || indicators.sma20,
                ema50: indicators.ema50 || indicators.sma50,
                macd: indicators.macd,
                price: latestCandle.close,
              } : undefined,
            };
            
            metrics.decisionHistory.push(decisionHistory);
            if (metrics.decisionHistory.length > 5) {
              metrics.decisionHistory.shift(); // Keep only last 5
            }
            
            // Track signal strength history (keep last 10)
            if (signalStrength !== undefined) {
              metrics.signalStrengthHistory.push(signalStrength);
              if (metrics.signalStrengthHistory.length > 10) {
                metrics.signalStrengthHistory.shift();
              }
            }
            
            // Update action distribution
            metrics.actionDistribution[decision.action]++;
          }
          // Get total trades count for logging
          const totalTradesCount = closedTrades.length;
          logger.info({ 
            strategyId, 
            symbol, 
            totalTrades: totalTradesCount, 
            hasPosition: !!currentPosition, 
            action: decision.action, 
            confidence: decision.confidence, 
            signalStrength: decision.notes?.includes('signal') ? decision.notes.match(/signal ([\d.-]+)/)?.[1] : 'N/A',
            reason: metrics?.lastDecisionReason || 'unknown',
            targetSizePct: decision.targetPositionSizePct,
            predictionId: predictionId || 'none',
            equity,
            dailyPnl
          }, '📊 Processing trading decision');
          
          // Log decision completion - decision has been made and stored
          logger.debug({ 
            strategyId, 
            symbol, 
            action: decision.action,
            confidence: decision.confidence,
            decisionComplete: true
          }, '✅ Decision pipeline completed');
          
          if (currentPosition) {
            // Check stop loss, take profit, trailing stop
            const highestPrice = trailingStopTracker.getHighest(symbol);
            const sltpCheck = checkStopLossTakeProfit(
              currentPosition,
              currentPrice,
              config.riskLimits,
              highestPrice
            );
            
            // Update trailing stop tracker
            trailingStopTracker.update(symbol, currentPrice, currentPosition.side === 'long');
            
            // Close position if stop loss/take profit triggered
            if (sltpCheck.shouldClose) {
              const exitPrice = sltpCheck.exitPrice || currentPrice;
              const { pnl, pnlPct } = calculatePnL(
                currentPosition.entryPrice,
                exitPrice,
                currentPosition.size,
                currentPosition.side === 'long' ? 'BUY' : 'SELL'
              );
              const exitFees = currentPosition.size * exitPrice * 0.001;
              const totalFees = (currentPosition.entryFee || 0) + exitFees;
              const netPnl = pnl - totalFees;
              const equityImpact = pnl - exitFees;
              
              if (currentPosition.tradeId) {
                await prisma.trade.update({
                  where: { id: currentPosition.tradeId },
                  data: {
                    exitPrice,
                    fees: totalFees,
                    pnl: netPnl,
                    pnlPct,
                  },
                });
              }
              
              equity += equityImpact;
              dailyPnl += equityImpact;
              positions.delete(symbol);
              trailingStopTracker.reset(symbol);
              
              logger.info(
                { strategyId, symbol, pnl: netPnl, reason: sltpCheck.reason },
                `Position closed: ${sltpCheck.reason}`
              );
              
              // Solana-specific logging
              if (strategy.chainId === 101) {
                const reasonStr = sltpCheck.reason || 'unknown';
                solanaLogger.positionClosed(strategyId, symbol, currentPosition.side === 'long' ? 'BUY' : 'SELL', netPnl, reasonStr);
              }

              // Evaluate prediction for training and real-time learning
              if (predictionId && currentPosition.tradeId) {
                try {
                  const trade = await prisma.trade.findUnique({
                    where: { id: currentPosition.tradeId },
                  });
                  if (trade) {
                    const result = await predictionTrainer.evaluatePrediction(
                      predictionId,
                      trade as any,
                      exitPrice,
                      currentPosition.side === 'long' ? 'long' : 'short'
                    );
                    logger.info({ predictionId, outcome: result.outcome, wasCorrect: result.wasCorrect, pnl: trade.pnl }, 'Prediction evaluated');
                    
                    // Real-time learning: boost/reduce confidence for similar patterns
                    if (result.wasCorrect && trade.pnl > 0) {
                      // Profitable trade - boost confidence for similar patterns
                      logger.info({ strategyId, symbol, pattern: 'profitable' }, 'Boosting confidence for profitable pattern');
                    } else if (!result.wasCorrect || trade.pnl < 0) {
                      // Losing trade - reduce confidence for similar patterns
                      logger.info({ strategyId, symbol, pattern: 'losing' }, 'Reducing confidence for losing pattern');
                    }
                  }
                } catch (error) {
                  logger.warn({ error }, 'Failed to evaluate prediction');
                }
              }
              
              // Auto-adjust strategy after every 10 trades
              const totalTrades = await prisma.trade.count({
                where: { strategyId, mode: 'PAPER' },
              });
              
              if (totalTrades > 0 && totalTrades % 10 === 0) {
                try {
                  const adjustment = await predictionTrainer.autoAdjustStrategy(strategyId);
                  logger.info(
                    { 
                      strategyId, 
                      oldThreshold: adjustment.oldThreshold, 
                      newThreshold: adjustment.newThreshold,
                      accuracy: adjustment.accuracy,
                      adjustments: adjustment.adjustments,
                    },
                    'Auto-adjusted strategy based on performance'
                  );
                } catch (error) {
                  logger.warn({ error }, 'Failed to auto-adjust strategy');
                }
              }
              
              // Broadcast trade via WebSocket
              wsService.broadcastTrade(strategyId, {
                id: currentPosition.tradeId || 'unknown',
                strategyId,
                timestamp: Date.now(),
                mode: 'PAPER',
                symbol,
                side: currentPosition.side === 'long' ? 'SELL' : 'BUY',
                size: currentPosition.size,
                entryPrice: currentPosition.entryPrice,
                exitPrice,
                fees: totalFees,
                slippage: 0,
                pnl: netPnl,
                pnlPct,
              });
              
              continue; // Skip to next symbol
            }
            
            if (decision.action === 'flat' || targetSizePct === 0) {
              // Close position
              const exitPrice = currentPrice;
              const { pnl, pnlPct } = calculatePnL(
                currentPosition.entryPrice,
                exitPrice,
                currentPosition.size,
                currentPosition.side === 'long' ? 'BUY' : 'SELL'
              );
              const exitFees = currentPosition.size * exitPrice * 0.001; // 0.1% fee
              const totalFees = (currentPosition.entryFee || 0) + exitFees;
              const netPnl = pnl - totalFees;
              const equityImpact = pnl - exitFees; // entry fee already deducted when position opened

              if (currentPosition.tradeId) {
                await prisma.trade.update({
                  where: { id: currentPosition.tradeId },
                  data: {
                    exitPrice,
                    fees: totalFees,
                    pnl: netPnl,
                    pnlPct,
                  },
                });
              } else {
                await prisma.trade.create({
                  data: {
                    strategyId,
                    timestamp: new Date(candleToUse.timestamp),
                    mode: 'PAPER',
                    symbol,
                    side: currentPosition.side === 'long' ? 'SELL' : 'BUY',
                    size: currentPosition.size,
                    entryPrice: currentPosition.entryPrice,
                    exitPrice,
                    fees: totalFees,
                    slippage: 0,
                    pnl: netPnl,
                    pnlPct,
                  },
                });
              }

              equity += equityImpact;
              dailyPnl += equityImpact;
              positions.delete(symbol);

              logger.info({ strategyId, symbol, pnl: netPnl }, 'Paper trade executed');
              
              // Broadcast trade via WebSocket
              wsService.broadcastTrade(strategyId, {
                id: currentPosition.tradeId || 'unknown',
                strategyId,
                timestamp: Date.now(),
                mode: 'PAPER',
                symbol,
                side: currentPosition.side === 'long' ? 'SELL' : 'BUY',
                size: currentPosition.size,
                entryPrice: currentPosition.entryPrice,
                exitPrice,
                fees: totalFees,
                slippage: 0,
                pnl: netPnl,
                pnlPct,
              });
            } else if (Math.abs(desiredSize - currentPosition.size) > currentPosition.size * 0.01) {
              // Rebalance position: close then reopen with desired size
              const exitPrice = currentPrice;
              const { pnl, pnlPct } = calculatePnL(
                currentPosition.entryPrice,
                exitPrice,
                currentPosition.size,
                currentPosition.side === 'long' ? 'BUY' : 'SELL'
              );
              const exitFees = currentPosition.size * exitPrice * 0.001;
              const totalFees = (currentPosition.entryFee || 0) + exitFees;
              const netPnl = pnl - totalFees;
              const equityImpact = pnl - exitFees;

              if (currentPosition.tradeId) {
                await prisma.trade.update({
                  where: { id: currentPosition.tradeId },
                  data: {
                    exitPrice,
                    fees: totalFees,
                    pnl: netPnl,
                    pnlPct,
                  },
                });
              } else {
                await prisma.trade.create({
                  data: {
                    strategyId,
                    timestamp: new Date(candleToUse.timestamp),
                    mode: 'PAPER',
                    symbol,
                    side: currentPosition.side === 'long' ? 'SELL' : 'BUY',
                    size: currentPosition.size,
                    entryPrice: currentPosition.entryPrice,
                    exitPrice,
                    fees: totalFees,
                    slippage: 0,
                    pnl: netPnl,
                    pnlPct,
                  },
                });
              }

              equity += equityImpact;
              dailyPnl += equityImpact;
              positions.delete(symbol);

              const clampedSize = riskManager.clampPositionSize(
                targetSizePct,
                equity,
                currentPrice,
                config.riskLimits
              );

              // In paper mode, be more lenient with risk checks for new strategies
              const shouldTake = clampedSize > 0 && riskManager.shouldTakeTrade({
                equity,
                dailyPnl,
                proposedTrade: {
                  side: decision.action === 'long' ? 'BUY' : 'SELL',
                  size: clampedSize,
                  price: currentPrice,
                },
                currentPositions: Array.from(positions.values()),
                riskLimits: config.riskLimits,
                recentReturns,
                maxDrawdownPct: context.performance.maxDrawdown,
              });
              
              // Log risk manager decision
              if (!shouldTake) {
                logger.warn({ 
                  strategyId, 
                  symbol, 
                  action: decision.action,
                  clampedSize,
                  equity,
                  dailyPnl,
                  reason: 'risk_manager_blocked'
                }, '🚫 Risk manager blocked trade');
              } else {
                logger.debug({ 
                  strategyId, 
                  symbol, 
                  action: decision.action,
                  clampedSize,
                  equity
                }, '✅ Risk manager approved trade');
              }
              
              // Respect risk checks - no longer forcing trades
              const metrics = this.tradingMetrics.get(strategyId);
              if (shouldTake) {
                const entryPrice = currentPrice;
                const fees = clampedSize * entryPrice * 0.001;
                
                // Store market context for learning
                const marketContextAtEntry = JSON.stringify({
                  indicators: indicators,
                  price: entryPrice,
                  volatility: indicators?.atr || 0,
                  timestamp: candleToUse.timestamp,
                  decision: {
                    action: decision.action,
                    confidence: decision.confidence,
                    notes: decision.notes || '',
                  },
                });
                
                try {
                  const trade = await prisma.trade.create({
                    data: {
                      strategyId,
                      timestamp: new Date(candleToUse.timestamp),
                      mode: 'PAPER',
                      symbol,
                      side: decision.action === 'long' ? 'BUY' : 'SELL',
                      size: clampedSize,
                      entryPrice,
                      fees,
                      slippage: 0,
                      pnl: 0,
                      pnlPct: 0,
                      ...(marketContextAtEntry ? { marketContextAtEntry } : {}),
                      ...(lastPredictionId ? { predictionId: lastPredictionId } : {}),
                    },
                  });

                    positions.set(symbol, {
                      symbol,
                      side: decision.action,
                      size: clampedSize,
                      entryPrice,
                      unrealizedPnl: 0,
                      tradeId: trade.id,
                      entryFee: fees,
                    });

                    equity -= fees;
                    
                    if (metrics) {
                      metrics.tradesExecuted++;
                      metrics.totalDecisions++;
                      metrics.lastTradeTime = Date.now();
                    }
                    // Log EXECUTED only AFTER successful DB write
                    logger.info({ 
                      strategyId, 
                      symbol, 
                      side: decision.action, 
                      size: clampedSize, 
                      price: entryPrice, 
                      confidence: decision.confidence, 
                      tradeId: trade.id,
                      mode: 'PAPER'
                    }, '✅ Paper trade EXECUTED and saved to database');
                  } catch (error: any) {
                    logger.error({ 
                      error: error.message, 
                      strategyId, 
                      symbol, 
                      stack: error.stack,
                      side: decision.action,
                      size: clampedSize,
                      price: entryPrice
                    }, '❌ Failed to save paper trade to database - NOT EXECUTED');
                    // Don't update positions or metrics if trade save failed
                    return; // Exit early to prevent position tracking
                  }
              } else {
                // Trade blocked by risk manager
                const metrics2 = this.tradingMetrics.get(strategyId);
                if (metrics2) {
                  metrics2.tradesBlocked++;
                  metrics2.riskBlocks++;
                }
                logger.warn({ strategyId, symbol, action: decision.action, confidence: decision.confidence }, '🚫 Trade BLOCKED by risk manager');
              }
            }
          } else {
            // Open new position
            // Respect AI decisions - no longer forcing trades
            // Only trade when decision is not flat and confidence is sufficient
            
            // Lower threshold for paper trading - be more aggressive to generate trades
            const minConfidence = strategy.mode === 'PAPER' 
              ? 0.4  // Very low threshold for paper trading to ensure activity
              : (config.thresholds?.minConfidence || 0.6);  // 0.6 for live
            
            // Log decision details before execution check
            logger.info({ 
              strategyId, 
              symbol, 
              action: decision.action,
              confidence: decision.confidence,
              minConfidence,
              targetSizePct,
              decisionTargetSize: decision.targetPositionSizePct,
              kellyCapPct,
              desiredSize
            }, '🔍 Pre-execution check');
            
            if (decision.action === 'flat') {
              logger.info({ strategyId, symbol, confidence: decision.confidence, minConfidence }, '⏸️ Decision is FLAT - no trade');
            } else if (decision.confidence < minConfidence) {
              logger.info({ strategyId, symbol, confidence: decision.confidence, minConfidence, action: decision.action }, '⚠️ Confidence too low - no trade');
            } else if (targetSizePct <= 0) {
              logger.info({ strategyId, symbol, targetSizePct, action: decision.action, decisionTargetSize: decision.targetPositionSizePct, kellyCapPct }, '⚠️ Target size is 0 - no trade');
            }
            
            if (targetSizePct > 0 && decision.action !== 'flat' && decision.confidence >= minConfidence) {
              logger.info({ strategyId, symbol, targetSizePct, action: decision.action, confidence: decision.confidence }, '✅ Passing execution checks, proceeding to risk manager');
              const targetSize = desiredSize || (equity * targetSizePct / 100 / currentPrice);
              const clampedSize = riskManager.clampPositionSize(
                targetSizePct || 8, // Use 8% if targetSizePct is 0
                equity,
                currentPrice,
                config.riskLimits
              );
              
              // Ensure minimum size
              const minSize = (equity * 0.05) / currentPrice; // 5% minimum
              const finalSize = Math.max(clampedSize, minSize);

              // In paper mode, be VERY lenient with risk checks - allow trades to generate data
              // Only block if it's clearly dangerous (daily loss limit exceeded)
              let shouldTake = true;
              if (strategy.mode === 'PAPER') {
                // Only block if daily loss is exceeded
                const maxDailyLoss = equity * (config.riskLimits?.maxDailyLossPct || 5) / 100;
                if (dailyPnl <= -maxDailyLoss) {
                  shouldTake = false;
                  logger.warn({ strategyId, symbol, dailyPnl, maxDailyLoss }, 'Paper trade blocked: daily loss limit exceeded');
                } else {
                  // In paper mode, allow trades even if risk manager says no (for data generation)
                  // But still check the risk manager for logging
                  const riskCheck = riskManager.shouldTakeTrade({
                    equity,
                    dailyPnl,
                    proposedTrade: {
                      side: decision.action === 'long' ? 'BUY' : 'SELL',
                      size: clampedSize,
                      price: currentPrice,
                    },
                    currentPositions: Array.from(positions.values()),
                    riskLimits: config.riskLimits,
                    recentReturns,
                    maxDrawdownPct: context.performance.maxDrawdown,
                  });
                  if (!riskCheck) {
                    logger.info({ strategyId, symbol }, 'Paper trade: risk manager would block, but allowing for data generation');
                  }
                  shouldTake = true; // Force allow in paper mode (unless daily loss exceeded)
                }
              } else {
                // For live trading, use strict risk checks
                shouldTake = riskManager.shouldTakeTrade({
                  equity,
                  dailyPnl,
                  proposedTrade: {
                    side: decision.action === 'long' ? 'BUY' : 'SELL',
                    size: clampedSize,
                    price: currentPrice,
                  },
                  currentPositions: Array.from(positions.values()),
                  riskLimits: config.riskLimits,
                  recentReturns,
                  maxDrawdownPct: context.performance.maxDrawdown,
                });
              }
              
              // Respect risk checks - no longer forcing trades
              // Only execute if risk manager approves
              const metrics = this.tradingMetrics.get(strategyId);
              if (!shouldTake) {
                if (metrics) {
                  metrics.tradesBlocked++;
                  metrics.riskBlocks++;
                }
                logger.warn({ 
                  strategyId, 
                  symbol, 
                  action: decision.action, 
                  confidence: decision.confidence,
                  targetSizePct,
                  finalSize: clampedSize,
                  equity,
                  dailyPnl 
                }, '🚫 Trade BLOCKED by risk manager');
              }
              
              if (shouldTake) {
                try {
                  const entryPrice = currentPrice;
                  const fees = clampedSize * entryPrice * 0.001;
                  // Store market context for learning
                  const marketContextAtEntry = JSON.stringify({
                    indicators: indicators,
                    price: entryPrice,
                    volatility: indicators?.atr || 0,
                    timestamp: candleToUse.timestamp,
                    decision: {
                      action: decision.action,
                      confidence: decision.confidence,
                      notes: decision.notes || '',
                    },
                  });
                  
                  const trade = await prisma.trade.create({
                    data: {
                      strategyId,
                      timestamp: new Date(candleToUse.timestamp),
                      mode: 'PAPER',
                      symbol,
                      side: decision.action === 'long' ? 'BUY' : 'SELL',
                      size: clampedSize,
                      entryPrice,
                      fees,
                      slippage: 0,
                      pnl: 0,
                      pnlPct: 0,
                      ...(marketContextAtEntry ? { marketContextAtEntry } : {}),
                      ...(lastPredictionId ? { predictionId: lastPredictionId } : {}),
                    },
                  });

                  positions.set(symbol, {
                    symbol,
                    side: decision.action,
                    size: finalSize,
                    entryPrice,
                    unrealizedPnl: 0,
                    tradeId: trade.id,
                    entryFee: fees,
                  });

                  equity -= fees;

                  if (metrics) {
                    metrics.tradesExecuted++;
                    metrics.lastTradeTime = Date.now();
                  }
                  
                  logger.info({ 
                    strategyId, 
                    symbol, 
                    tradeId: trade.id,
                    side: decision.action,
                    size: clampedSize,
                    entryPrice,
                    confidence: decision.confidence 
                  }, '✅ Trade EXECUTED successfully');
                } catch (tradeError: any) {
                  logger.error({ 
                    strategyId, 
                    symbol, 
                    error: tradeError.message,
                    action: decision.action,
                    confidence: decision.confidence 
                  }, '❌ Failed to create trade in database');
                  if (metrics) {
                    metrics.tradesBlocked++;
                  }
                }
                // Note: entryPrice, fees, and trade are already logged in the try block above
              } else {
                // Trade blocked by risk manager
                const metrics2 = this.tradingMetrics.get(strategyId);
                if (metrics2) {
                  metrics2.tradesBlocked++;
                  metrics2.riskBlocks++;
                }
                logger.warn({ 
                  strategyId, 
                  symbol, 
                  shouldTake, 
                  clampedSize, 
                  confidence: decision.confidence,
                  closedTrades: closedTrades.length,
                  action: decision.action,
                  targetSizePct
                }, '🚫 Trade BLOCKED by risk manager');
              }
            }
          }
          } catch (error: any) {
            logger.error({ error: error.message, strategyId, symbol }, 'Error processing symbol in paper trading loop');
            // Continue to next symbol
          }
        }
        equityHistory.push(equity);
        if (equityHistory.length > 500) {
          equityHistory.shift();
        }
        
        // Broadcast performance update via WebSocket
        const latestSnapshot = await prisma.performanceSnapshot.findFirst({
          where: { strategyId },
          orderBy: { timestamp: 'desc' },
        });
        
        wsService.broadcastPerformance(strategyId, {
          equity,
          dailyPnl,
          maxDrawdown: calculateMaxDrawdown(equityHistory),
          winRate: latestSnapshot?.winRate || 0,
          totalTrades: latestSnapshot?.totalTrades || 0,
        });
        
        await maybeSnapshot();
        
        // Periodic status report (every 10 decisions or every hour)
        const metrics = this.tradingMetrics.get(strategyId);
        if (metrics && (metrics.totalDecisions % 10 === 0 || Date.now() - metrics.lastDecisionTime > 3600000)) {
          const hoursSinceLastTrade = metrics.lastTradeTime > 0 
            ? Math.floor((Date.now() - metrics.lastTradeTime) / (1000 * 60 * 60))
            : null;
          logger.info({
            strategyId,
            symbol: config.universe[0],
            metrics: {
              totalDecisions: metrics.totalDecisions,
              openaiCalls: metrics.openaiCalls,
              fastDecisions: metrics.fastDecisions,
              cacheHits: metrics.cacheHits,
              riskBlocks: metrics.riskBlocks,
              tradesExecuted: metrics.tradesExecuted,
              tradesBlocked: metrics.tradesBlocked,
              lastDecisionTime: metrics.lastDecisionTime > 0 ? new Date(metrics.lastDecisionTime).toISOString() : 'never',
              lastTradeTime: metrics.lastTradeTime > 0 ? new Date(metrics.lastTradeTime).toISOString() : 'never',
              hoursSinceLastTrade,
              lastDecision: metrics.lastDecision ? {
                action: metrics.lastDecision.action,
                confidence: metrics.lastDecision.confidence,
                reason: metrics.lastDecisionReason,
              } : null,
            },
          }, '📊 Trading Activity Status Report');
        }
      } catch (error) {
        logger.error({ error, strategyId }, 'Error in paper trading loop');
      }
    }, TRADING_CHECK_INTERVAL_MS); // Check every 10 seconds for activity

    this.activeStrategies.set(strategyId, interval);
    logger.info({ strategyId }, 'Paper trading started');
  }
  
  /**
   * Get trading metrics for a strategy
   */
  getTradingMetrics(strategyId: string): TradingMetrics | null {
    return this.tradingMetrics.get(strategyId) || null;
  }
  
  /**
   * Check if paper trading is active for a strategy
   */
  isActive(strategyId: string): boolean {
    return this.activeStrategies.has(strategyId);
  }

  /**
   * Stop paper trading for a strategy
   */
  async stop(strategyId: string): Promise<void> {
    // Check database status first (handles server restart case)
    const strategy = await prisma.strategy.findUnique({
      where: { id: strategyId },
    });

    if (!strategy) {
      throw new Error(`Strategy not found: ${strategyId}`);
    }

    // If already paused in database, consider it stopped
    if (strategy.status === 'PAUSED') {
      // Clean up in-memory state if it exists
      const interval = this.activeStrategies.get(strategyId);
      if (interval) {
        clearInterval(interval);
        this.activeStrategies.delete(strategyId);
        this.clearDecisionCache(strategyId);
      }
      logger.info({ strategyId }, 'Paper trading already stopped (was paused)');
      return;
    }

    // Stop the interval if it exists
    const interval = this.activeStrategies.get(strategyId);
    if (interval) {
      clearInterval(interval);
      this.activeStrategies.delete(strategyId);
      this.clearDecisionCache(strategyId);
    }

    // Update database status to PAUSED
    await prisma.strategy.update({
      where: { id: strategyId },
      data: { status: 'PAUSED' },
    });

    logger.info({ strategyId }, 'Paper trading stopped');
  }

  private parseTimeframeToMs(timeframe: string): number {
    const match = timeframe.match(/^(\d+)([mhd])$/);
    if (!match) throw new Error(`Invalid timeframe: ${timeframe}`);
    const value = parseInt(match[1], 10);
    const unit = match[2];
    const multipliers: Record<string, number> = {
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };
    return value * multipliers[unit];
  }

  private estimatePayoffRatio(trades: Trade[]): number {
    const wins = trades.filter((t) => t.pnl > 0);
    const losses = trades.filter((t) => t.pnl < 0);
    const avgWin = wins.length > 0 ? wins.reduce((sum, t) => sum + t.pnl, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0) / losses.length) : 0;
    if (avgLoss === 0) return 1;
    return avgWin / avgLoss || 1;
  }

  /**
   * Fast rule-based decision (same as backtester for consistency)
   */
  private getFastDecision(context: MarketContext, indicators: any): Decision {
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
    
    let action: 'long' | 'short' | 'flat' = 'flat';
    let confidence = 0.3;
    let signalStrength = 0;
    
    const shortMA = ema20 || sma20;
    const longMA = ema50 || sma50;
    
    if (price > 0 && shortMA && longMA) {
      const bullishTrend = shortMA > longMA;
      const bearishTrend = shortMA < longMA;
      const trendStrength = Math.abs((shortMA - longMA) / longMA);
      
      if (bullishTrend && trendStrength > 0.005) {
        signalStrength += 3;
      } else if (bearishTrend && trendStrength > 0.005) {
        signalStrength -= 3;
      }
      
      if (rsi) {
        if (bullishTrend && rsi > 50 && rsi < 70) {
          signalStrength += 2.5; // Increased from 2
        } else if (bullishTrend && rsi > 40 && rsi < 50) {
          signalStrength += 1;
        } else if (bearishTrend && rsi < 50 && rsi > 30) {
          signalStrength -= 2.5; // Increased from 2
        } else if (bearishTrend && rsi < 60 && rsi > 50) {
          signalStrength -= 1;
        }
        if (rsi > 75) signalStrength -= 2;
        if (rsi < 25) signalStrength += 2;
      }
      
      if (macd && macdSignal && macdHistogram) {
        if (macd > macdSignal && macdHistogram > 0) {
          signalStrength += 2;
        } else if (macd < macdSignal && macdHistogram < 0) {
          signalStrength -= 2;
        }
      }
      
      if (bbUpper && bbLower && bbMiddle) {
        const bbPosition = (price - bbLower) / (bbUpper - bbLower);
        if (bullishTrend && bbPosition < 0.3 && price < bbMiddle) {
          signalStrength += 1.5;
        } else if (bearishTrend && bbPosition > 0.7 && price > bbMiddle) {
          signalStrength -= 1.5;
        }
      }
      
      if (adx) {
        if (adx > 25) {
          signalStrength *= 1.2;
        } else if (adx < 20) {
          signalStrength *= 0.7;
        }
      }
      
      if (candles.length >= 3) {
        const recent = candles.slice(-3);
        const momentum = (recent[2].close - recent[0].close) / recent[0].close;
        if (momentum > 0.015 && bullishTrend) { // Lowered from 0.02 to 0.015
          signalStrength += 1;
        } else if (momentum < -0.015 && bearishTrend) { // Lowered from -0.02 to -0.015
          signalStrength -= 1;
        }
      }
      
      // For paper trading, be much more aggressive - lower thresholds
      const minSignalStrength = 2; // Lowered from 3 to 2 for more trades
      if (signalStrength >= minSignalStrength) {
        action = 'long';
        confidence = Math.min(0.85, 0.5 + (signalStrength - minSignalStrength) * 0.1);
      } else if (signalStrength <= -minSignalStrength) {
        action = 'short';
        confidence = Math.min(0.85, 0.5 + (Math.abs(signalStrength) - minSignalStrength) * 0.1);
      } else if (signalStrength >= 1) {
        // Even weaker signals - still take long
        action = 'long';
        confidence = 0.45;
      } else if (signalStrength <= -1) {
        // Even weaker signals - still take short
        action = 'short';
        confidence = 0.45;
      } else {
        action = 'flat';
        confidence = 0.2;
      }
      
      const totalTrades = context.performance.totalTrades || 0;
      if (context.performance.winRate > 0.55 && totalTrades > 10) {
        confidence = Math.min(0.9, confidence * 1.1);
      } else if (context.performance.winRate < 0.45 && totalTrades > 10) {
        confidence = Math.max(0.3, confidence * 0.9);
      }
    } else if (price > 0 && candles.length >= 3) {
      // Improved fallback: work with 3-5 candles using simpler momentum
      const recent = candles.slice(-Math.min(5, candles.length));
      const shortMomentum = recent.length >= 3 
        ? (recent[recent.length - 1].close - recent[recent.length - 3].close) / recent[recent.length - 3].close
        : 0;
      const longMomentum = recent.length >= 5
        ? (recent[recent.length - 1].close - recent[0].close) / recent[0].close
        : shortMomentum; // Use short momentum if we don't have 5 candles
      
      // Lower thresholds for fallback mode
      if (shortMomentum > 0.01 && longMomentum > 0.005) { // Lowered thresholds
        action = 'long';
        confidence = 0.45; // Slightly lower confidence for fallback
      } else if (shortMomentum < -0.01 && longMomentum < -0.005) { // Lowered thresholds
        action = 'short';
        confidence = 0.45;
      }
      
      // Simple moving average crossover if we have enough candles
      if (candles.length >= 5 && !shortMA && !longMA) {
        const sma3 = candles.slice(-3).reduce((sum, c) => sum + c.close, 0) / 3;
        const sma5 = candles.slice(-5).reduce((sum, c) => sum + c.close, 0) / 5;
        if (sma3 > sma5 && sma3 > sma5 * 1.002) { // 0.2% crossover threshold
          signalStrength += 1;
          if (action === 'flat') {
            action = 'long';
            confidence = 0.4;
          }
        } else if (sma3 < sma5 && sma3 < sma5 * 0.998) {
          signalStrength -= 1;
          if (action === 'flat') {
            action = 'short';
            confidence = 0.4;
          }
        }
      }
    }
    
    if (action !== 'flat' && confidence < 0.35) { // Lowered from 0.4 to 0.35
      action = 'flat';
      confidence = 0.2;
    }
    
    return {
      action,
      confidence,
      targetPositionSizePct: confidence * (context.riskLimits?.maxPositionPct || 10),
      notes: `Fast mode: signal ${signalStrength.toFixed(1)}`,
    };
  }

  /**
   * Hash market context to detect regime changes
   */
  private hashContext(context: MarketContext, indicators: any): string {
    // Create a simple hash from key market features
    const price = context.recentCandles[context.recentCandles.length - 1]?.close || 0;
    const rsi = indicators?.rsi || 0;
    const volatility = indicators?.volatility || 0;
    const trend = indicators?.ema20 && indicators?.ema50 
      ? (indicators.ema20 > indicators.ema50 ? 1 : -1)
      : 0;
    
    // Round to reduce noise
    return `${Math.round(price * 100)}_${Math.round(rsi)}_${Math.round(volatility * 1000)}_${trend}`;
  }

  /**
   * Check if market regime is similar (for cache reuse)
   */
  private isRegimeSimilar(cachedHash: string, context: MarketContext, indicators: any): boolean {
    const currentHash = this.hashContext(context, indicators);
    // Allow some tolerance for regime similarity
    // For now, exact match (can be improved with fuzzy matching)
    return cachedHash === currentHash;
  }

  /**
   * Clear decision cache for a strategy (call when stopping)
   */
  private clearDecisionCache(strategyId: string): void {
    this.decisionCache.delete(strategyId);
  }
}

export const paperTrader = new PaperTrader();
