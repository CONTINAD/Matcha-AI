# 🚀 Quick Start - Everything is Set Up!

## ✅ What I Just Did For You

1. **Created `.env` file** with your CoinGecko API key: `CG-Db59VQ8EmFTJqhHumKaXPyZR`
2. **Added all required API keys** (OpenAI, 0x, CoinGecko)
3. **Configured all services** (Redis, Binance, The Graph, Prometheus)

## 🎯 Next Steps (Run These Commands)

### 1. Install Dependencies

```bash
cd "/Users/alexaustin/Desktop/Matcha AI"
pnpm install
```

If you don't have `pnpm`, install it first:
```bash
npm install -g pnpm
```

### 2. Set Up Database

```bash
# Generate Prisma client
pnpm db:generate

# Run migrations (creates tables)
pnpm db:migrate

# Optional: Seed with test data
pnpm db:seed
```

**Note**: Make sure PostgreSQL is running. If not:
```bash
# Using Docker
docker run -d -p 5432:5432 -e POSTGRES_USER=matcha -e POSTGRES_PASSWORD=matcha -e POSTGRES_DB=matcha_ai postgres:15-alpine

# Or using Homebrew (macOS)
brew install postgresql@15
brew services start postgresql@15
createdb matcha_ai
```

### 3. Start Redis (Optional but Recommended)

```bash
# Using Docker
docker run -d -p 6379:6379 redis:7-alpine

# Or Homebrew
brew install redis
brew services start redis
```

### 4. Start the System

```bash
# Start both API and web
pnpm dev

# Or separately:
pnpm dev:api   # Terminal 1: API on http://localhost:4000
pnpm dev:web   # Terminal 2: Web on http://localhost:3000
```

### 5. Verify It Works

```bash
# Check API health
curl http://localhost:4000/health

# Check Prometheus metrics
curl http://localhost:4000/metrics/prom

# Open web UI
open http://localhost:3000
```

## 📊 Your API Keys (Already in .env)

- ✅ **OpenAI**: Configured
- ✅ **0x**: Configured  
- ✅ **CoinGecko**: `CG-Db59VQ8EmFTJqhHumKaXPyZR` (Demo account)

## 🎉 What You Can Do Now

1. **Create a Strategy** - Go to http://localhost:3000
2. **Run a Backtest** - Uses **REAL** CoinGecko data now!
3. **Paper Trade** - Live prices from Binance WebSocket
4. **Monitor** - Check `/metrics/prom` for system health

## 🐛 Troubleshooting

### "pnpm: command not found"
```bash
npm install -g pnpm
```

### "Database connection failed"
- Make sure PostgreSQL is running
- Check DATABASE_URL in .env
- Try: `psql -U matcha -d matcha_ai -c "SELECT 1;"`

### "Redis connection error"
- System will fall back to in-memory cache (still works!)
- To use Redis: `docker run -d -p 6379:6379 redis:7-alpine`

### "Port already in use"
- Change PORT_API or PORT_WEB in .env
- Or kill the process: `lsof -ti:4000 | xargs kill`

## 🎯 Test the Real Data

Once running, create a strategy and run a backtest. You'll see:
- ✅ Real historical prices from CoinGecko
- ✅ Advanced risk calculations (VaR, CVaR, Kelly)
- ✅ Prometheus metrics tracking everything

## 📝 Your .env File Location

The `.env` file is at:
```
/Users/alexaustin/Desktop/Matcha AI/.env
```

All your API keys are already configured! 🎉


