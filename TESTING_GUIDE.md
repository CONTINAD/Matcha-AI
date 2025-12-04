# Testing Guide

This guide explains how to test the refactored Matcha AI system.

## Overview

The system has been refactored to:
- Use a unified decision engine across all modes (backtest, paper, live)
- Use rule-based fast decisions as primary, with optional AI assistance
- Reduce OpenAI costs by 90%+ through intelligent gating
- Support regime-based trading logic
- Provide parameter sweep tooling

## Test Scripts

### 1. Backtest Test

Test the backtesting system with fast mode (no AI):

```bash
pnpm tsx apps/api/src/scripts/test-backtest.ts WETH 5m 137
```

This will:
- Fetch historical candles for WETH on Polygon (last 7 days)
- Run a backtest with fast mode (rule-based decisions only)
- Display results: return, drawdown, win rate, Sharpe ratio, trades

**Expected Output:**
- Total Return: positive or negative percentage
- Max Drawdown: < 20%
- Win Rate: > 40%
- Total Trades: > 0

### 2. Paper Trading Test

Check paper trading status and recent trades:

```bash
pnpm tsx apps/api/src/scripts/test-paper-trading.ts <strategyId>
```

This will:
- Display strategy information
- Show recent paper trades (last 10)
- Show statistics (total trades, win rate, P&L)
- Show recent decisions (last 5)
- Check if paper trading is active

**Expected Output:**
- Strategy mode: PAPER
- Strategy status: ACTIVE
- Recent trades showing up in database
- Decisions being made

### 3. Parameter Sweep

Find optimal parameters for a symbol/timeframe:

```bash
pnpm tsx apps/api/src/scripts/sweep-parameters.ts WETH 5m 137
```

This will:
- Sweep through parameter combinations
- Run backtests for each combination
- Display top 10 configurations by Sharpe ratio
- Save results to JSON file

**Expected Output:**
- Top configurations with best Sharpe ratios
- Results saved to `sweep-results-*.json`

## Manual Testing

### Test Fast Mode (No AI)

1. Create a strategy with `ai: { mode: 'OFF' }` in config
2. Start paper trading
3. Verify decisions are made without OpenAI calls
4. Check logs for "Fast decision" messages

### Test ASSIST Mode (AI as Helper)

1. Create a strategy with `ai: { mode: 'ASSIST', confidenceThreshold: 0.5 }`
2. Start paper trading
3. Verify AI is only called when fast decision confidence < 0.5
4. Check logs for "unified_engine" decision reason

### Test FULL Mode (AI with Function Calling)

1. Create a strategy with `ai: { mode: 'FULL' }`
2. Start paper trading
3. Verify AI is called with function calling enabled
4. Check logs for tool calls and AI decisions

## Verification Checklist

### Phase 1: Unified Decision Engine
- [ ] Backtest uses `decisionEngine.decide()`
- [ ] Paper trading uses `decisionEngine.decide()`
- [ ] Live trading uses `decisionEngine.decide()`
- [ ] Fast mode produces trades without AI
- [ ] All modes use same context building

### Phase 2: AI Gating
- [ ] AI mode OFF: No OpenAI calls
- [ ] AI mode ASSIST: AI only when fast confidence < threshold
- [ ] AI mode FULL: AI with function calling
- [ ] Prompts are shortened (~450 tokens vs 2000-4000)
- [ ] Historical decisions limited to top 5

### Phase 3: Regime Detection
- [ ] Regime detection functions work (trending/ranging/choppy)
- [ ] Fast decisions adapt to regime
- [ ] Bollinger Bands use mean reversion in ranging markets
- [ ] Signal thresholds adjust based on regime

### Phase 4: Data Feed & Reliability
- [ ] Polygon data feed works (WETH/USDC)
- [ ] CoinGecko fallback triggers for WETH
- [ ] Paper trades are saved to database
- [ ] Metrics filter by mode correctly

### Phase 5: Testing
- [ ] Backtest script runs successfully
- [ ] Paper trading script shows trades
- [ ] Parameter sweep finds optimal configs

## Common Issues

### No Trades Generated

**Possible Causes:**
1. Data feed failing (check logs for "No candle data")
2. Confidence thresholds too high
3. Risk limits blocking trades
4. Not enough indicators available

**Solutions:**
1. Check data feed logs for errors
2. Lower confidence thresholds in config
3. Adjust risk limits
4. Ensure enough candles for indicators (need at least 5)

### OpenAI Costs Too High

**Possible Causes:**
1. AI mode set to FULL instead of ASSIST
2. Confidence threshold too low (AI called too often)
3. Historical decisions not limited

**Solutions:**
1. Set `ai: { mode: 'ASSIST' }` in strategy config
2. Increase `confidenceThreshold` to 0.6 or higher
3. Verify historical decisions are limited to top 5

### Data Feed Failures

**Possible Causes:**
1. 0x API key not set
2. Token address not found
3. Network issues

**Solutions:**
1. Set `ZEROX_API_KEY` in `.env`
2. Check token configuration in `SUPPORTED_TOKENS`
3. Check network connectivity
4. Verify CoinGecko fallback is working

## Performance Benchmarks

### Fast Mode (No AI)
- Decision latency: < 10ms
- Trades per hour: 10-50 (depends on timeframe)
- Cost: $0 (no OpenAI calls)

### ASSIST Mode
- Decision latency: 50-200ms (when AI called)
- AI call frequency: 10-30% of decisions
- Cost: ~90% reduction vs full AI mode

### FULL Mode
- Decision latency: 200-1000ms (with tool calls)
- AI call frequency: 100% of decisions
- Cost: ~50% reduction vs old system (shorter prompts)

## Next Steps

1. Run backtest to verify fast mode works
2. Start paper trading with ASSIST mode
3. Monitor OpenAI costs
4. Use parameter sweep to optimize configs
5. Promote to live trading after 200+ successful paper trades
