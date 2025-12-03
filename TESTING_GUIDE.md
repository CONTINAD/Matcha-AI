# Testing Guide - How to Actually Test This Thing

## What Does It Actually Do?

**Matcha AI is an AI trading bot that:**
1. **Looks at market data** (price candles, indicators like RSI, moving averages)
2. **Asks GPT-4 what to do** ("Should I buy, sell, or hold?")
3. **Enforces safety rules** (never risk more than you set)
4. **Executes trades** (simulated for testing, real for live)
5. **Learns over time** (suggests better settings based on performance)

## How Smart Is It?

**The AI (GPT-4) is actually pretty smart:**
- ✅ It sees market patterns (RSI, trends, volatility)
- ✅ It considers your current positions
- ✅ It respects risk limits (won't go crazy)
- ✅ It learns from past performance
- ❌ BUT: It's using **mock data** right now (not real prices)
- ❌ AND: It's not a magic money printer - trading is risky

**The intelligence comes from:**
- GPT-4 analyzing market context
- Technical indicators (RSI, EMA, volatility)
- Performance history
- Risk management rules

## Quick Test (5 Minutes)

### Step 1: Install & Setup

```bash
# Install dependencies
pnpm install

# Create .env file (copy from SETUP.md with your API keys)
# Then setup database
pnpm db:generate
pnpm db:migrate
```

### Step 2: Start the Servers

```bash
# Terminal 1: Start API
pnpm dev:api

# Terminal 2: Start Web
pnpm dev:web
```

### Step 3: Test the Backtest (Easiest Test)

1. Open http://localhost:3000
2. Click "New Strategy"
3. Fill in:
   - Name: "Test Strategy"
   - Mode: Simulation
   - Base Asset: USDC
   - Select tokens: USDC, WETH
   - Timeframe: 1h
   - Max Position: 10%
   - Max Daily Loss: 5%
4. Click "Create Strategy"
5. Click "Run Backtest"
6. **Watch it work!** It will:
   - Generate fake price data
   - Ask GPT-4 for decisions
   - Simulate trades
   - Show you results

### Step 4: Check What Happened

```bash
# See the trades in database
pnpm db:studio
# Opens Prisma Studio - browse the Trade table
```

Or check the API directly:
```bash
# Get the strategy ID from the URL, then:
curl http://localhost:4000/strategies/YOUR_STRATEGY_ID/trades
```

## Real Test Scenarios

### Test 1: Does the AI Actually Make Decisions?

**What to check:**
- Look at the backtest results
- Check the `notes` field in decisions (if logged)
- See if it made different decisions at different times

**How to verify:**
```bash
# Check API logs - you'll see OpenAI API calls
# Each decision should have different confidence/action
```

### Test 2: Does Risk Management Work?

**Create a strategy with tight limits:**
- Max Position: 5%
- Max Daily Loss: 2%

**Then:**
1. Run backtest
2. Check that no position exceeded 5% of equity
3. Verify it stops trading if daily loss hits 2%

### Test 3: Does the Learning Loop Work?

**Steps:**
1. Create a strategy
2. Run multiple backtests (or paper trade for a while)
3. Manually trigger learning loop:
   ```bash
   # In API code, you'd call:
   # learningLoop.triggerForStrategy(strategyId)
   ```
4. Check config suggestions:
   ```bash
   curl http://localhost:4000/strategies/YOUR_ID/config-suggestions
   ```

### Test 4: Paper Trading (Live Simulation)

1. Create strategy in "PAPER" mode
2. Click "Start Paper Trading"
3. **Watch the logs** - you'll see:
   - Price updates
   - AI decisions
   - Simulated trades
4. Let it run for a few minutes
5. Check the trades table

## What to Look For

### ✅ Good Signs:
- AI makes different decisions based on market conditions
- Risk limits are respected
- Trades are logged correctly
- Performance metrics make sense
- Config suggestions appear after enough trades

### ❌ Red Flags:
- AI always makes the same decision
- Risk limits are violated
- No trades happening (might be too conservative)
- Errors in logs

## Testing the "Smart" Part

### Test the AI Decision Quality:

1. **Create two identical strategies** with different risk limits
2. **Run backtests on both**
3. **Compare results** - the AI should adapt to different risk profiles

### Test the Learning:

1. **Run a backtest with poor settings** (e.g., too aggressive)
2. **Let it generate suggestions**
3. **Check if suggestions make sense** (should suggest being more conservative if losing)

## API Testing (Direct)

### Test the AI Brain Directly:

```bash
# Create a test script: test-ai.js
const { matchaBrain } = require('./apps/api/src/services/matchaBrain');

const context = {
  recentCandles: [
    { open: 100, high: 105, low: 95, close: 102, volume: 1000, timestamp: Date.now() }
  ],
  indicators: { rsi: 45, emaFast: 100, emaSlow: 98 },
  openPositions: [],
  performance: { realizedPnl: 0, maxDrawdown: 0, winRate: 0.5 },
  riskLimits: { maxPositionPct: 10, maxDailyLossPct: 5 },
  currentEquity: 10000,
  dailyPnl: 0
};

matchaBrain.getDecision(context, {
  baseAsset: 'USDC',
  universe: ['WETH'],
  timeframe: '1h',
  riskLimits: { maxPositionPct: 10, maxDailyLossPct: 5 }
}).then(decision => {
  console.log('AI Decision:', decision);
});
```

## Common Issues

### "No trades happening"
- AI might be too conservative
- Check confidence threshold (needs >= 0.6)
- Try different market conditions

### "AI always says 'flat'"
- Market might look too risky
- Check if daily loss limit is hit
- Try adjusting risk limits

### "Errors in logs"
- Check API keys are set correctly
- Verify database is running
- Check OpenAI API quota

## Is It Actually Smart?

**Short answer: Yes, but with caveats:**

✅ **Smart parts:**
- GPT-4 is genuinely intelligent
- It can see patterns humans might miss
- It adapts to different market conditions
- It learns from mistakes

⚠️ **Limitations:**
- Using mock data (not real market prices)
- Can't predict the future (nobody can)
- Trading is inherently risky
- Past performance ≠ future results

**The real test:** Run it on paper trading with real prices for a few weeks and see if it makes money.

## Next Steps After Testing

1. **If it works:** Integrate real price data (CoinGecko API, etc.)
2. **If decisions are bad:** Tune the prompts in `matchaBrain.ts`
3. **If it's too conservative:** Adjust confidence thresholds
4. **If it's too aggressive:** Tighten risk limits

## Pro Tips

- **Start with backtests** - fastest way to see if it works
- **Check the logs** - see what the AI is actually thinking
- **Use Prisma Studio** - easiest way to browse the database
- **Test with small limits first** - don't go crazy on first test
- **Compare strategies** - create multiple and see which performs better

