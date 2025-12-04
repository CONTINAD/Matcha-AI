# Step-by-Step Guide: Setting Up Low-Balance Trading Strategy

## Option 1: Using the Script (Easiest)

### Step 1: Make sure the API server dependencies are installed
```bash
cd apps/api
pnpm install
```

### Step 2: Make sure your database is set up
```bash
# Set DATABASE_URL in .env if not already set
# Then generate Prisma client
pnpm db:generate
```

### Step 3: Run the strategy creation script
```bash
cd apps/api
tsx src/scripts/create-low-balance-strategy.ts
```

This will:
- Create a strategy optimized for low-balance trading on Polygon
- Set it to PAPER mode (safe testing)
- Start paper trading automatically
- Print the strategy ID

### Step 4: Verify it's running
```bash
# Check if paper trading is active (replace STRATEGY_ID with the ID from step 3)
curl http://localhost:4000/strategies/STRATEGY_ID
```

---

## Option 2: Using the API Directly

### Step 1: Start the API server (if not running)
```bash
cd apps/api
pnpm dev
```

### Step 2: Create the strategy via POST request
```bash
curl -X POST http://localhost:4000/strategies \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Polygon Low-Balance USDC/WETH",
    "description": "Optimized for low balance trading on Polygon. Trades WETH/USDC with small position sizes (5% max) and conservative risk limits.",
    "mode": "PAPER",
    "baseAsset": "USDC",
    "universe": ["WETH"],
    "timeframe": "5m",
    "chainId": 137,
    "maxPositionPct": 5,
    "maxDailyLossPct": 3,
    "stopLossPct": 2,
    "takeProfitPct": 4,
    "trailingStopPct": 1.5
  }'
```

**Save the `id` from the response!**

### Step 3: Start paper trading
```bash
# Replace STRATEGY_ID with the id from step 2
curl -X POST http://localhost:4000/strategies/STRATEGY_ID/paper/start
```

### Step 4: Verify it's working
```bash
# Check strategy status
curl http://localhost:4000/strategies/STRATEGY_ID

# Check if trades are being generated (may take a few minutes)
curl http://localhost:4000/strategies/STRATEGY_ID
```

---

## Option 3: Using the Web UI

### Step 1: Start both API and Web servers
```bash
# Terminal 1: API server
cd apps/api
pnpm dev

# Terminal 2: Web server
cd apps/web
pnpm dev
```

### Step 2: Open the web app
Navigate to `http://localhost:3000`

### Step 3: Create strategy
1. Click "New Strategy"
2. Fill in:
   - **Name**: Polygon Low-Balance USDC/WETH
   - **Mode**: PAPER
   - **Base Asset**: USDC
   - **Universe**: WETH (type and select)
   - **Timeframe**: 5m
   - **Chain**: Polygon (137)
   - **Max Position %**: 5
   - **Max Daily Loss %**: 3
   - **Stop Loss %**: 2
   - **Take Profit %**: 4
3. Click "Create Strategy"

### Step 4: Start paper trading
1. Go to the strategy detail page
2. Click "Start Paper Trading"

---

## Why This Setup is Good for Low Balance

✅ **Polygon Chain (137)**
- Gas fees: ~$0.001-0.01 per trade (vs $5-50 on Ethereum)
- Fast transactions
- Good liquidity

✅ **USDC/WETH Pair**
- High liquidity = low slippage
- Stable base (USDC) reduces volatility risk
- WETH is highly liquid on Polygon

✅ **Small Position Sizes (5%)**
- Can trade with small balances
- Limits risk per trade
- Allows for multiple positions

✅ **Conservative Risk Limits**
- 3% max daily loss protects capital
- 2% stop loss per trade
- 4% take profit (2:1 risk/reward ratio)

✅ **5-Minute Timeframe**
- Good balance of signal frequency
- Not too frequent (saves on gas)
- Not too slow (captures opportunities)

---

## Monitoring Your Strategy

### Check Strategy Status
```bash
curl http://localhost:4000/strategies/STRATEGY_ID
```

### View Analytics
```bash
curl http://localhost:4000/analytics/strategy/STRATEGY_ID
```

### View Recent Trades
```bash
curl http://localhost:4000/strategies/STRATEGY_ID
# Trades are included in the response
```

### Check Performance Metrics
```bash
curl http://localhost:4000/analytics/performance
```

---

## Troubleshooting

### Strategy not creating trades?
- Wait 5-10 minutes (paper trader checks every few minutes)
- Check API logs for errors
- Verify strategy status is "ACTIVE"
- Check that paper trading is started

### Database errors?
- Make sure `DATABASE_URL` is set in `apps/api/.env`
- Run `pnpm db:generate` to regenerate Prisma client
- Check database connection

### API not responding?
- Make sure API server is running (`pnpm dev` in `apps/api`)
- Check port 4000 is available
- Check logs for errors

---

## Next Steps After Setup

1. **Monitor for 24 hours** - Let it run and generate some trades
2. **Review analytics** - Check performance metrics
3. **Adjust if needed** - Modify risk limits based on results
4. **Switch to LIVE mode** (when ready) - Change mode to "LIVE" and connect wallet

---

## Quick Reference: Strategy Configuration

```json
{
  "name": "Polygon Low-Balance USDC/WETH",
  "mode": "PAPER",
  "baseAsset": "USDC",
  "universe": ["WETH"],
  "timeframe": "5m",
  "chainId": 137,
  "maxPositionPct": 5,
  "maxDailyLossPct": 3,
  "stopLossPct": 2,
  "takeProfitPct": 4,
  "trailingStopPct": 1.5
}
```

