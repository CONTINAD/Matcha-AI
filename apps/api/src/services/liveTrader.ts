import type { Candle, MarketContext, Decision, StrategyConfig, Position, ZeroXSwapTx, Trade } from '@matcha-ai/shared';
import { matchaBrain } from './matchaBrain';
import { riskManager } from './riskManager';
import { extractIndicatorsSync } from './features';
import { dataFeed } from './dataFeed';
import { zeroExService } from './zeroExService';
import { getTokenAddress } from '@matcha-ai/shared';
import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';
import { config } from '../config/env';

const prisma = new PrismaClient();

export interface PendingTrade {
  strategyId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  size: number;
  price: number;
  swapTx: ZeroXSwapTx;
  timestamp: number;
}

interface CachedDecision {
  decision: Decision;
  timestamp: number;
  contextHash: string;
}

export class LiveTrader {
  private activeStrategies: Map<string, NodeJS.Timeout> = new Map();
  private pendingTrades: Map<string, PendingTrade> = new Map(); // strategyId -> pending trade
  private decisionCache: Map<string, CachedDecision> = new Map(); // strategyId -> cached decision
  private readonly MIN_DECISION_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes default

  /**
   * Start live trading for a strategy
   * NON-CUSTODIAL: Builds transactions for frontend signing, never signs server-side
   */
  async start(strategyId: string, walletId?: string): Promise<void> {
    if (this.activeStrategies.has(strategyId)) {
      throw new Error(`Live trading already active for strategy ${strategyId}`);
    }

    const strategy = await prisma.strategy.findUnique({
      where: { id: strategyId },
    });

    if (!strategy) {
      throw new Error(`Strategy not found: ${strategyId}`);
    }

    if (strategy.mode !== 'LIVE') {
      throw new Error(`Strategy ${strategyId} is not in LIVE mode`);
    }

    // Solana live trading toggle
    if (strategy.chainId === 101 && !config.trading.enableSolanaLive) {
      throw new Error(
        'Solana live trading is currently disabled in config. Enable ENABLE_SOLANA_LIVE=true to turn it on. For now, use SIMULATION or PAPER mode for Solana strategies, or switch to an EVM chain (Ethereum, Polygon, Arbitrum) for live trading.'
      );
    }

    await prisma.strategy.update({
      where: { id: strategyId },
      data: { status: 'ACTIVE' },
    });

    const strategyConfig: StrategyConfig = JSON.parse(strategy.configJson);
    const positions: Map<string, Position> = new Map();
    let dailyPnl = 0;
    let lastDailyReset = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const recentCandles: Candle[] = [];

    const interval = setInterval(async () => {
      try {
        for (const symbol of strategyConfig.universe) {
          const snapshot = await dataFeed.getLatestMarketSnapshot(
            symbol,
            strategy.timeframe,
            strategy.chainId
          );
          const candle = snapshot?.candle;
          if (!candle) continue;

          recentCandles.push(candle);
          if (recentCandles.length > 100) {
            recentCandles.shift();
          }

          if (candle.timestamp - lastDailyReset >= dayMs) {
            dailyPnl = 0;
            lastDailyReset = candle.timestamp;
          }

          const indicators = {
            ...extractIndicatorsSync(recentCandles, strategyConfig.indicators),
            orderBookImbalance: 0, // Not available with 0x-only
            bidAskSpreadPct: 0, // Not available with 0x-only
            vwapDeviationPct:
              snapshot?.vwap && candle.close
                ? ((snapshot.vwap - candle.close) / candle.close) * 100
                : 0,
            dexVolumeUsd24h: snapshot?.dexVolumeUsd24h ?? 0,
          };

          const recentTrades = await prisma.trade.findMany({
            where: {
              strategyId,
              mode: 'LIVE',
            },
            orderBy: { timestamp: 'desc' },
            take: 30,
          });

          const realizedPnl = recentTrades
            .filter((t: any) => t.exitPrice)
            .reduce((sum: number, t: any) => sum + t.pnl, 0);
          const winRate =
            recentTrades.length > 0
              ? recentTrades.filter((t: any) => t.pnl > 0).length /
                recentTrades.filter((t: any) => t.exitPrice).length
              : 0;
          const closedTrades = recentTrades.filter((t: any) => t.exitPrice);
          const recentReturns = closedTrades
            .map((t: any) => t.pnlPct / 100)
            .filter((r: number) => Number.isFinite(r));

          // Get current equity from recent trades (simplified)
          const equity = 10000 + realizedPnl; // Starting equity + realized PnL

          const context: MarketContext = {
            recentCandles: recentCandles.slice(-20),
            indicators,
            openPositions: Array.from(positions.values()),
            performance: {
              realizedPnl,
              maxDrawdown: 0,
              winRate,
            },
            riskLimits: strategyConfig.riskLimits,
            currentEquity: equity,
            dailyPnl,
          };

          const hitDailyLimit = riskManager.isDailyLossLimitExceeded(
            dailyPnl,
            equity,
            strategyConfig.riskLimits.maxDailyLossPct
          );

          // Get decision with LLM throttling
          let decision: Decision;
          if (hitDailyLimit) {
            decision = {
              action: 'flat' as const,
              confidence: 0,
              targetPositionSizePct: 0,
              notes: 'Risk: daily loss limit exceeded',
            };
          } else {
            // Check cache first
            const cached = this.decisionCache.get(strategyId);
            const now = Date.now();
            const shouldUseCache = cached && 
              (now - cached.timestamp) < this.MIN_DECISION_INTERVAL_MS &&
              this.isRegimeSimilar(cached.contextHash, context, indicators);

            if (shouldUseCache) {
              decision = cached.decision;
              logger.debug({ strategyId }, 'Using cached decision (LLM throttled)');
            } else {
              try {
                // Get historical decisions for learning
                const historicalDecisions = await predictionTrainer.getHistoricalDecisions(strategyId, 30);
                
                // Call LLM with timeout
                const decisionPromise = matchaBrain.getDecision(context, strategyConfig, historicalDecisions, strategyId);
                const timeoutPromise = new Promise<Decision>((_, reject) => 
                  setTimeout(() => reject(new Error('LLM timeout')), 10000)
                );
                decision = await Promise.race([decisionPromise, timeoutPromise]);
                
                // Cache the decision
                const contextHash = this.hashContext(context, indicators);
                this.decisionCache.set(strategyId, {
                  decision,
                  timestamp: now,
                  contextHash,
                });
              } catch (error) {
                logger.warn({ error }, 'LLM decision failed or timed out, using fast fallback');
                // Fallback to rule-based decision
                decision = this.getFastDecision(context, indicators);
              }
            }
          }

          const payoffRatio = this.estimatePayoffRatio(closedTrades as unknown as Trade[]);
          const kellyCapLimit = strategyConfig.riskLimits.kellyFractionCapPct ?? strategyConfig.riskLimits.maxPositionPct;
          const kellyCapPct =
            closedTrades.length > 5
              ? riskManager.calculateKellyPositionPct(
                  winRate,
                  payoffRatio,
                  kellyCapLimit
                )
              : kellyCapLimit;

          const currentPosition = positions.get(symbol);
          const targetSizePct =
            decision.action === 'flat' ? 0 : Math.min(decision.targetPositionSizePct, kellyCapPct);

          if (currentPosition) {
            if (decision.action === 'flat' || targetSizePct === 0) {
              // Close position - build swap tx
              const baseToken = getTokenAddress(strategyConfig.baseAsset, strategy.chainId);
              const quoteToken = getTokenAddress(symbol, strategy.chainId);
              if (!baseToken || !quoteToken) {
                logger.warn({ symbol, baseAsset: strategyConfig.baseAsset }, 'Token address not found');
                continue;
              }

              // For closing: sell the position token for base asset
              const sellAmount = (currentPosition.size * currentPosition.entryPrice).toString();
              const slippageBps = 50; // 0.5%

              try {
                const swapTx = await zeroExService.buildSwapTx({
                  chainId: strategy.chainId,
                  sellToken: quoteToken,
                  buyToken: baseToken,
                  amount: sellAmount,
                  slippageBps,
                });

                // Store pending trade for user to sign
                const pendingTrade: PendingTrade = {
                  strategyId,
                  symbol,
                  side: currentPosition.side === 'long' ? 'SELL' : 'BUY',
                  size: currentPosition.size,
                  price: candle.close,
                  swapTx,
                  timestamp: Date.now(),
                };

                this.pendingTrades.set(strategyId, pendingTrade);
                logger.info({ strategyId, symbol }, 'Pending live trade created (awaiting signature)');
              } catch (error) {
                logger.error({ error, strategyId, symbol }, 'Error building swap tx');
              }
            }
          } else {
            // Open new position
            if (targetSizePct > 0 && decision.action !== 'flat') {
              const targetSize = riskManager.calculatePositionSize(
                targetSizePct,
                equity,
                candle.close,
                kellyCapPct
              );
              const clampedSize = riskManager.clampPositionSize(
                targetSizePct,
                equity,
                candle.close,
                strategyConfig.riskLimits
              );

              if (
                riskManager.shouldTakeTrade({
                  equity,
                  dailyPnl,
                  proposedTrade: {
                    side: decision.action === 'long' ? 'BUY' : 'SELL',
                    size: clampedSize,
                    price: candle.close,
                  },
                  currentPositions: Array.from(positions.values()),
                  riskLimits: strategyConfig.riskLimits,
                  recentReturns,
                  maxDrawdownPct: context.performance.maxDrawdown,
                })
              ) {
                const baseToken = getTokenAddress(strategyConfig.baseAsset, strategy.chainId);
                const quoteToken = getTokenAddress(symbol, strategy.chainId);
                if (!baseToken || !quoteToken) {
                  logger.warn({ symbol }, 'Token address not found');
                  continue;
                }

                // For opening: buy the position token with base asset
                const buyAmount = (clampedSize * candle.close).toString();
                const slippageBps = 50;

                try {
                  const swapTx = await zeroExService.buildSwapTx({
                    chainId: strategy.chainId,
                    sellToken: baseToken,
                    buyToken: quoteToken,
                    amount: buyAmount,
                    slippageBps,
                  });

                  const pendingTrade: PendingTrade = {
                    strategyId,
                    symbol,
                    side: decision.action === 'long' ? 'BUY' : 'SELL',
                    size: clampedSize,
                    price: candle.close,
                    swapTx,
                    timestamp: Date.now(),
                  };

                  this.pendingTrades.set(strategyId, pendingTrade);
                  logger.info({ strategyId, symbol }, 'Pending live trade created (awaiting signature)');
                } catch (error) {
                  logger.error({ error, strategyId, symbol }, 'Error building swap tx');
                }
              }
            }
          }
        }
      } catch (error) {
        logger.error({ error, strategyId }, 'Error in live trading loop');
      }
    }, this.parseTimeframeToMs(strategy.timeframe));

    this.activeStrategies.set(strategyId, interval);
    logger.info({ strategyId }, 'Live trading started');
  }

  /**
   * Stop live trading for a strategy
   */
  async stop(strategyId: string): Promise<void> {
    const interval = this.activeStrategies.get(strategyId);
    if (!interval) {
      throw new Error(`Live trading not active for strategy ${strategyId}`);
    }

    clearInterval(interval);
    this.activeStrategies.delete(strategyId);
    this.pendingTrades.delete(strategyId);
    this.decisionCache.delete(strategyId);

    await prisma.strategy.update({
      where: { id: strategyId },
      data: { status: 'PAUSED' },
    });

    logger.info({ strategyId }, 'Live trading stopped');
  }

  /**
   * Get pending trade for a strategy (to be signed by user)
   */
  getPendingTrade(strategyId: string): PendingTrade | undefined {
    return this.pendingTrades.get(strategyId);
  }

  /**
   * Record a completed trade (after user signs and tx is confirmed)
   */
  async recordTrade(
    strategyId: string,
    trade: {
      symbol: string;
      side: 'BUY' | 'SELL';
      size: number;
      entryPrice: number;
      exitPrice?: number;
      fees: number;
      slippage: number;
      pnl: number;
      pnlPct: number;
      txHash: string;
    }
  ): Promise<void> {
    await prisma.trade.create({
      data: {
        strategyId,
        timestamp: new Date(),
        mode: 'LIVE',
        ...trade,
      },
    });

    this.pendingTrades.delete(strategyId);
    logger.info({ strategyId, txHash: trade.txHash }, 'Live trade recorded');
  }

  private estimatePayoffRatio(trades: Trade[]): number {
    const wins = trades.filter((t) => t.pnl > 0);
    const losses = trades.filter((t) => t.pnl < 0);
    const avgWin = wins.length > 0 ? wins.reduce((sum, t) => sum + t.pnl, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0) / losses.length) : 0;
    if (avgLoss === 0) return 1;
    return avgWin / avgLoss || 1;
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

  /**
   * Fast rule-based decision (fallback when LLM unavailable)
   */
  private getFastDecision(context: MarketContext, indicators: any): Decision {
    const rsi = indicators?.rsi;
    const ema20 = indicators?.ema20;
    const ema50 = indicators?.ema50;
    const price = context.recentCandles[context.recentCandles.length - 1]?.close || 0;
    
    let action: 'long' | 'short' | 'flat' = 'flat';
    let confidence = 0.3;
    
    if (price > 0 && ema20 && ema50) {
      const bullishTrend = ema20 > ema50;
      const bearishTrend = ema20 < ema50;
      
      if (bullishTrend && rsi && rsi > 50 && rsi < 70) {
        action = 'long';
        confidence = 0.6;
      } else if (bearishTrend && rsi && rsi < 50 && rsi > 30) {
        action = 'short';
        confidence = 0.6;
      }
    }
    
    return {
      action,
      confidence,
      targetPositionSizePct: confidence * (context.riskLimits?.maxPositionPct || 10),
      notes: 'Fast rule-based decision (LLM fallback)',
    };
  }

  /**
   * Hash market context to detect regime changes
   */
  private hashContext(context: MarketContext, indicators: any): string {
    const price = context.recentCandles[context.recentCandles.length - 1]?.close || 0;
    const rsi = indicators?.rsi || 0;
    const volatility = indicators?.volatility || 0;
    const trend = indicators?.ema20 && indicators?.ema50 
      ? (indicators.ema20 > indicators.ema50 ? 1 : -1)
      : 0;
    
    return `${Math.round(price * 100)}_${Math.round(rsi)}_${Math.round(volatility * 1000)}_${trend}`;
  }

  /**
   * Check if market regime is similar (for cache reuse)
   */
  private isRegimeSimilar(cachedHash: string, context: MarketContext, indicators: any): boolean {
    const currentHash = this.hashContext(context, indicators);
    return cachedHash === currentHash;
  }
}

export const liveTrader = new LiveTrader();
