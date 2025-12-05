import type { Position, RiskLimits, Candle, Indicators } from '@matcha-ai/shared';
import { logger } from '../config/logger';
import { adaptiveExits } from './adaptiveExits';
import { extractIndicatorsSync } from './features';

export interface StopLossTakeProfitCheck {
  shouldClose: boolean;
  reason: 'stop_loss' | 'take_profit' | 'trailing_stop' | null;
  exitPrice: number;
}

/**
 * Check if a position should be closed due to stop loss, take profit, or trailing stop
 * Enhanced with adaptive exits based on market conditions
 */
export function checkStopLossTakeProfit(
  position: Position,
  currentPrice: number,
  riskLimits: RiskLimits,
  highestPrice?: number, // For trailing stop - highest price since entry
  candles?: Candle[], // For adaptive exits
  indicators?: Indicators // For adaptive exits
): StopLossTakeProfitCheck {
  const entryPrice = position.entryPrice;
  const isLong = position.side === 'long';
  
  // Calculate adaptive exit targets if candles and indicators are provided
  let adaptiveTakeProfit = riskLimits.takeProfitPct;
  let adaptiveStopLoss = riskLimits.stopLossPct;
  
  if (candles && candles.length > 0 && indicators) {
    try {
      const adaptiveTargets = adaptiveExits.calculateExitTargets(
        position,
        candles,
        indicators,
        riskLimits
      );
      adaptiveTakeProfit = adaptiveTargets.takeProfitPct;
      adaptiveStopLoss = adaptiveTargets.stopLossPct;
      
      logger.debug(
        {
          symbol: position.symbol,
          baseTakeProfit: riskLimits.takeProfitPct,
          adaptiveTakeProfit,
          baseStopLoss: riskLimits.stopLossPct,
          adaptiveStopLoss,
        },
        'Using adaptive exit targets'
      );
    } catch (error) {
      logger.warn({ error }, 'Failed to calculate adaptive exits, using base limits');
    }
  }
  
  // Calculate current P&L percentage
  const priceChange = isLong 
    ? ((currentPrice - entryPrice) / entryPrice) * 100
    : ((entryPrice - currentPrice) / entryPrice) * 100;
  
  // Check stop loss (using adaptive if available)
  const stopLossPct = adaptiveStopLoss || riskLimits.stopLossPct;
  if (stopLossPct && stopLossPct > 0) {
    if (priceChange <= -stopLossPct) {
      logger.info(
        { 
          symbol: position.symbol, 
          entryPrice, 
          currentPrice, 
          priceChange, 
          stopLossPct,
          adaptive: adaptiveStopLoss !== riskLimits.stopLossPct
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
  
  // Check take profit (using adaptive if available)
  const takeProfitPct = adaptiveTakeProfit || riskLimits.takeProfitPct;
  if (takeProfitPct && takeProfitPct > 0) {
    if (priceChange >= takeProfitPct) {
      logger.info(
        { 
          symbol: position.symbol, 
          entryPrice, 
          currentPrice, 
          priceChange, 
          takeProfitPct,
          adaptive: adaptiveTakeProfit !== riskLimits.takeProfitPct
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




