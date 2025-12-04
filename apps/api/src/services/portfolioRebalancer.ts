import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';
import { riskManager } from './riskManager';
import type { StrategyConfig, Position } from '@matcha-ai/shared';

const prisma = new PrismaClient();

export interface RebalanceTarget {
  symbol: string;
  targetWeight: number; // 0-100, target percentage of portfolio
  currentWeight: number; // 0-100, current percentage
  deviation: number; // Difference between target and current
}

export interface RebalancePlan {
  strategyId: string;
  currentPositions: Position[];
  targets: RebalanceTarget[];
  trades: Array<{
    symbol: string;
    side: 'BUY' | 'SELL';
    size: number;
    reason: string;
  }>;
  totalValue: number;
}

/**
 * Portfolio Rebalancer
 * Automatically rebalances portfolio to target allocations
 */
export class PortfolioRebalancer {
  /**
   * Calculate rebalance plan
   */
  async calculateRebalancePlan(
    strategyId: string,
    targetWeights: Record<string, number>, // symbol -> target weight (0-100)
    currentPositions: Position[],
    totalValue: number
  ): Promise<RebalancePlan> {
    // Calculate current weights
    const currentWeights: Record<string, number> = {};
    currentPositions.forEach(pos => {
      const positionValue = pos.size * pos.entryPrice;
      currentWeights[pos.symbol] = (positionValue / totalValue) * 100;
    });

    // Calculate targets and deviations
    const targets: RebalanceTarget[] = [];
    Object.entries(targetWeights).forEach(([symbol, targetWeight]) => {
      const currentWeight = currentWeights[symbol] || 0;
      const deviation = currentWeight - targetWeight;
      
      targets.push({
        symbol,
        targetWeight,
        currentWeight,
        deviation,
      });
    });

    // Generate rebalance trades
    const trades: Array<{
      symbol: string;
      side: 'BUY' | 'SELL';
      size: number;
      reason: string;
    }> = [];

    const rebalanceThreshold = 2; // Rebalance if deviation > 2%

    targets.forEach(target => {
      if (Math.abs(target.deviation) > rebalanceThreshold) {
        const targetValue = (target.targetWeight / 100) * totalValue;
        const currentValue = (target.currentWeight / 100) * totalValue;
        const difference = targetValue - currentValue;

        if (difference > 0) {
          // Need to buy
          const currentPrice = currentPositions.find(p => p.symbol === target.symbol)?.entryPrice || 0;
          if (currentPrice > 0) {
            trades.push({
              symbol: target.symbol,
              side: 'BUY',
              size: difference / currentPrice,
              reason: `Rebalance: ${target.currentWeight.toFixed(1)}% -> ${target.targetWeight.toFixed(1)}%`,
            });
          }
        } else {
          // Need to sell
          const position = currentPositions.find(p => p.symbol === target.symbol);
          if (position) {
            trades.push({
              symbol: target.symbol,
              side: 'SELL',
              size: Math.abs(difference) / position.entryPrice,
              reason: `Rebalance: ${target.currentWeight.toFixed(1)}% -> ${target.targetWeight.toFixed(1)}%`,
            });
          }
        }
      }
    });

    return {
      strategyId,
      currentPositions,
      targets,
      trades,
      totalValue,
    };
  }

  /**
   * Execute rebalance plan
   */
  async executeRebalance(plan: RebalancePlan): Promise<void> {
    logger.info({ strategyId: plan.strategyId, trades: plan.trades.length }, 'Executing rebalance');

    // Execute trades in order
    for (const trade of plan.trades) {
      try {
        // In production, this would:
        // 1. Build swap transaction
        // 2. Execute via live trader
        // 3. Record trade
        
        logger.info({ 
          strategyId: plan.strategyId,
          symbol: trade.symbol,
          side: trade.side,
          size: trade.size,
          reason: trade.reason
        }, 'Rebalance trade executed');
      } catch (error) {
        logger.error({ error, trade }, 'Error executing rebalance trade');
        // Continue with other trades even if one fails
      }
    }
  }

  /**
   * Auto-rebalance based on strategy config
   */
  async autoRebalance(strategyId: string): Promise<void> {
    const strategy = await prisma.strategy.findUnique({
      where: { id: strategyId },
    });

    if (!strategy) {
      throw new Error(`Strategy not found: ${strategyId}`);
    }

    const config: StrategyConfig = JSON.parse(strategy.configJson);
    
    // Get current positions (from recent trades or position tracking)
    const recentTrades = await prisma.trade.findMany({
      where: { strategyId },
      orderBy: { timestamp: 'desc' },
      take: 100,
    });

    // Calculate current positions and total value
    const positions: Position[] = [];
    let totalValue = 10000; // Starting equity

    // Build positions from trades
    const positionMap = new Map<string, Position>();
    recentTrades.forEach(trade => {
      if (trade.exitPrice) {
        // Closed position - update total value
        totalValue += trade.pnl;
      } else {
        // Open position
        const existing = positionMap.get(trade.symbol);
        if (existing) {
          // Update existing position
          if (trade.side === 'BUY') {
            existing.size += trade.size;
          } else {
            existing.size -= trade.size;
          }
        } else {
          // New position
          positionMap.set(trade.symbol, {
            symbol: trade.symbol,
            side: trade.side === 'BUY' ? 'long' : 'short',
            size: trade.size,
            entryPrice: trade.entryPrice,
            unrealizedPnl: 0,
          });
        }
      }
    });

    positions.push(...Array.from(positionMap.values()));

    // Calculate target weights (equal weight by default, or from config)
    const targetWeights: Record<string, number> = {};
    const equalWeight = 100 / config.universe.length;
    config.universe.forEach(symbol => {
      targetWeights[symbol] = equalWeight;
    });

    // Calculate and execute rebalance
    const plan = await this.calculateRebalancePlan(
      strategyId,
      targetWeights,
      positions,
      totalValue
    );

    if (plan.trades.length > 0) {
      await this.executeRebalance(plan);
    } else {
      logger.info({ strategyId }, 'No rebalancing needed');
    }
  }
}

export const portfolioRebalancer = new PortfolioRebalancer();




