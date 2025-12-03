import { calculateRSI, calculateEMA, calculateSMA, calculateATR } from './features';
import type { Candle } from '@matcha-ai/shared';

describe('Features', () => {
  const generateCandles = (count: number, startPrice = 100): Candle[] => {
    const candles: Candle[] = [];
    let price = startPrice;
    for (let i = 0; i < count; i++) {
      price = price * (1 + (Math.random() - 0.5) * 0.02);
      candles.push({
        open: price,
        high: price * 1.01,
        low: price * 0.99,
        close: price,
        volume: 1000000,
        timestamp: Date.now() + i * 60000,
      });
    }
    return candles;
  };

  describe('calculateRSI', () => {
    it('should return a value between 0 and 100', () => {
      const candles = generateCandles(30);
      const rsi = calculateRSI(candles);
      expect(rsi).toBeGreaterThanOrEqual(0);
      expect(rsi).toBeLessThanOrEqual(100);
    });
  });

  describe('calculateEMA', () => {
    it('should calculate EMA correctly', () => {
      const candles = generateCandles(20);
      const ema = calculateEMA(candles, 10);
      expect(ema).toBeGreaterThan(0);
    });
  });

  describe('calculateSMA', () => {
    it('should calculate SMA correctly', () => {
      const candles = generateCandles(20);
      const sma = calculateSMA(candles, 10);
      expect(sma).toBeGreaterThan(0);
    });
  });

  describe('calculateATR', () => {
    it('should calculate ATR correctly', () => {
      const candles = generateCandles(20);
      const atr = calculateATR(candles);
      expect(atr).toBeGreaterThanOrEqual(0);
    });
  });
});

