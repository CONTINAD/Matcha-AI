import type { Position, RiskLimits, Candle } from '@matcha-ai/shared';
import { logger } from '../config/logger';

export interface StopLossTakeProfitCheck {
  shouldClose: boolean;
  reason: 'stop_loss' | 'take_profit' | 'trailing_stop' | null;
  exitPrice: number;
}

/**
 * Check if a position should be closed due to stop loss, take profit, or trailing stop
 */
export function checkStopLossTakeProfit(
  position: Position,
  currentPrice: number,
  riskLimits: RiskLimits,
  highestPrice?: number // For trailing stop - highest price since entry
): StopLossTakeProfitCheck {
  const entryPrice = position.entryPrice;
  const isLong = position.side === 'long';
  
  // Calculate current P&L percentage
  const priceChange = isLong 
    ? ((currentPrice - entryPrice) / entryPrice) * 100
    : ((entryPrice - currentPrice) / entryPrice) * 100;
  
  // Check stop loss
  if (riskLimits.stopLossPct && riskLimits.stopLossPct > 0) {
    if (priceChange <= -riskLimits.stopLossPct) {
      logger.info(
        { 
          symbol: position.symbol, 
          entryPrice, 
          currentPrice, 
          priceChange, 
          stopLossPct: riskLimits.stopLossPct 
        },
        'Stop loss triggered'
      );
      return {
        shouldClose: true,
        reason: 'stop_loss',
        exitPrice: currentPrice,
      };
    }
  }
  
  // Check take profit
  if (riskLimits.takeProfitPct && riskLimits.takeProfitPct > 0) {
    if (priceChange >= riskLimits.takeProfitPct) {
      logger.info(
        { 
          symbol: position.symbol, 
          entryPrice, 
          currentPrice, 
          priceChange, 
          takeProfitPct: riskLimits.takeProfitPct 
        },
        'Take profit triggered'
      );
      return {
        shouldClose: true,
        reason: 'take_profit',
        exitPrice: currentPrice,
      };
    }
  }
  
  // Check trailing stop (only if we have a highest price and take profit is set)
  if (
    riskLimits.trailingStopPct && 
    riskLimits.trailingStopPct > 0 && 
    highestPrice && 
    riskLimits.takeProfitPct &&
    riskLimits.trailingStopActivationPct
  ) {
    // Trailing stop only activates after reaching activation threshold
    const activationPrice = isLong
      ? entryPrice * (1 + riskLimits.trailingStopActivationPct / 100)
      : entryPrice * (1 - riskLimits.trailingStopActivationPct / 100);
    
    if (isLong ? currentPrice >= activationPrice : currentPrice <= activationPrice) {
      // Trailing stop is active - check if price has dropped by trailing stop %
      const dropFromHigh = isLong
        ? ((highestPrice - currentPrice) / highestPrice) * 100
        : ((currentPrice - highestPrice) / highestPrice) * 100;
      
      if (dropFromHigh >= riskLimits.trailingStopPct) {
        logger.info(
          { 
            symbol: position.symbol, 
            entryPrice, 
            currentPrice, 
            highestPrice,
            dropFromHigh, 
            trailingStopPct: riskLimits.trailingStopPct 
          },
          'Trailing stop triggered'
        );
        return {
          shouldClose: true,
          reason: 'trailing_stop',
          exitPrice: currentPrice,
        };
      }
    }
  }
  
  return {
    shouldClose: false,
    reason: null,
    exitPrice: currentPrice,
  };
}

/**
 * Track highest price for trailing stop
 */
export class TrailingStopTracker {
  private highestPrices: Map<string, number> = new Map();
  
  update(symbol: string, price: number, isLong: boolean): void {
    const current = this.highestPrices.get(symbol);
    if (!current) {
      this.highestPrices.set(symbol, price);
      return;
    }
    
    // For long positions, track highest price
    // For short positions, track lowest price (inverted)
    if (isLong) {
      if (price > current) {
        this.highestPrices.set(symbol, price);
      }
    } else {
      if (price < current) {
        this.highestPrices.set(symbol, price);
      }
    }
  }
  
  getHighest(symbol: string): number | undefined {
    return this.highestPrices.get(symbol);
  }
  
  reset(symbol: string): void {
    this.highestPrices.delete(symbol);
  }
}


