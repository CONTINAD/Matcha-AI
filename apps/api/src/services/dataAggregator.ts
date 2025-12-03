import axios from 'axios';
import WebSocket from 'ws';
import { request, gql } from 'graphql-request';
import type { Candle } from '@matcha-ai/shared';
import { getTokenConfig, timeframeToMs } from '@matcha-ai/shared';
import { config } from '../config/env';
import { logger } from '../config/logger';
import { cacheClient } from './cache';
import { dataProviderErrors, dataProviderLatency } from './metrics';

export interface MarketSnapshot {
  candle: Candle;
  source: 'binance' | 'coingecko';
  vwap?: number;
  dexVolumeUsd24h?: number;
  orderBook?: OrderBookMetrics;
}

export interface OrderBookMetrics {
  bidAskSpreadPct: number;
  midPrice: number;
  totalBidNotional: number;
  totalAskNotional: number;
  imbalancePct: number; // >0 bullish, <0 bearish
  vwap: number;
}

type PricePoint = [number, number]; // [timestamp, price]

const BINANCE_INTERVAL_MAP: Record<string, string> = {
  '1m': '1m',
  '3m': '3m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1h',
  '2h': '2h',
  '4h': '4h',
  '6h': '6h',
  '8h': '8h',
  '12h': '12h',
  '1d': '1d',
  '3d': '3d',
  '1w': '1w',
};

class DataAggregator {
  private readonly latestTicks: Map<string, { price: number; timestamp: number }> = new Map();
  private readonly streams: Map<string, WebSocket> = new Map();

  /**
   * Get historical candles (CoinGecko + cache)
   */
  async getHistoricalCandles(params: {
    symbol: string;
    timeframe: string;
    from: number;
    to: number;
    chainId?: number;
    useCache?: boolean;
  }): Promise<Candle[]> {
    const { symbol, timeframe, from, to, chainId, useCache = true } = params;
    const cacheKey = `hist:${symbol}:${timeframe}:${from}:${to}`;

    if (useCache) {
      const cached = await cacheClient.get<Candle[]>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const coingeckoId = this.getCoinGeckoId(symbol, chainId);
    if (!coingeckoId) {
      throw new Error(`No CoinGecko mapping for symbol ${symbol}`);
    }

    const endTimer = dataProviderLatency.startTimer({ provider: 'coingecko', type: 'historical' });
    try {
      const url = `${config.dataProviders.coinGecko.baseUrl}/coins/${coingeckoId}/market_chart/range`;
      const { data } = await axios.get<{
        prices: PricePoint[];
        total_volumes: PricePoint[];
      }>(url, {
        params: {
          vs_currency: 'usd',
          from: Math.floor(from / 1000),
          to: Math.floor(to / 1000),
        },
        headers: config.dataProviders.coinGecko.apiKey
          ? { 'x-cg-pro-api-key': config.dataProviders.coinGecko.apiKey }
          : undefined,
        timeout: 15000,
      });

      const candles = this.buildCandlesFromSeries(data.prices || [], data.total_volumes || [], timeframe);
      const validated = this.validateCandles(candles);

      if (useCache && validated.length > 0) {
        await cacheClient.set(cacheKey, validated, 300); // 5 minutes
      }

      return validated;
    } catch (error) {
      dataProviderErrors.inc({ provider: 'coingecko', type: 'historical' });
      logger.error({ error, symbol }, 'Failed to fetch CoinGecko historical candles');
      throw error;
    } finally {
      endTimer();
    }
  }

  /**
   * Get latest market snapshot (Binance live + order book + DEX volume)
   */
  async getLatestSnapshot(
    symbol: string,
    timeframe: string,
    chainId?: number
  ): Promise<MarketSnapshot | null> {
    const quote = config.dataProviders.binance.defaultQuote || 'USDT';
    const pair = this.getBinancePair(symbol, quote, chainId);

    let candle: Candle | null = null;
    let source: MarketSnapshot['source'] = 'binance';

    // Try WebSocket tick first (fast path)
    const tick = pair ? this.latestTicks.get(pair) : undefined;
    if (tick) {
      candle = {
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
        volume: 0,
        timestamp: tick.timestamp,
      };
    }

    // Fallback to Binance REST klines
    if (!candle && pair) {
      candle = await this.fetchBinanceCandle(pair, timeframe);
    }

    // Fallback to CoinGecko spot price
    if (!candle) {
      const coingeckoId = this.getCoinGeckoId(symbol, chainId);
      if (!coingeckoId) return null;

      const endTimer = dataProviderLatency.startTimer({ provider: 'coingecko', type: 'spot' });
      try {
        const url = `${config.dataProviders.coinGecko.baseUrl}/simple/price`;
        const { data } = await axios.get<{ [key: string]: { usd: number } }>(url, {
          params: {
            ids: coingeckoId,
            vs_currencies: 'usd',
          },
          headers: config.dataProviders.coinGecko.apiKey
            ? { 'x-cg-pro-api-key': config.dataProviders.coinGecko.apiKey }
            : undefined,
          timeout: 10000,
        });

        const price = data[coingeckoId]?.usd;
        if (!price) return null;

        candle = {
          open: price,
          high: price,
          low: price,
          close: price,
          volume: 0,
          timestamp: Date.now(),
        };
        source = 'coingecko';
      } catch (error) {
        dataProviderErrors.inc({ provider: 'coingecko', type: 'spot' });
        logger.error({ error, symbol }, 'Failed to fetch CoinGecko spot price');
        return null;
      } finally {
        endTimer();
      }
    }

    const snapshot: MarketSnapshot = { candle, source };

    // Attach order book metrics when using Binance
    if (pair) {
      const orderBook = await this.fetchOrderBookMetrics(pair);
      snapshot.orderBook = orderBook || undefined;
      snapshot.vwap = orderBook?.vwap;
    }

    // Add on-chain volume (DEX) for context
    try {
      const dexVolume = await this.fetchDexVolumeUsd(symbol, chainId);
      snapshot.dexVolumeUsd24h = dexVolume ?? undefined;
    } catch (error) {
      logger.warn({ error, symbol }, 'Failed to fetch DEX volume from The Graph');
    }

    // Ensure streaming is running for low-latency updates
    if (pair) {
      this.ensureTickerStream(pair);
    }

    return snapshot;
  }

  /**
   * Start/ensure Binance WebSocket stream for a pair
   */
  private ensureTickerStream(pair: string): void {
    if (this.streams.has(pair)) {
      return;
    }

    const streamName = `${pair.toLowerCase()}@ticker`;
    const wsUrl = `${config.dataProviders.binance.wsUrl}/stream?streams=${streamName}`;
    const ws = new WebSocket(wsUrl);

    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const parsed = JSON.parse(data.toString());
        const payload = parsed.data;
        const price = parseFloat(payload?.c);
        const eventTime = payload?.E;
        if (!Number.isFinite(price)) return;
        this.latestTicks.set(pair, { price, timestamp: eventTime || Date.now() });
      } catch (error) {
        logger.warn({ error, pair }, 'Failed to parse Binance ticker message');
      }
    });

    ws.on('close', () => {
      logger.warn({ pair }, 'Binance stream closed, attempting reconnect');
      this.streams.delete(pair);
      setTimeout(() => this.ensureTickerStream(pair), 2000);
    });

    ws.on('error', (error) => {
      logger.warn({ error, pair }, 'Binance stream error');
      ws.close();
    });

    this.streams.set(pair, ws);
  }

  /**
   * Fetch a single candle from Binance REST
   */
  private async fetchBinanceCandle(pair: string, timeframe: string): Promise<Candle | null> {
    const interval = BINANCE_INTERVAL_MAP[timeframe];
    if (!interval) {
      logger.warn({ timeframe }, 'Unsupported timeframe for Binance');
      return null;
    }

    const endTimer = dataProviderLatency.startTimer({ provider: 'binance', type: 'klines' });
    try {
      const { data } = await axios.get<any[]>(
        `${config.dataProviders.binance.restUrl}/api/v3/klines`,
        {
          params: { symbol: pair, interval, limit: 2 },
          timeout: 10000,
        }
      );

      if (!Array.isArray(data) || data.length === 0) return null;
      const last = data[data.length - 1];
      const candle: Candle = {
        open: parseFloat(last[1]),
        high: parseFloat(last[2]),
        low: parseFloat(last[3]),
        close: parseFloat(last[4]),
        volume: parseFloat(last[5]),
        timestamp: Number(last[6]),
      };
      return this.validateCandles([candle])[0] || null;
    } catch (error) {
      dataProviderErrors.inc({ provider: 'binance', type: 'klines' });
      logger.warn({ error, pair }, 'Failed to fetch Binance candle');
      return null;
    } finally {
      endTimer();
    }
  }

  /**
   * Fetch order book metrics from Binance depth
   */
  private async fetchOrderBookMetrics(pair: string): Promise<OrderBookMetrics | null> {
    const cacheKey = `ob:${pair}`;
    const cached = await cacheClient.get<OrderBookMetrics>(cacheKey);
    if (cached) return cached;

    const endTimer = dataProviderLatency.startTimer({ provider: 'binance', type: 'orderbook' });
    try {
      const { data } = await axios.get<{ bids: [string, string][]; asks: [string, string][] }>(
        `${config.dataProviders.binance.restUrl}/api/v3/depth`,
        {
          params: { symbol: pair, limit: 50 },
          timeout: 8000,
        }
      );

      const bids = (data.bids || []).map(([price, qty]) => ({
        price: parseFloat(price),
        qty: parseFloat(qty),
      }));
      const asks = (data.asks || []).map(([price, qty]) => ({
        price: parseFloat(price),
        qty: parseFloat(qty),
      }));

      if (bids.length === 0 || asks.length === 0) {
        return null;
      }

      const topBid = bids[0].price;
      const topAsk = asks[0].price;
      const midPrice = (topBid + topAsk) / 2;
      const spreadPct = ((topAsk - topBid) / midPrice) * 100;

      const bidNotional = bids.reduce((sum, b) => sum + b.price * b.qty, 0);
      const askNotional = asks.reduce((sum, a) => sum + a.price * a.qty, 0);
      const totalQty = bids.reduce((sum, b) => sum + b.qty, 0) + asks.reduce((sum, a) => sum + a.qty, 0);
      const vwap = totalQty > 0 ? (bidNotional + askNotional) / totalQty : midPrice;

      const metrics: OrderBookMetrics = {
        bidAskSpreadPct: spreadPct,
        midPrice,
        totalBidNotional: bidNotional,
        totalAskNotional: askNotional,
        imbalancePct: (bidNotional - askNotional) / (bidNotional + askNotional),
        vwap,
      };

      await cacheClient.set(cacheKey, metrics, 5);
      return metrics;
    } catch (error) {
      dataProviderErrors.inc({ provider: 'binance', type: 'orderbook' });
      logger.warn({ error, pair }, 'Failed to fetch order book metrics');
      return null;
    } finally {
      endTimer();
    }
  }

  /**
   * Fetch 24h DEX volume from The Graph (Uniswap v3)
   */
  private async fetchDexVolumeUsd(symbol: string, chainId?: number): Promise<number | null> {
    const cacheKey = `dexVol:${symbol}:${chainId || '1'}`;
    const cached = await cacheClient.get<number>(cacheKey);
    if (cached !== null) return cached;

    const token = getTokenConfig(symbol, chainId || 1);
    if (!token) return null;

    const query = gql`
      query TokenVolume($id: ID!) {
        token(id: $id) {
          volumeUSD
        }
      }
    `;

    const endTimer = dataProviderLatency.startTimer({ provider: 'thegraph', type: 'dex-volume' });
    try {
      const result = await request<{ token: { volumeUSD: string } | null }>(
        config.dataProviders.theGraph.uniswapV3Url,
        query,
        { id: token.address.toLowerCase() }
      );

      const volume = result.token ? parseFloat(result.token.volumeUSD) : null;
      if (volume !== null) {
        await cacheClient.set(cacheKey, volume, 300);
      }
      return volume;
    } catch (error) {
      dataProviderErrors.inc({ provider: 'thegraph', type: 'dex-volume' });
      logger.warn({ error, symbol }, 'Failed to fetch token volume from The Graph');
      return null;
    } finally {
      endTimer();
    }
  }

  /**
   * Build candles from CoinGecko price series
   */
  private buildCandlesFromSeries(prices: PricePoint[], volumes: PricePoint[], timeframe: string): Candle[] {
    if (!prices || prices.length === 0) return [];

    const bucketMs = timeframeToMs(timeframe);
    const volumeMap = new Map<number, number>();
    volumes.forEach(([ts, vol]) => volumeMap.set(Math.floor(ts), vol));

    const buckets: Map<number, Candle> = new Map();
    for (const [timestamp, price] of prices) {
      const bucket = Math.floor(timestamp / bucketMs) * bucketMs;
      const existing = buckets.get(bucket);
      if (!existing) {
        buckets.set(bucket, {
          open: price,
          high: price,
          low: price,
          close: price,
          volume: volumeMap.get(Math.floor(timestamp)) || 0,
          timestamp: bucket,
        });
      } else {
        existing.high = Math.max(existing.high, price);
        existing.low = Math.min(existing.low, price);
        existing.close = price;
        existing.volume += volumeMap.get(Math.floor(timestamp)) || 0;
      }
    }

    return Array.from(buckets.values()).sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Validate and de-noise candle series
   */
  private validateCandles(candles: Candle[]): Candle[] {
    const filtered = candles.filter(
      (c) =>
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close) &&
        Number.isFinite(c.volume) &&
        c.open > 0 &&
        c.high > 0 &&
        c.low > 0 &&
        c.close > 0
    );

    filtered.sort((a, b) => a.timestamp - b.timestamp);

    // Remove obvious outliers (price jump > 50% within one candle)
    const cleaned: Candle[] = [];
    for (let i = 0; i < filtered.length; i++) {
      const candle = filtered[i];
      const prev = cleaned[cleaned.length - 1];
      if (prev) {
        const jump = Math.abs(candle.close - prev.close) / prev.close;
        if (jump > 0.5) {
          continue;
        }
      }
      cleaned.push(candle);
    }

    return cleaned;
  }

  private getCoinGeckoId(symbol: string, chainId?: number): string | undefined {
    const token = getTokenConfig(symbol, chainId || 1);
    return token?.coingeckoId;
  }

  private getBinancePair(symbol: string, quote: string, chainId?: number): string | null {
    const token = getTokenConfig(symbol, chainId || 1);
    const baseSymbol = token?.binanceSymbol || symbol;
    const pair = `${baseSymbol.toUpperCase()}${quote.toUpperCase()}`;
    return pair;
  }
}

export const dataAggregator = new DataAggregator();
