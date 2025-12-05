import type { Candle, Decision, Indicators, Position } from '@matcha-ai/shared';
import { detectTrendRegime, detectVolatilityRegime, calculateATR } from '../features';
import { logger } from '../../config/logger';

export interface GridTradingConfig {
  gridSpacingPct?: number; // Default: 1% (grid levels 1% apart)
  numLevels?: number; // Default: 5 (5 buy levels, 5 sell levels)
  minPrice?: number; // Optional: Minimum price for grid
  maxPrice?: number; // Optional: Maximum price for grid
  volatilityAdjustment?: boolean; // Default: true (adjust grid based on volatility)
}

export interface GridLevel {
  price: number;
  side: 'BUY' | 'SELL';
  size: number;
  filled: boolean;
}

/**
 * Grid Trading Strategy
 * 
 * Creates a grid of buy/sell orders at fixed intervals:
 * - Create grid of buy/sell orders at fixed intervals (e.g., 1% apart)
 * - Buy at lower levels, sell at higher levels
 * - Works in ranging markets
 * - Dynamic grid adjustment based on volatility
 */
export class GridTradingStrategy {
  private activeGrids: Map<string, GridLevel[]> = new Map(); // strategyId -> grid levels

  /**
   * Generate grid trading decision
   * Returns decision to place grid orders or adjust existing grid
   */
  generateDecision(
    candles: Candle[],
    indicators: Indicators,
    currentPrice: number,
    existingPositions: Position[],
    config: GridTradingConfig = {}
  ): Decision | null {
    // Grid trading only works in ranging markets
    const trendRegime = detectTrendRegime(candles, indicators);
    if (trendRegime !== 'ranging') {
      return null; // Only use grid trading in ranging markets
    }

    const gridSpacingPct = config.gridSpacingPct || 1.0;
    const numLevels = config.numLevels || 5;
    const volatilityAdjustment = config.volatilityAdjustment !== false;

    // Adjust grid spacing based on volatility
    let adjustedSpacing = gridSpacingPct;
    if (volatilityAdjustment) {
      const volRegime = detectVolatilityRegime(candles, indicators);
      const atr = indicators.volatility || calculateATR(candles);
      const atrPct = currentPrice > 0 ? (atr / currentPrice) * 100 : 0;

      if (volRegime === 'high' || atrPct > 2.0) {
        // High volatility: Wider grid spacing (1.5x)
        adjustedSpacing = gridSpacingPct * 1.5;
      } else if (volRegime === 'low' || atrPct < 0.5) {
        // Low volatility: Tighter grid spacing (0.7x)
        adjustedSpacing = gridSpacingPct * 0.7;
      }
    }

    // Calculate grid levels
    const gridLevels: GridLevel[] = [];
    const centerPrice = currentPrice;

    // Buy levels (below current price)
    for (let i = 1; i <= numLevels; i++) {
      const buyPrice = centerPrice * (1 - (adjustedSpacing * i) / 100);
      gridLevels.push({
        price: buyPrice,
        side: 'BUY',
        size: 0, // Will be calculated based on position size
        filled: false,
      });
    }

    // Sell levels (above current price)
    for (let i = 1; i <= numLevels; i++) {
      const sellPrice = centerPrice * (1 + (adjustedSpacing * i) / 100);
      gridLevels.push({
        price: sellPrice,
        side: 'SELL',
        size: 0, // Will be calculated based on position size
        filled: false,
      });
    }

    // Check if we're near any grid level (should place order)
    const nearestBuyLevel = gridLevels
      .filter((l) => l.side === 'BUY')
      .sort((a, b) => Math.abs(currentPrice - b.price) - Math.abs(currentPrice - a.price))[0];
    const nearestSellLevel = gridLevels
      .filter((l) => l.side === 'SELL')
      .sort((a, b) => Math.abs(currentPrice - a.price) - Math.abs(currentPrice - b.price))[0];

    // Determine if we should place a buy or sell order
    const buyDistance = nearestBuyLevel ? Math.abs(currentPrice - nearestBuyLevel.price) / currentPrice : Infinity;
    const sellDistance = nearestSellLevel ? Math.abs(currentPrice - nearestSellLevel.price) / currentPrice : Infinity;
    const threshold = adjustedSpacing / 200; // Within 50% of grid spacing

    let action: 'long' | 'short' | 'flat' = 'flat';
    let confidence = 0.6; // Grid trading has moderate confidence
    let positionSize = 2; // Small position size per grid level (2% per level)

    if (buyDistance < threshold && buyDistance < sellDistance) {
      // Near buy level, place buy order
      action = 'long';
      confidence = 0.6;
      logger.info(
        {
          action,
          currentPrice,
          buyLevel: nearestBuyLevel.price,
          distance: buyDistance * 100,
          gridSpacing: adjustedSpacing,
        },
        'Grid trading: Buy signal (near buy level)'
      );
    } else if (sellDistance < threshold && sellDistance < buyDistance) {
      // Near sell level, place sell order
      action = 'short';
      confidence = 0.6;
      logger.info(
        {
          action,
          currentPrice,
          sellLevel: nearestSellLevel.price,
          distance: sellDistance * 100,
          gridSpacing: adjustedSpacing,
        },
        'Grid trading: Sell signal (near sell level)'
      );
    }

    if (action === 'flat') {
      return null; // Not near any grid level
    }

    return {
      action,
      confidence,
      targetPositionSizePct: positionSize,
      notes: `Grid trading: ${action} signal, grid spacing=${adjustedSpacing.toFixed(2)}%, ${action === 'long' ? 'buy level' : 'sell level'}=${(action === 'long' ? nearestBuyLevel : nearestSellLevel).price.toFixed(2)}`,
    };
  }

  /**
   * Get grid levels for a strategy
   */
  getGridLevels(strategyId: string): GridLevel[] {
    return this.activeGrids.get(strategyId) || [];
  }

  /**
   * Set grid levels for a strategy
   */
  setGridLevels(strategyId: string, levels: GridLevel[]): void {
    this.activeGrids.set(strategyId, levels);
    logger.debug({ strategyId, numLevels: levels.length }, 'Grid levels updated');
  }

  /**
   * Mark a grid level as filled
   */
  markLevelFilled(strategyId: string, price: number, side: 'BUY' | 'SELL'): void {
    const levels = this.activeGrids.get(strategyId) || [];
    const level = levels.find((l) => l.side === side && Math.abs(l.price - price) / price < 0.01);
    if (level) {
      level.filled = true;
      logger.info({ strategyId, price, side }, 'Grid level filled');
    }
  }

  /**
   * Clear grid for a strategy
   */
  clearGrid(strategyId: string): void {
    this.activeGrids.delete(strategyId);
    logger.debug({ strategyId }, 'Grid cleared');
  }
}

export const gridTradingStrategy = new GridTradingStrategy();

