import type {
  Candle,
  MarketContext,
  Decision,
  Trade,
  StrategyConfig,
  PerformanceMetrics,
  Position,
} from '@matcha-ai/shared';
import { matchaBrain } from './matchaBrain';
import { riskManager } from './riskManager';
import { extractIndicatorsSync } from './features';
import { reinforcementLearning } from './reinforcementLearning';
import { predictionTrainer } from './predictionTrainer';
import { calculatePnL, calculateSharpe, calculateMaxDrawdown } from '@matcha-ai/shared';
import { logger } from '../config/logger';
import { wsService } from './websocket';
import { checkStopLossTakeProfit, TrailingStopTracker } from './stopLossTakeProfit';

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

      // Extract indicators (using sync version for performance in backtests)
      const indicators = extractIndicatorsSync(recentCandles, strategyConfig.indicators) as any;

      // Build market context
      const openPositions = Array.from(positions.values());
      const realizedPnl = trades.filter((t) => t.exitPrice).reduce((sum, t) => sum + t.pnl, 0);
      const winRate =
        trades.length > 0
          ? trades.filter((t) => t.pnl > 0).length / trades.filter((t) => t.exitPrice).length
          : 0;

      const context: MarketContext = {
        recentCandles: recentCandles.slice(-20), // Last 20 candles
        indicators,
        openPositions,
        performance: {
          realizedPnl,
          maxDrawdown: calculateMaxDrawdown(equityCurve),
          winRate,
          sharpe: returns.length > 0 ? calculateSharpe(returns) : undefined,
        },
        riskLimits: strategyConfig.riskLimits,
        currentEquity: equity,
        dailyPnl,
      };

      // Get AI decision (with ensemble voting for smarter decisions)
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
        // Store prediction before making decision (for training)
        
        // Fast mode: use rule-based decisions instead of AI
        if (params.fastMode) {
          decision = this.getFastDecision(context, indicators);
        } else {
          try {
            // Get historical decisions for learning
            const historicalDecisions = strategyId 
              ? await predictionTrainer.getHistoricalDecisions(strategyId, 30)
              : undefined;

            // Use ensemble decision for better accuracy (3 votes)
            decision = await matchaBrain.getEnsembleDecision(context, strategyConfig, 3);
            
            // Apply reinforcement learning adjustments if we have historical data
            if (trades.length > 10) {
              const patterns = await reinforcementLearning.analyzePatterns('backtest');
              decision = reinforcementLearning.adjustDecisionByLearning(decision, patterns);
            }

            // Improve decision based on past predictions
            if (strategyId && historicalDecisions && historicalDecisions.length > 5) {
              decision = await predictionTrainer.improveDecision(strategyId, decision, context);
            }

            // Store prediction for training (if we have strategyId)
            if (strategyId && strategyId !== 'backtest') {
              try {
                predictionId = await predictionTrainer.storePrediction(
                  strategyId,
                  strategyConfig.universe[0] || 'UNKNOWN',
                  decision,
                  context,
                  indicators
                );
              } catch (error) {
                logger.warn({ error }, 'Failed to store prediction');
              }
            }
          } catch (error) {
            logger.error({ error }, 'Error getting decision, using fast fallback');
            decision = this.getFastDecision(context, indicators);
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
   * Fast rule-based decision (no AI calls) - IMPROVED FOR PROFITABILITY
   * Uses multiple technical indicators for better entry/exit timing
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
    const bbUpper = indicators?.bbUpper;
    const bbLower = indicators?.bbLower;
    const bbMiddle = indicators?.bbMiddle;
    const adx = indicators?.adx;
    const price = context.recentCandles[context.recentCandles.length - 1]?.close || 0;
    const candles = context.recentCandles;
    
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
      
      if (bullishTrend && trendStrength > 0.005) { // 0.5% separation minimum
        signalStrength += 3;
      } else if (bearishTrend && trendStrength > 0.005) {
        signalStrength -= 3;
      }
      
      // 2. RSI MOMENTUM (Confirms trend)
      if (rsi) {
        if (bullishTrend && rsi > 50 && rsi < 70) { // Not overbought, but strong
          signalStrength += 2;
        } else if (bullishTrend && rsi > 40 && rsi < 50) { // Building momentum
          signalStrength += 1;
        } else if (bearishTrend && rsi < 50 && rsi > 30) { // Not oversold, but weak
          signalStrength -= 2;
        } else if (bearishTrend && rsi < 60 && rsi > 50) { // Losing momentum
          signalStrength -= 1;
        }
        
        // Avoid extreme RSI (overbought/oversold reversals)
        if (rsi > 75) signalStrength -= 2; // Overbought - avoid longs
        if (rsi < 25) signalStrength += 2; // Oversold - avoid shorts
      }
      
      // 3. MACD CROSSOVER (Momentum confirmation)
      if (macd && macdSignal && macdHistogram) {
        if (macd > macdSignal && macdHistogram > 0) { // Bullish MACD
          signalStrength += 2;
        } else if (macd < macdSignal && macdHistogram < 0) { // Bearish MACD
          signalStrength -= 2;
        }
      }
      
      // 4. BOLLINGER BANDS (Volatility and mean reversion)
      if (bbUpper && bbLower && bbMiddle) {
        const bbPosition = (price - bbLower) / (bbUpper - bbLower);
        if (bullishTrend && bbPosition < 0.3 && price < bbMiddle) { // Near lower band, oversold
          signalStrength += 1.5;
        } else if (bearishTrend && bbPosition > 0.7 && price > bbMiddle) { // Near upper band, overbought
          signalStrength -= 1.5;
        }
      }
      
      // 5. ADX (Trend strength - only trade in strong trends)
      if (adx) {
        if (adx > 25) { // Strong trend
          signalStrength *= 1.2; // Boost all signals
        } else if (adx < 20) { // Weak trend
          signalStrength *= 0.7; // Reduce signals in choppy markets
        }
      }
      
      // 6. PRICE MOMENTUM (Recent price action)
      if (candles.length >= 3) {
        const recent = candles.slice(-3);
        const momentum = (recent[2].close - recent[0].close) / recent[0].close;
        if (momentum > 0.02 && bullishTrend) { // 2%+ momentum up
          signalStrength += 1;
        } else if (momentum < -0.02 && bearishTrend) { // 2%+ momentum down
          signalStrength -= 1;
        }
      }
      
      // Convert signal strength to action and confidence
      // Lower threshold for entry (3 instead of 4) to generate more trades
      // But require stronger signals for higher confidence
      if (signalStrength >= 3) {
        action = 'long';
        // Scale confidence: 3 = 0.5, 4 = 0.6, 5 = 0.7, 6+ = 0.8+
        confidence = Math.min(0.85, 0.4 + (signalStrength - 3) * 0.15);
      } else if (signalStrength <= -3) {
        action = 'short';
        confidence = Math.min(0.85, 0.4 + (Math.abs(signalStrength) - 3) * 0.15);
      } else {
        // Weak signal - stay flat
        action = 'flat';
        confidence = 0.2;
      }
      
      // Adjust confidence based on recent performance
      const totalTrades = context.performance.totalTrades || 0;
      if (context.performance.winRate > 0.55 && totalTrades > 10) {
        confidence = Math.min(0.9, confidence * 1.15); // Boost more if winning
      } else if (context.performance.winRate < 0.45 && totalTrades > 10) {
        confidence = Math.max(0.3, confidence * 0.85); // Reduce more if losing
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
      
      if (shortMomentum > 0.015 && longMomentum > 0.01) { // Consistent upward momentum
        action = 'long';
        confidence = 0.5;
      } else if (shortMomentum < -0.015 && longMomentum < -0.01) { // Consistent downward momentum
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
      notes: `Fast mode: signal strength ${signalStrength.toFixed(1)}, ${action} with ${(confidence * 100).toFixed(0)}% confidence`,
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
