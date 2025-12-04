import type {
  Candle,
  MarketContext,
  Decision,
  Trade,
  StrategyConfig,
  PerformanceMetrics,
  Position,
} from '@matcha-ai/shared';
import { riskManager } from './riskManager';
import { calculatePnL, calculateSharpe, calculateMaxDrawdown } from '@matcha-ai/shared';
import { logger } from '../config/logger';
import { wsService } from './websocket';
import { checkStopLossTakeProfit, TrailingStopTracker } from './stopLossTakeProfit';
import { decisionEngine } from './decisionEngine';
import { predictionTrainer } from './predictionTrainer';

export interface BacktestParams {
  strategyConfig: StrategyConfig;
  candles: Candle[];
  initialEquity: number;
  feeRate?: number; // e.g., 0.001 = 0.1%
  slippageBps?: number; // basis points, e.g., 5 = 0.05%
  strategyId?: string;
  onTrade?: (trade: Trade) => Promise<void>;
  onSnapshot?: (snapshot: BacktestSnapshot) => Promise<void>;
  snapshotIntervalMs?: number;
  fastMode?: boolean; // Skip AI calls, use rule-based decisions
}

export interface BacktestResult {
  initialEquity: number;
  finalEquity: number;
  totalReturn: number;
  totalReturnPct: number;
  trades: Trade[];
  equityCurve: number[];
  performance: PerformanceMetrics;
  snapshots: BacktestSnapshot[];
}

export interface BacktestSnapshot {
  timestamp: number;
  equity: number;
  maxDrawdown: number;
  sharpe?: number;
  winRate: number;
  totalTrades: number;
}

export class Backtester {
  /**
   * Run a backtest on historical data
   */
  async runBacktest(params: BacktestParams): Promise<BacktestResult> {
    const {
      strategyConfig,
      candles,
      initialEquity,
      feeRate = 0.001,
      slippageBps = 5,
      strategyId = 'backtest',
      onTrade,
      onSnapshot,
      snapshotIntervalMs = 15 * 60 * 1000, // 15 minutes by default
    } = params;

    logger.info({ candlesCount: candles.length, initialEquity }, 'Starting backtest');

    let equity = initialEquity;
    const equityCurve: number[] = [equity];
    const trades: Trade[] = [];
    const positions: Map<string, Position> = new Map(); // symbol -> position
    let dailyPnl = 0;
    const returns: number[] = [];
    let winningTrades = 0;
    let losingTrades = 0;
    const snapshots: BacktestSnapshot[] = [];
    let lastSnapshotAt = candles[0]?.timestamp || Date.now();
    const trailingStopTracker = new TrailingStopTracker();

    // Track daily PnL reset (simplified: reset every 24h of candles)
    let lastDailyReset = candles[0]?.timestamp || Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    // Skip candles to reduce processing time (process max 100 candles for speed)
    // Optimize: process fewer candles but ensure we have enough for indicators
    const maxCandlesToProcess = Math.min(100, candles.length);
    const candleSkip = candles.length > maxCandlesToProcess 
      ? Math.max(1, Math.floor(candles.length / maxCandlesToProcess))
      : 1;
    
    logger.info({ totalCandles: candles.length, processing: Math.floor((candles.length - 20) / candleSkip) + 1, skip: candleSkip }, 'Backtest optimization');
    
    for (let i = 20; i < candles.length; i += candleSkip) {
      // Need at least 20 candles for indicators
      const currentCandle = candles[i];
      const recentCandles = candles.slice(Math.max(0, i - 50), i + 1);

      // Reset daily PnL if new day
      if (currentCandle.timestamp - lastDailyReset >= dayMs) {
        dailyPnl = 0;
        lastDailyReset = currentCandle.timestamp;
      }

      // Build market context using unified decision engine
      const openPositions = Array.from(positions.values());
      const context = decisionEngine.buildContext(
        recentCandles,
        openPositions,
        trades,
        equity,
        dailyPnl,
        strategyConfig.riskLimits,
        equityCurve,
        returns
      );

      // Get decision using unified decision engine
      let decision: Decision;
      let predictionId: string | null = null; // Declare outside if/else for scope
      
      const dailyLimitHit = riskManager.isDailyLossLimitExceeded(
        dailyPnl,
        equity,
        strategyConfig.riskLimits.maxDailyLossPct
      );
      const drawdownLimitHit =
        strategyConfig.riskLimits.maxDrawdownPct !== undefined &&
        context.performance.maxDrawdown > strategyConfig.riskLimits.maxDrawdownPct;

      if (dailyLimitHit || drawdownLimitHit) {
        decision = {
          action: 'flat',
          confidence: 0,
          targetPositionSizePct: 0,
          notes: dailyLimitHit ? 'Risk: daily loss limit exceeded' : 'Risk: drawdown limit exceeded',
        };
      } else {
        // Use unified decision engine
        // Fast mode: AI is OFF
        // Normal mode: AI mode from config (defaults to ASSIST)
        const aiMode = params.fastMode ? 'OFF' : (strategyConfig.ai?.mode || 'ASSIST');
        
        // Get historical decisions for AI (only if not fast mode)
        const historicalDecisions = 
          !params.fastMode && strategyId
            ? await predictionTrainer.getHistoricalDecisions(strategyId, 30)
            : undefined;

        decision = await decisionEngine.decide(context, strategyConfig, {
          aiMode,
          strategyId,
          historicalDecisions,
        });

        // Store prediction for training (if we have strategyId and not fast mode)
        if (!params.fastMode && strategyId && strategyId !== 'backtest') {
          try {
            predictionId = await predictionTrainer.storePrediction(
              strategyId,
              strategyConfig.universe[0] || 'UNKNOWN',
              decision,
              context,
              context.indicators
            );
          } catch (error) {
            logger.warn({ error }, 'Failed to store prediction');
          }
        }
      }

      // Kelly-based cap using observed performance
      const payoffRatio = this.estimatePayoffRatio(trades);
      const kellyCapLimit = strategyConfig.riskLimits.kellyFractionCapPct ?? strategyConfig.riskLimits.maxPositionPct;
      const kellyCapPct =
        trades.length > 10
          ? riskManager.calculateKellyPositionPct(
              context.performance.winRate,
              payoffRatio,
              kellyCapLimit
            )
          : kellyCapLimit;

      // Process decision into trades
      for (const symbol of strategyConfig.universe) {
        const currentPosition = positions.get(symbol);
        const targetSizePct =
          decision.action === 'flat' ? 0 : Math.min(decision.targetPositionSizePct, kellyCapPct);

        // Calculate target position size
        const targetSize = riskManager.calculatePositionSize(
          targetSizePct,
          equity,
          currentCandle.close,
          kellyCapPct
        );

        // Determine if we need to trade
        if (currentPosition) {
          // Check stop loss / take profit / trailing stop first
          const highestPrice = trailingStopTracker.getHighest(symbol);
          const sltpCheck = checkStopLossTakeProfit(
            currentPosition,
            currentCandle.close,
            strategyConfig.riskLimits,
            highestPrice
          );
          
          // Update trailing stop tracker
          trailingStopTracker.update(symbol, currentCandle.close, currentPosition.side === 'long');
          
          // Close position if stop loss/take profit triggered
          if (sltpCheck.shouldClose) {
            const exitPrice = sltpCheck.exitPrice;
            const { pnl, pnlPct } = calculatePnL(
              currentPosition.entryPrice,
              exitPrice,
              currentPosition.size,
              currentPosition.side === 'long' ? 'BUY' : 'SELL'
            );
            const fees = currentPosition.size * exitPrice * feeRate;

            const trade: Trade = {
              strategyId: strategyId || 'backtest',
              timestamp: currentCandle.timestamp,
              mode: 'BACKTEST',
              symbol,
              side: currentPosition.side === 'long' ? 'SELL' : 'BUY',
              size: currentPosition.size,
              entryPrice: currentPosition.entryPrice,
              exitPrice,
              fees,
              slippage: (currentCandle.close - exitPrice) * currentPosition.size,
              pnl: pnl - fees,
              pnlPct,
            };

            trades.push(trade);
            // Non-blocking: call onTrade but don't await (let it batch)
            if (onTrade) {
              onTrade(trade).catch((error) => {
                logger.warn({ error }, 'onTrade callback failed (non-blocking)');
              });
            }
            
            if (strategyId && strategyId !== 'backtest') {
              wsService.broadcastTrade(strategyId, trade);
            }

            if (strategyId && strategyId !== 'backtest' && predictionId) {
              try {
                await predictionTrainer.evaluatePrediction(
                  predictionId,
                  trade,
                  exitPrice,
                  currentPosition.side === 'long' ? 'long' : 'short'
                );
              } catch (error) {
                logger.warn({ error }, 'Failed to evaluate prediction');
              }
            }
            
            equity += trade.pnl;
            dailyPnl += trade.pnl;
            returns.push(pnlPct / 100);

            if (trade.pnl > 0) winningTrades++;
            else if (trade.pnl < 0) losingTrades++;

            positions.delete(symbol);
            trailingStopTracker.reset(symbol);
            continue; // Skip to next symbol
          }
          
          // Existing position - check if we should close or adjust
          if (decision.action === 'flat' || targetSizePct === 0) {
            // Close position
            const exitPrice = currentCandle.close * (1 - slippageBps / 10000);
            const { pnl, pnlPct } = calculatePnL(
              currentPosition.entryPrice,
              exitPrice,
              currentPosition.size,
              currentPosition.side === 'long' ? 'BUY' : 'SELL'
            );
            const fees = currentPosition.size * exitPrice * feeRate;

            const trade: Trade = {
              strategyId: strategyId || 'backtest',
              timestamp: currentCandle.timestamp,
              mode: 'BACKTEST',
              symbol,
              side: currentPosition.side === 'long' ? 'SELL' : 'BUY', // Opposite to close
              size: currentPosition.size,
              entryPrice: currentPosition.entryPrice,
              exitPrice,
              fees,
              slippage: (currentCandle.close - exitPrice) * currentPosition.size,
              pnl: pnl - fees,
              pnlPct,
            };

            trades.push(trade);
            if (onTrade) {
              await onTrade(trade);
            }
            
            // Broadcast trade via WebSocket
            if (strategyId && strategyId !== 'backtest') {
              wsService.broadcastTrade(strategyId, trade);
            }

            // Evaluate prediction if we stored one
            if (strategyId && strategyId !== 'backtest' && predictionId) {
              try {
                await predictionTrainer.evaluatePrediction(
                  predictionId,
                  trade,
                  exitPrice,
                  currentPosition.side === 'long' ? 'long' : 'short'
                );
              } catch (error) {
                logger.warn({ error }, 'Failed to evaluate prediction');
              }
            }
            
            equity += trade.pnl;
            dailyPnl += trade.pnl;
            returns.push(pnlPct / 100);

            if (trade.pnl > 0) winningTrades++;
            else if (trade.pnl < 0) losingTrades++;

            positions.delete(symbol);
          } else if (Math.abs(targetSize - currentPosition.size) > currentPosition.size * 0.01) {
            // Adjust position (simplified: close and reopen)
            // In production, you might want to do partial closes/opens
            const exitPrice = currentCandle.close * (1 - slippageBps / 10000);
            const { pnl, pnlPct } = calculatePnL(
              currentPosition.entryPrice,
              exitPrice,
              currentPosition.size,
              currentPosition.side === 'long' ? 'BUY' : 'SELL'
            );
            const fees = currentPosition.size * exitPrice * feeRate;

            const closeTrade: Trade = {
              strategyId,
              timestamp: currentCandle.timestamp,
              mode: 'BACKTEST',
              symbol,
              side: currentPosition.side === 'long' ? 'SELL' : 'BUY',
              size: currentPosition.size,
              entryPrice: currentPosition.entryPrice,
              exitPrice,
              fees,
              slippage: (currentCandle.close - exitPrice) * currentPosition.size,
              pnl: pnl - fees,
              pnlPct,
            };

            trades.push(closeTrade);
            // Non-blocking: call onTrade but don't await (let it batch)
            if (onTrade) {
              onTrade(closeTrade).catch((error) => {
                logger.warn({ error }, 'onTrade callback failed (non-blocking)');
              });
            }
            
            // Broadcast trade via WebSocket
            if (strategyId) {
              wsService.broadcastTrade(strategyId, closeTrade);
            }
            
            equity += closeTrade.pnl;
            dailyPnl += closeTrade.pnl;
            returns.push(pnlPct / 100);

            if (closeTrade.pnl > 0) winningTrades++;
            else if (closeTrade.pnl < 0) losingTrades++;

            positions.delete(symbol);

            // Open new position if target > 0
            if (targetSize > 0 && riskManager.shouldTakeTrade({
              equity,
              dailyPnl,
              proposedTrade: {
                side: decision.action === 'long' ? 'BUY' : 'SELL',
                size: targetSize,
                price: currentCandle.close,
              },
              currentPositions: [],
              riskLimits: strategyConfig.riskLimits,
              recentReturns: returns,
              maxDrawdownPct: context.performance.maxDrawdown,
            })) {
              const entryPrice = currentCandle.close * (1 + slippageBps / 10000);
              const fees = targetSize * entryPrice * feeRate;

              positions.set(symbol, {
                symbol,
                side: decision.action,
                size: targetSize,
                entryPrice,
                unrealizedPnl: 0,
              });
              
              // Initialize trailing stop tracker for new position
              trailingStopTracker.update(symbol, entryPrice, decision.action === 'long');

              equity -= fees; // Pay fees upfront
            }
          }
        } else {
          // No position, open if decision says so
          if (targetSizePct > 0 && decision.action !== 'flat') {
            const clampedSize = riskManager.clampPositionSize(
              targetSizePct,
              equity,
              currentCandle.close,
              strategyConfig.riskLimits
            );

            if (
              riskManager.shouldTakeTrade({
                equity,
                dailyPnl,
                proposedTrade: {
                  side: decision.action === 'long' ? 'BUY' : 'SELL',
                  size: clampedSize,
                  price: currentCandle.close,
                },
                currentPositions: [],
                riskLimits: strategyConfig.riskLimits,
                recentReturns: returns,
                maxDrawdownPct: context.performance.maxDrawdown,
              })
            ) {
              const entryPrice = currentCandle.close * (1 + slippageBps / 10000);
              const fees = clampedSize * entryPrice * feeRate;

              positions.set(symbol, {
                symbol,
                side: decision.action,
                size: clampedSize,
                entryPrice,
                unrealizedPnl: 0,
              });

              equity -= fees;
            }
          }
        }
      }

      // Update unrealized PnL for open positions
      for (const position of positions.values()) {
        const currentPrice = currentCandle.close;
        const { pnl } = calculatePnL(
          position.entryPrice,
          currentPrice,
          position.size,
          position.side === 'long' ? 'BUY' : 'SELL'
        );
        position.unrealizedPnl = pnl;
      }

      equityCurve.push(equity);

      // Periodic snapshot
      if (onSnapshot && currentCandle.timestamp - lastSnapshotAt >= snapshotIntervalMs) {
        const closedTrades = trades.filter((t) => t.exitPrice);
        const winRate = closedTrades.length > 0 ? winningTrades / closedTrades.length : 0;
        const snapshot: BacktestSnapshot = {
          timestamp: currentCandle.timestamp,
          equity,
          maxDrawdown: calculateMaxDrawdown(equityCurve),
          sharpe: returns.length > 0 ? calculateSharpe(returns) : undefined,
          winRate,
          totalTrades: closedTrades.length,
        };
        snapshots.push(snapshot);
        // Non-blocking: call onSnapshot but don't await (let it batch)
        if (onSnapshot) {
          onSnapshot(snapshot).catch((error) => {
            logger.warn({ error }, 'onSnapshot callback failed (non-blocking)');
          });
        }
        lastSnapshotAt = currentCandle.timestamp;
      }
    }

    // Close all remaining positions at the end
    const finalCandle = candles[candles.length - 1];
    for (const [symbol, position] of positions.entries()) {
      const exitPrice = finalCandle.close * (1 - slippageBps / 10000);
      const { pnl, pnlPct } = calculatePnL(
        position.entryPrice,
        exitPrice,
        position.size,
        position.side === 'long' ? 'BUY' : 'SELL'
      );
      const fees = position.size * exitPrice * feeRate;

      const trade: Trade = {
        strategyId,
        timestamp: finalCandle.timestamp,
        mode: 'BACKTEST',
        symbol,
        side: position.side === 'long' ? 'SELL' : 'BUY',
        size: position.size,
        entryPrice: position.entryPrice,
        exitPrice,
        fees,
        slippage: (finalCandle.close - exitPrice) * position.size,
        pnl: pnl - fees,
        pnlPct,
      };

      trades.push(trade);
      if (onTrade) {
        await onTrade(trade);
      }
      
      // Broadcast trade via WebSocket
      if (strategyId) {
        wsService.broadcastTrade(strategyId, trade);
      }
      
      equity += trade.pnl;
      returns.push(pnlPct / 100);

      if (trade.pnl > 0) winningTrades++;
      else if (trade.pnl < 0) losingTrades++;
    }

    const finalEquity = equity;
    const totalReturn = finalEquity - initialEquity;
    const totalReturnPct = (totalReturn / initialEquity) * 100;
    const closedTrades = trades.filter((t) => t.exitPrice);
    const winRate = closedTrades.length > 0 ? winningTrades / closedTrades.length : 0;

    const performance: PerformanceMetrics = {
      realizedPnl: totalReturn,
      maxDrawdown: calculateMaxDrawdown(equityCurve),
      winRate,
      sharpe: returns.length > 0 ? calculateSharpe(returns) : undefined,
      totalTrades: closedTrades.length,
      winningTrades,
      losingTrades,
    };

    const finalSnapshot: BacktestSnapshot = {
      timestamp: finalCandle.timestamp,
      equity: finalEquity,
      maxDrawdown: performance.maxDrawdown,
      sharpe: performance.sharpe,
      winRate,
      totalTrades: closedTrades.length,
    };
    snapshots.push(finalSnapshot);
    if (onSnapshot) {
      await onSnapshot(finalSnapshot);
    }

    logger.info({ totalReturn, totalReturnPct, tradesCount: trades.length }, 'Backtest completed');

    // Broadcast final results via WebSocket
    if (strategyId) {
      wsService.broadcastPerformance(strategyId, {
        equity: finalEquity,
        dailyPnl: totalReturn,
        maxDrawdown: performance.maxDrawdown,
        winRate: performance.winRate,
        totalTrades: performance.totalTrades || 0,
      });
    }

    return {
      initialEquity,
      finalEquity,
      totalReturn,
      totalReturnPct,
      trades,
      equityCurve,
      performance,
      snapshots,
    };
  }


  /**
   * Estimate payoff ratio (average win / average loss)
   */
  private estimatePayoffRatio(trades: Trade[]): number {
    const wins = trades.filter((t) => t.pnl > 0);
    const losses = trades.filter((t) => t.pnl < 0);
    const avgWin = wins.length > 0 ? wins.reduce((sum, t) => sum + t.pnl, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0) / losses.length) : 0;
    if (avgLoss === 0) return 1;
    return avgWin / avgLoss || 1;
  }
}

export const backtester = new Backtester();
