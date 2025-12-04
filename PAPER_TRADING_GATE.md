# Paper Trading Gate System

## 🎯 Requirements for Live Trading

### 200+ Paper Trades Required
Before a strategy can be enabled for live trading, it must:
1. **Generate at least 200 paper trades**
2. **Maintain recent success** - Last 50 closed trades must have:
   - Win rate ≥ 50%
   - Positive total P&L

### Why 200 Trades?
- **Statistical Significance**: 200 trades provides enough data to evaluate strategy performance
- **Market Cycles**: Captures different market conditions (trending, ranging, volatile)
- **Learning Data**: Gives the AI enough historical data to learn patterns
- **Risk Reduction**: Proves the strategy works across various market conditions

## 📊 Paper Trading Configuration

### Aggressive Settings for Paper Trading
To generate trades faster and reach 200 trades:
- **Confidence Threshold**: Lowered to 0.4 (vs 0.6 for live)
- **Fast Decision Fallback**: Uses rule-based decisions when AI confidence is low
- **Confidence Boosting**: Boosts low-confidence decisions to 0.5 for paper trading
- **More Frequent Checks**: Checks every 10 seconds for new market data

### Normal Settings for Live Trading
Once 200+ paper trades are achieved:
- **Confidence Threshold**: 0.6 (higher quality signals)
- **Stricter Risk Management**: More conservative position sizing
- **AI-Only Decisions**: Relies more on AI decisions vs rule-based fallbacks

## 🔄 How It Works

### Paper Trading Phase
1. Strategy starts in PAPER mode
2. Generates trades with lower confidence thresholds
3. All trades recorded in database
4. Performance tracked continuously

### Gate Check
When attempting to start live trading:
1. Counts all PAPER trades
2. Checks if ≥ 200 trades exist
3. Evaluates last 50 closed trades:
   - Win rate must be ≥ 50%
   - Total P&L must be positive
4. If checks pass → Live trading enabled
5. If checks fail → Error message with current stats

### Live Trading Phase
Once gate is passed:
1. Strategy mode changes to LIVE
2. Requires wallet connection
3. Uses stricter confidence thresholds
4. Real on-chain transactions
5. All trades tracked with transaction hashes

## 🛡️ Safety Features

### Multiple Checkpoints
- **Before Activation**: Checks paper trade count
- **Before Starting**: Re-checks paper trade count and recent performance
- **During Trading**: Continuous risk management and position limits

### Performance Monitoring
- Recent win rate tracked
- Recent P&L tracked
- Strategy can be paused if performance degrades

## 📈 Progress Tracking

### Current Status
Check paper trade count:
```bash
curl http://localhost:4000/strategies/{strategyId}
# Look for trades array length
```

### Progress to 200
- **Current**: Check via API or dashboard
- **Remaining**: 200 - current count
- **Estimated Time**: Depends on market conditions and timeframe
  - 5-minute timeframe: ~1-2 trades per hour = ~100-200 hours
  - 1-hour timeframe: ~1-2 trades per day = ~100-200 days

## 🚀 Quick Start

1. **Create Strategy** in PAPER mode
2. **Start Paper Trading** - Let it run and generate trades
3. **Monitor Progress** - Check trade count regularly
4. **Wait for 200+ Trades** - Be patient, quality over speed
5. **Check Recent Performance** - Ensure last 50 trades are profitable
6. **Connect Wallet** - When ready, connect Polygon wallet
7. **Start Live Trading** - System will verify 200+ trades before enabling

## ⚠️ Important Notes

- **Paper trades are simulated** - No real money at risk
- **200 trades is a minimum** - More is better for learning
- **Recent performance matters** - Even with 200+ trades, recent performance must be good
- **Can always pause** - Stop paper trading anytime
- **Data is preserved** - All paper trades saved for learning

