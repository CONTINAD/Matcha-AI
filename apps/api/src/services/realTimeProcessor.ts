import { logger } from '../config/logger';
import { wsService } from './websocket';
import type { Candle } from '@matcha-ai/shared';

export interface PriceAlert {
  symbol: string;
  threshold: number; // Percentage change
  direction: 'up' | 'down' | 'both';
  triggered: boolean;
}

export interface VolumeSpike {
  symbol: string;
  currentVolume: number;
  averageVolume: number;
  spikeRatio: number; // e.g., 2.0 = 2x average
}

/**
 * Real-time data processing service
 * Handles price alerts, volume spikes, and VWAP calculations
 */
export class RealTimeProcessor {
  private priceAlerts: Map<string, PriceAlert[]> = new Map(); // symbol -> alerts
  private volumeHistory: Map<string, number[]> = new Map(); // symbol -> recent volumes
  private priceHistory: Map<string, number[]> = new Map(); // symbol -> recent prices
  private readonly VOLUME_LOOKBACK = 20; // Candles to calculate average volume
  private readonly PRICE_LOOKBACK = 10; // Candles to track price changes

  /**
   * Register a price alert
   */
  registerPriceAlert(symbol: string, alert: PriceAlert): void {
    if (!this.priceAlerts.has(symbol)) {
      this.priceAlerts.set(symbol, []);
    }
    this.priceAlerts.get(symbol)!.push(alert);
    logger.info({ symbol, alert }, 'Price alert registered');
  }

  /**
   * Remove price alert
   */
  removePriceAlert(symbol: string, threshold: number): void {
    const alerts = this.priceAlerts.get(symbol);
    if (alerts) {
      const filtered = alerts.filter(a => a.threshold !== threshold);
      this.priceAlerts.set(symbol, filtered);
    }
  }

  /**
   * Calculate VWAP (Volume Weighted Average Price)
   */
  calculateVWAP(candles: Candle[]): number {
    if (candles.length === 0) return 0;

    let totalValue = 0;
    let totalVolume = 0;

    for (const candle of candles) {
      const typicalPrice = (candle.high + candle.low + candle.close) / 3;
      const value = typicalPrice * candle.volume;
      totalValue += value;
      totalVolume += candle.volume;
    }

    return totalVolume > 0 ? totalValue / totalVolume : 0;
  }

  /**
   * Detect volume spike
   */
  detectVolumeSpike(symbol: string, currentCandle: Candle): VolumeSpike | null {
    // Track volume history
    if (!this.volumeHistory.has(symbol)) {
      this.volumeHistory.set(symbol, []);
    }

    const volumes = this.volumeHistory.get(symbol)!;
    volumes.push(currentCandle.volume);

    // Keep only recent volumes
    if (volumes.length > this.VOLUME_LOOKBACK) {
      volumes.shift();
    }

    if (volumes.length < 5) {
      return null; // Need more data
    }

    // Calculate average volume (excluding current)
    const historicalVolumes = volumes.slice(0, -1);
    const averageVolume = historicalVolumes.reduce((a, b) => a + b, 0) / historicalVolumes.length;

    if (averageVolume === 0) {
      return null;
    }

    const spikeRatio = currentCandle.volume / averageVolume;

    // Alert if volume is 2x or more
    if (spikeRatio >= 2.0) {
      const spike: VolumeSpike = {
        symbol,
        currentVolume: currentCandle.volume,
        averageVolume,
        spikeRatio,
      };

      // Broadcast via WebSocket
      wsService.broadcastPrice(symbol, currentCandle.close, currentCandle.timestamp);
      logger.info({ spike }, 'Volume spike detected');

      return spike;
    }

    return null;
  }

  /**
   * Check price alerts
   */
  checkPriceAlerts(symbol: string, currentPrice: number, previousPrice: number): void {
    const alerts = this.priceAlerts.get(symbol);
    if (!alerts || alerts.length === 0) {
      return;
    }

    const priceChange = ((currentPrice - previousPrice) / previousPrice) * 100;

    for (const alert of alerts) {
      if (alert.triggered) continue;

      let shouldTrigger = false;
      if (alert.direction === 'up' && priceChange >= alert.threshold) {
        shouldTrigger = true;
      } else if (alert.direction === 'down' && priceChange <= -alert.threshold) {
        shouldTrigger = true;
      } else if (alert.direction === 'both' && Math.abs(priceChange) >= alert.threshold) {
        shouldTrigger = true;
      }

      if (shouldTrigger) {
        alert.triggered = true;
        logger.info({ symbol, alert, priceChange }, 'Price alert triggered');
        
        // Broadcast via WebSocket
        wsService.broadcastPrice(symbol, currentPrice, Date.now());
      }
    }
  }

  /**
   * Process new candle for real-time features
   */
  processCandle(symbol: string, candle: Candle): {
    vwap?: number;
    volumeSpike?: VolumeSpike;
    priceChange?: number;
  } {
    const result: {
      vwap?: number;
      volumeSpike?: VolumeSpike;
      priceChange?: number;
    } = {};

    // Track price history
    if (!this.priceHistory.has(symbol)) {
      this.priceHistory.set(symbol, []);
    }

    const prices = this.priceHistory.get(symbol)!;
    prices.push(candle.close);

    if (prices.length > this.PRICE_LOOKBACK) {
      prices.shift();
    }

    // Calculate VWAP if we have enough candles
    if (prices.length >= 5) {
      // For VWAP, we'd need multiple candles - simplified here
      // In production, maintain a rolling window of candles
      result.vwap = this.calculateVWAP([candle]); // Simplified
    }

    // Detect volume spike
    const spike = this.detectVolumeSpike(symbol, candle);
    if (spike) {
      result.volumeSpike = spike;
    }

    // Check price alerts
    if (prices.length >= 2) {
      const previousPrice = prices[prices.length - 2];
      this.checkPriceAlerts(symbol, candle.close, previousPrice);
      result.priceChange = ((candle.close - previousPrice) / previousPrice) * 100;
    }

    return result;
  }

  /**
   * Get current VWAP for a symbol (requires recent candles)
   */
  getCurrentVWAP(symbol: string, recentCandles: Candle[]): number {
    if (recentCandles.length === 0) return 0;
    return this.calculateVWAP(recentCandles);
  }

  /**
   * Clear all alerts and history for a symbol
   */
  clearSymbol(symbol: string): void {
    this.priceAlerts.delete(symbol);
    this.volumeHistory.delete(symbol);
    this.priceHistory.delete(symbol);
  }
}

export const realTimeProcessor = new RealTimeProcessor();

