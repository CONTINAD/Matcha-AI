# 🎉 Codex 5.1 Integration Guide

## What Was Added

Codex 5.1 has successfully upgraded your system with:

### ✅ Real Data Integration
- **CoinGecko Pro API** - Real-time and historical prices
- **Binance WebSocket** - Live streaming prices
- **The Graph** - DEX data integration
- **Redis caching** - Fast data access with fallback to memory
- **Data validation** - Quality checks and error handling
- **VWAP & Order Book** - Advanced market microstructure

### ✅ Advanced Risk Management
- **Value at Risk (VaR)** - Portfolio risk calculation
- **Conditional VaR (CVaR)** - Tail risk management
- **Kelly Criterion** - Optimal position sizing
- **Circuit breakers** - Automatic trading halt on losses

### ✅ Observability
- **Prometheus metrics** - `/metrics/prom` endpoint
- **Structured metrics** - Data provider latency, AI decision time, risk rejections
- **Grafana-ready** - Can be hooked into Grafana dashboards

## 🚀 Quick Start

### 1. Install Dependencies

```bash
cd "/Users/alexaustin/Desktop/Matcha AI"
pnpm install
```

### 2. Set Up Environment Variables

Add these to your `.env` file:

```bash
# CoinGecko API (get free key at https://www.coingecko.com/en/api)
COINGECKO_API_KEY=your_coingecko_api_key_here

# Redis (optional - will use in-memory cache if not set)
REDIS_URL=redis://localhost:6379

# Binance (optional - has defaults)
BINANCE_REST_URL=https://api.binance.com
BINANCE_WS_URL=wss://stream.binance.com:9443/stream
BINANCE_DEFAULT_QUOTE=USDT

# The Graph (optional)
THE_GRAPH_API_URL=https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3

# Observability (optional)
ENABLE_METRICS=true
```

### 3. Start Redis (Optional but Recommended)

```bash
# Using Docker
docker run -d -p 6379:6379 redis:7-alpine

# Or using Homebrew (macOS)
brew install redis
brew services start redis
```

### 4. Verify Installation

```bash
# Run tests
pnpm --filter @matcha-ai/api test

# Check if it compiles
pnpm build:api
```

### 5. Start the System

```bash
# Start API
pnpm dev:api

# In another terminal, start web
pnpm dev:web
```

## 📊 New Features

### Real Data Access

The system now uses **real market data** instead of mock data:

```typescript
// Data is automatically fetched from:
// 1. CoinGecko (primary)
// 2. Binance WebSocket (live prices)
// 3. The Graph (DEX data)
// 4. Cached in Redis for performance
```

### Advanced Risk Calculations

```typescript
import { riskEngine } from './services/riskEngine';

// Calculate VaR
const varPct = riskEngine.calculateHistoricalVaR(returns, 0.95);

// Calculate CVaR (tail risk)
const cvarPct = riskEngine.calculateCVaR(returns, 0.95);

// Kelly Criterion position sizing
const kellyPct = riskEngine.calculateKellyPositionPct(
  winRate,
  payoffRatio,
  maxPositionPct
);
```

### Prometheus Metrics

Access metrics at:
- **JSON**: `http://localhost:4000/metrics`
- **Prometheus**: `http://localhost:4000/metrics/prom`

Key metrics:
- `matcha_data_provider_latency_seconds` - Data fetch times
- `matcha_data_provider_errors_total` - Data provider failures
- `matcha_risk_rejections_total` - Risk engine rejections
- `matcha_decision_latency_seconds` - AI decision time

## 🔍 What Changed

### New Files
- `apps/api/src/services/dataAggregator.ts` - Real data aggregation
- `apps/api/src/services/cache.ts` - Redis caching layer
- `apps/api/src/services/riskEngine.ts` - Advanced risk calculations
- `apps/api/src/services/metrics.ts` - Prometheus metrics

### Modified Files
- `apps/api/src/services/dataFeed.ts` - Now uses real data
- `apps/api/src/services/riskManager.ts` - Uses new risk engine
- `apps/api/src/services/backtester.ts` - Enhanced risk checks
- `apps/api/src/services/paperTrader.ts` - Real data integration
- `apps/api/src/services/liveTrader.ts` - Real data integration
- `apps/api/src/services/matchaBrain.ts` - Metrics instrumentation
- `apps/api/src/routes/health.ts` - Prometheus endpoint
- `packages/shared/src/config/chains.ts` - Token metadata with IDs
- `packages/shared/src/types/index.ts` - New types

## 🧪 Testing

### Test the Data Aggregator

```bash
# The system will automatically use real data
# Check logs to see data provider calls
pnpm dev:api
```

### Test Risk Engine

```typescript
import { riskEngine } from './services/riskEngine';

const returns = [-0.01, 0.02, -0.005, 0.01, -0.02];
const varPct = riskEngine.calculateHistoricalVaR(returns, 0.95);
console.log(`VaR (95%): ${varPct * 100}%`);
```

### Test Metrics

```bash
# Check Prometheus metrics
curl http://localhost:4000/metrics/prom

# Check JSON metrics
curl http://localhost:4000/metrics
```

## 🎯 Next Steps

1. **Get CoinGecko API Key** (free tier available)
   - Sign up at https://www.coingecko.com/en/api
   - Add to `.env` as `COINGECKO_API_KEY`

2. **Set Up Redis** (optional but recommended)
   - Improves performance significantly
   - Falls back to memory if not available

3. **Set Up Grafana** (optional)
   - Connect to `/metrics/prom` endpoint
   - Create dashboards for monitoring

4. **Run a Backtest**
   - Now uses **real historical data**!
   - Much more accurate results

5. **Monitor Performance**
   - Check `/metrics/prom` for system health
   - Watch for data provider errors
   - Monitor AI decision latency

## ⚠️ Important Notes

1. **CoinGecko API Key**: Required for real data. Free tier has rate limits.
2. **Redis**: Optional but recommended for production. Falls back to memory.
3. **Rate Limits**: Be aware of API rate limits from providers.
4. **Costs**: CoinGecko Pro has paid tiers for higher limits.

## 🐛 Troubleshooting

### "Data provider error"
- Check your `COINGECKO_API_KEY` is set correctly
- Verify API key has sufficient quota
- Check network connectivity

### "Redis connection error"
- System will fall back to in-memory cache
- Check Redis is running: `redis-cli ping`
- Verify `REDIS_URL` is correct

### "Metrics not showing"
- Check `ENABLE_METRICS=true` in `.env`
- Verify Prometheus client is installed
- Check `/metrics/prom` endpoint is accessible

## 🎉 Success!

Your system now has:
- ✅ Real market data (no more mocks!)
- ✅ Advanced risk management (VaR, CVaR, Kelly)
- ✅ Production-ready observability (Prometheus)
- ✅ High-performance caching (Redis)

**The system is now significantly more intelligent and production-ready!**


