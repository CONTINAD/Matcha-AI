# Database Protection & Learning System

## ✅ Protection for Real Trading Data

### Never Deleted:
- **LIVE trades** - Real on-chain transactions (protected)
- **PAPER trades** - Simulated but valuable for learning (protected)
- **BACKTEST trades** - If ≥10 trades, protected for learning
- **Active strategies** - Never deleted regardless of performance
- **Predictions** - All AI predictions are kept for learning
- **Trade Analytics** - Execution quality data is preserved

### Cleanup Rules:
The cleanup script (`cleanup-test-strategies.ts`) now:
1. **Protects** all strategies with LIVE or PAPER trades
2. **Protects** all ACTIVE strategies
3. **Protects** strategies with ≥10 BACKTEST trades (learning data)
4. **Only deletes** test strategies with:
   - No real trading data (only BACKTEST)
   - Poor performance AND named as "test"
   - No trades AND old (>30 days) AND named as "test"

## 🧠 Enhanced Learning System

### Database Schema Improvements:

#### Trade Model - New Fields:
- `marketContextAtEntry` - JSON: indicators, price, volatility at trade entry
- `marketContextAtExit` - JSON: indicators, price, volatility at trade exit
- `predictionId` - Links trade to the Prediction that generated it

#### Prediction Model:
- Stores all AI predictions before trades
- Links to trades via `tradeId`
- Stores market context, indicators, and reasoning
- Evaluated after trades complete with learning notes

### Learning Flow:

1. **Before Trade:**
   - AI makes prediction → stored in `Prediction` table
   - Market context captured (indicators, volatility, price action)
   - Prediction ID returned

2. **During Trade:**
   - Trade created with `predictionId` link
   - `marketContextAtEntry` stored (indicators, decision, confidence)

3. **After Trade:**
   - Trade outcome evaluated
   - Prediction updated with outcome, PnL, learning notes
   - `marketContextAtExit` stored (if available)

4. **Learning:**
   - `predictionTrainer.getHistoricalDecisions()` reads from database
   - `reinforcementLearning.analyzePatterns()` analyzes all trades
   - `learningLoop` processes strategies and suggests improvements
   - AI uses historical data to improve future decisions

### How OpenAI Learns:

1. **Pattern Recognition:**
   - Analyzes winning vs losing trades
   - Identifies market conditions that led to success/failure
   - Learns which indicators are most predictive

2. **Confidence Adjustment:**
   - Reduces confidence in conditions that led to losses
   - Increases confidence in conditions that led to wins
   - Avoids repeating past mistakes

3. **Decision Improvement:**
   - Uses `getHistoricalDecisions()` to see past outcomes
   - Adjusts decisions based on similar past situations
   - Learns from both correct and incorrect predictions

4. **Config Suggestions:**
   - After 20+ trades, analyzes performance
   - Suggests parameter tweaks (stop loss, position size, etc.)
   - Never increases risk limits (safety first)

## 📊 Data Retention

### All Data Preserved:
- ✅ All LIVE trades (forever)
- ✅ All PAPER trades (forever)
- ✅ All BACKTEST trades with ≥10 trades (forever)
- ✅ All Predictions (forever)
- ✅ All Trade Analytics (forever)
- ✅ All Performance Snapshots (forever)

### Only Deleted:
- ❌ Test strategies with no real data
- ❌ Test strategies with only BACKTEST trades (<10) and poor performance
- ❌ Old inactive test strategies (>30 days, no trades)

## 🔄 Learning Loop Schedule

- **Daily**: Learning loop runs automatically
- **After each trade**: Prediction evaluated and stored
- **After 20+ trades**: Config suggestions generated
- **Continuous**: AI uses historical data for every decision

## 🛡️ Safety Features

1. **No Data Loss**: Real trading data is never deleted
2. **Learning Preserved**: All predictions and outcomes kept
3. **Pattern Analysis**: System learns from all historical trades
4. **Adaptive AI**: Gets smarter over time using database data
5. **Safe Cleanup**: Only removes truly test/inactive strategies

