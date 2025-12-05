import type { Candle } from '@matcha-ai/shared';

export interface Indicators {
  rsi?: number;
  emaFast?: number;
  emaSlow?: number;
  emaTrend?: number; // 1 if fast > slow, -1 if fast < slow, 0 if equal
  volatility?: number; // ATR or standard deviation
  sma20?: number;
  sma50?: number;
  volumeMA?: number;
  // Advanced indicators
  macd?: number;
  macdSignal?: number;
  macdHistogram?: number;
  bollingerUpper?: number;
  bollingerMiddle?: number;
  bollingerLower?: number;
  stochasticK?: number;
  stochasticD?: number;
  adx?: number; // Average Directional Index
  williamsR?: number; // Williams %R
  cci?: number; // Commodity Channel Index
  mfi?: number; // Money Flow Index
  obv?: number; // On-Balance Volume
  // Pattern recognition
  supportLevel?: number;
  resistanceLevel?: number;
  trendStrength?: number; // 0-1, how strong the trend is
  momentum?: number; // Price momentum
}

/**
 * Calculate RSI (Relative Strength Index)
 */
export function calculateRSI(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 50; // Default neutral

  const changes: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    changes.push(candles[i].close - candles[i - 1].close);
  }

  const gains = changes.filter((c) => c > 0);
  const losses = changes.filter((c) => c < 0).map((c) => Math.abs(c));

  const avgGain = gains.length > 0 ? gains.reduce((a, b) => a + b, 0) / gains.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Calculate EMA (Exponential Moving Average)
 */
export function calculateEMA(candles: Candle[], period: number, field: 'close' | 'high' | 'low' = 'close'): number {
  if (candles.length === 0) return 0;
  if (candles.length < period) {
    // Use SMA for initial values
    const sum = candles.reduce((acc, c) => acc + c[field], 0);
    return sum / candles.length;
  }

  const multiplier = 2 / (period + 1);
  let ema = candles[0][field];

  for (let i = 1; i < candles.length; i++) {
    ema = (candles[i][field] - ema) * multiplier + ema;
  }

  return ema;
}

/**
 * Calculate SMA (Simple Moving Average)
 */
export function calculateSMA(candles: Candle[], period: number, field: 'close' | 'high' | 'low' = 'close'): number {
  if (candles.length === 0) return 0;
  const relevant = candles.slice(-period);
  const sum = relevant.reduce((acc, c) => acc + c[field], 0);
  return sum / relevant.length;
}

/**
 * Calculate ATR (Average True Range) as volatility measure
 */
export function calculateATR(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;

  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    trueRanges.push(tr);
  }

  if (trueRanges.length === 0) return 0;
  const relevant = trueRanges.slice(-period);
  return relevant.reduce((a, b) => a + b, 0) / relevant.length;
}

/**
 * Calculate standard deviation of returns (volatility)
 */
export function calculateVolatility(candles: Candle[], period = 20): number {
  if (candles.length < 2) return 0;

  const returns: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const ret = (candles[i].close - candles[i - 1].close) / candles[i - 1].close;
    returns.push(ret);
  }

  if (returns.length === 0) return 0;
  const relevant = returns.slice(-period);
  const mean = relevant.reduce((a, b) => a + b, 0) / relevant.length;
  const variance = relevant.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / relevant.length;
  return Math.sqrt(variance);
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 */
export function calculateMACD(candles: Candle[], fastPeriod = 12, slowPeriod = 26, signalPeriod = 9): { macd: number; signal: number; histogram: number } {
  if (candles.length < slowPeriod + signalPeriod) {
    return { macd: 0, signal: 0, histogram: 0 };
  }

  const emaFast = calculateEMA(candles, fastPeriod);
  const emaSlow = calculateEMA(candles, slowPeriod);
  const macd = emaFast - emaSlow;

  // Calculate signal line (EMA of MACD)
  // Simplified: use recent MACD values
  const recentCandles = candles.slice(-signalPeriod);
  const signal = calculateEMA(recentCandles, signalPeriod);
  const histogram = macd - signal;

  return { macd, signal, histogram };
}

/**
 * Calculate Bollinger Bands
 */
export function calculateBollingerBands(candles: Candle[], period = 20, stdDev = 2): { upper: number; middle: number; lower: number } {
  if (candles.length < period) {
    const price = candles[candles.length - 1]?.close || 0;
    return { upper: price, middle: price, lower: price };
  }

  const sma = calculateSMA(candles, period);
  const relevant = candles.slice(-period);
  const variance = relevant.reduce((sum, c) => sum + Math.pow(c.close - sma, 2), 0) / period;
  const std = Math.sqrt(variance);

  return {
    upper: sma + stdDev * std,
    middle: sma,
    lower: sma - stdDev * std,
  };
}

/**
 * Calculate Stochastic Oscillator
 */
export function calculateStochastic(candles: Candle[], period = 14): { k: number; d: number } {
  if (candles.length < period) {
    return { k: 50, d: 50 };
  }

  const relevant = candles.slice(-period);
  const highest = Math.max(...relevant.map((c) => c.high));
  const lowest = Math.min(...relevant.map((c) => c.low));
  const currentClose = candles[candles.length - 1].close;

  if (highest === lowest) {
    return { k: 50, d: 50 };
  }

  const k = ((currentClose - lowest) / (highest - lowest)) * 100;

  // D is SMA of K (simplified)
  const d = k; // In full implementation, would be SMA of K over 3 periods

  return { k, d };
}

/**
 * Calculate ADX (Average Directional Index) - simplified
 */
export function calculateADX(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 25; // Neutral

  // Simplified ADX calculation
  const plusDM: number[] = [];
  const minusDM: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const highDiff = candles[i].high - candles[i - 1].high;
    const lowDiff = candles[i - 1].low - candles[i].low;

    plusDM.push(highDiff > lowDiff && highDiff > 0 ? highDiff : 0);
    minusDM.push(lowDiff > highDiff && lowDiff > 0 ? lowDiff : 0);
  }

  const avgPlusDM = plusDM.slice(-period).reduce((a, b) => a + b, 0) / period;
  const avgMinusDM = minusDM.slice(-period).reduce((a, b) => a + b, 0) / period;
  const tr = calculateATR(candles, period);

  if (tr === 0) return 25;

  const plusDI = (avgPlusDM / tr) * 100;
  const minusDI = (avgMinusDM / tr) * 100;
  const dx = Math.abs(plusDI - minusDI) / (plusDI + minusDI) * 100;

  return dx || 25;
}

/**
 * Calculate Williams %R
 */
export function calculateWilliamsR(candles: Candle[], period = 14): number {
  if (candles.length < period) return -50;

  const relevant = candles.slice(-period);
  const highest = Math.max(...relevant.map((c) => c.high));
  const lowest = Math.min(...relevant.map((c) => c.low));
  const currentClose = candles[candles.length - 1].close;

  if (highest === lowest) return -50;

  return ((highest - currentClose) / (highest - lowest)) * -100;
}

/**
 * Calculate CCI (Commodity Channel Index)
 */
export function calculateCCI(candles: Candle[], period = 20): number {
  if (candles.length < period) return 0;

  const relevant = candles.slice(-period);
  const typicalPrices = relevant.map((c) => (c.high + c.low + c.close) / 3);
  const smaTP = typicalPrices.reduce((a, b) => a + b, 0) / period;
  const meanDeviation =
    typicalPrices.reduce((sum, tp) => sum + Math.abs(tp - smaTP), 0) / period;

  if (meanDeviation === 0) return 0;

  const currentTP = (candles[candles.length - 1].high + candles[candles.length - 1].low + candles[candles.length - 1].close) / 3;
  return (currentTP - smaTP) / (0.015 * meanDeviation);
}

/**
 * Calculate Momentum
 */
export function calculateMomentum(candles: Candle[], period = 10): number {
  if (candles.length < period + 1) return 0;

  const current = candles[candles.length - 1].close;
  const past = candles[candles.length - period - 1].close;

  return ((current - past) / past) * 100;
}

/**
 * Detect support and resistance levels
 */
export function detectSupportResistance(candles: Candle[]): { support: number; resistance: number } {
  if (candles.length < 20) {
    const price = candles[candles.length - 1]?.close || 0;
    return { support: price * 0.95, resistance: price * 1.05 };
  }

  const recent = candles.slice(-20);
  const lows = recent.map((c) => c.low);
  const highs = recent.map((c) => c.high);

  const support = Math.min(...lows);
  const resistance = Math.max(...highs);

  return { support, resistance };
}

/**
 * Calculate trend strength (0-1)
 */
export function calculateTrendStrength(candles: Candle[], period = 20): number {
  if (candles.length < period) return 0.5;

  const relevant = candles.slice(-period);
  const prices = relevant.map((c) => c.close);

  // Count how many prices are above/below SMA
  const sma = calculateSMA(candles, period);
  const above = prices.filter((p) => p > sma).length;
  const below = prices.filter((p) => p < sma).length;

  // Strong trend if most prices on one side
  const strength = Math.max(above, below) / period;
  return strength;
}

/**
 * Detect market trend regime
 * Returns: 'trending' | 'ranging' | 'choppy'
 */
export function detectTrendRegime(candles: Candle[], indicators: Indicators): 'trending' | 'ranging' | 'choppy' {
  if (candles.length < 20) return 'ranging';

  const adx = indicators.adx || 0;
  const trendStrength = indicators.trendStrength || 0;
  const emaFast = indicators.emaFast;
  const emaSlow = indicators.emaSlow;
  const sma20 = indicators.sma20;
  const sma50 = indicators.sma50;

  // Use ADX as primary indicator (ADX > 25 = strong trend)
  if (adx > 25 && trendStrength > 0.6) {
    // Check if EMAs or SMAs confirm trend direction
    const hasTrend = (emaFast && emaSlow && Math.abs(emaFast - emaSlow) / emaSlow > 0.01) ||
                    (sma20 && sma50 && Math.abs(sma20 - sma50) / sma50 > 0.01);
    if (hasTrend) {
      return 'trending';
    }
  }

  // Choppy market: Low ADX, high volatility, no clear direction
  const volatility = indicators.volatility || 0;
  const price = candles[candles.length - 1]?.close || 0;
  const volatilityPct = price > 0 ? (volatility / price) * 100 : 0;
  
  if (adx < 20 && volatilityPct > 2 && trendStrength < 0.5) {
    return 'choppy';
  }

  // Default to ranging
  return 'ranging';
}

/**
 * Detect volatility regime
 * Returns: 'low' | 'medium' | 'high'
 */
export function detectVolatilityRegime(candles: Candle[], indicators: Indicators): 'low' | 'medium' | 'high' {
  if (candles.length < 14) return 'medium';

  const atr = indicators.volatility || 0;
  const price = candles[candles.length - 1]?.close || 0;
  
  if (price === 0) return 'medium';

  // Calculate ATR as percentage of price
  const atrPct = (atr / price) * 100;

  // Thresholds based on typical crypto volatility
  if (atrPct < 0.5) {
    return 'low';
  } else if (atrPct > 2.0) {
    return 'high';
  }

  return 'medium';
}

/**
 * Detect RSI regime
 * Returns: 'oversold' | 'neutral' | 'overbought'
 */
export function detectRSIRegime(rsi?: number): 'oversold' | 'neutral' | 'overbought' {
  if (!rsi) return 'neutral';

  if (rsi < 30) {
    return 'oversold';
  } else if (rsi > 70) {
    return 'overbought';
  }

  return 'neutral';
}

/**
 * Extract all indicators from recent candles (enhanced with parallel calculation)
 */
export async function extractIndicators(candles: Candle[], config?: { rsi?: { period: number }; ema?: { fast: number; slow: number } }): Promise<Indicators> {
  if (candles.length === 0) return {};

  const indicators: Indicators = {};

  // Calculate all indicators in parallel for better performance
  const [
    rsi,
    emaFast,
    emaSlow,
    volatility,
    sma20,
    sma50,
    volumeMA,
    macd,
    bollinger,
    stochastic,
    adx,
    williamsR,
    cci,
    momentum,
    sr,
    trendStrength,
  ] = await Promise.all([
    // Basic indicators
    Promise.resolve(config?.rsi ? calculateRSI(candles, config.rsi.period) : calculateRSI(candles, 14)),
    Promise.resolve(config?.ema ? calculateEMA(candles, config.ema.fast) : calculateEMA(candles, 12)),
    Promise.resolve(config?.ema ? calculateEMA(candles, config.ema.slow) : calculateEMA(candles, 26)),
    Promise.resolve(calculateATR(candles)),
    Promise.resolve(calculateSMA(candles, 20)),
    Promise.resolve(calculateSMA(candles, 50)),
    Promise.resolve(calculateSMA(candles, 20, 'close')),
    // Advanced indicators
    Promise.resolve(calculateMACD(candles)),
    Promise.resolve(calculateBollingerBands(candles)),
    Promise.resolve(calculateStochastic(candles)),
    Promise.resolve(calculateADX(candles)),
    Promise.resolve(calculateWilliamsR(candles)),
    Promise.resolve(calculateCCI(candles)),
    Promise.resolve(calculateMomentum(candles)),
    // Pattern recognition
    Promise.resolve(detectSupportResistance(candles)),
    Promise.resolve(calculateTrendStrength(candles)),
  ]);

  // Assign results
  indicators.rsi = rsi;
  indicators.emaFast = emaFast;
  indicators.emaSlow = emaSlow;
  indicators.emaTrend = emaFast > emaSlow ? 1 : emaFast < emaSlow ? -1 : 0;
  indicators.volatility = volatility;
  indicators.sma20 = sma20;
  indicators.sma50 = sma50;
  indicators.volumeMA = volumeMA;

  indicators.macd = macd.macd;
  indicators.macdSignal = macd.signal;
  indicators.macdHistogram = macd.histogram;

  indicators.bollingerUpper = bollinger.upper;
  indicators.bollingerMiddle = bollinger.middle;
  indicators.bollingerLower = bollinger.lower;

  indicators.stochasticK = stochastic.k;
  indicators.stochasticD = stochastic.d;

  indicators.adx = adx;
  indicators.williamsR = williamsR;
  indicators.cci = cci;
  indicators.momentum = momentum;

  indicators.supportLevel = sr.support;
  indicators.resistanceLevel = sr.resistance;
  indicators.trendStrength = trendStrength;

  return indicators;
}

/**
 * Synchronous version for backwards compatibility (deprecated - use async version)
 */
export function extractIndicatorsSync(candles: Candle[], config?: { rsi?: { period: number }; ema?: { fast: number; slow: number } }): Indicators {
  if (candles.length === 0) return {};

  const indicators: Indicators = {};

  // Basic indicators
  if (config?.rsi) {
    indicators.rsi = calculateRSI(candles, config.rsi.period);
  } else {
    indicators.rsi = calculateRSI(candles, 14);
  }

  // EMAs
  if (config?.ema) {
    indicators.emaFast = calculateEMA(candles, config.ema.fast);
    indicators.emaSlow = calculateEMA(candles, config.ema.slow);
    indicators.emaTrend = indicators.emaFast > indicators.emaSlow ? 1 : indicators.emaFast < indicators.emaSlow ? -1 : 0;
  } else {
    indicators.emaFast = calculateEMA(candles, 12);
    indicators.emaSlow = calculateEMA(candles, 26);
    indicators.emaTrend = indicators.emaFast > indicators.emaSlow ? 1 : indicators.emaFast < indicators.emaSlow ? -1 : 0;
  }

  // Volatility (ATR)
  indicators.volatility = calculateATR(candles);

  // SMAs
  indicators.sma20 = calculateSMA(candles, 20);
  indicators.sma50 = calculateSMA(candles, 50);

  // Volume MA
  indicators.volumeMA = calculateSMA(candles, 20, 'close');

  // Advanced indicators
  const macd = calculateMACD(candles);
  indicators.macd = macd.macd;
  indicators.macdSignal = macd.signal;
  indicators.macdHistogram = macd.histogram;

  const bollinger = calculateBollingerBands(candles);
  indicators.bollingerUpper = bollinger.upper;
  indicators.bollingerMiddle = bollinger.middle;
  indicators.bollingerLower = bollinger.lower;

  const stochastic = calculateStochastic(candles);
  indicators.stochasticK = stochastic.k;
  indicators.stochasticD = stochastic.d;

  indicators.adx = calculateADX(candles);
  indicators.williamsR = calculateWilliamsR(candles);
  indicators.cci = calculateCCI(candles);
  indicators.momentum = calculateMomentum(candles);

  // Pattern recognition
  const sr = detectSupportResistance(candles);
  indicators.supportLevel = sr.support;
  indicators.resistanceLevel = sr.resistance;
  indicators.trendStrength = calculateTrendStrength(candles);

  return indicators;
}

