# Decision Engine Overview

## Purpose

The unified Decision Engine (`apps/api/src/services/decisionEngine.ts`) provides a single, consistent entry point for trading decisions across all modes: **backtest**, **paper**, and **live** trading.

## Architecture

### Unified Entry Point

All trading modes now use `decisionEngine.decide()` which:
1. Always starts with a fast, rule-based decision (no AI required)
2. Optionally calls AI if configured and conditions are met
3. Combines fast and AI decisions intelligently
4. Enforces risk limits consistently

### Key Methods

#### `buildContext()`
Builds a consistent `MarketContext` across all modes:
- Recent candles (last 20)
- Computed indicators
- Open positions
- Performance metrics (PnL, win rate, Sharpe, max drawdown)
- Risk limits
- Current equity and daily PnL

#### `getFastDecision()`
Fast, rule-based decision engine that uses multiple technical indicators:

**Signals Used:**
1. **RSI (Relative Strength Index)**: Momentum and overbought/oversold conditions
   - Overbought (>75): Avoid longs
   - Oversold (<25): Avoid shorts
   - Confirms trend direction when in neutral range (30-70)

2. **EMA/SMA (Moving Averages)**: Trend direction and strength
   - EMA20 vs EMA50 (or SMA20 vs SMA50)
   - Bullish trend: short MA > long MA
   - Bearish trend: short MA < long MA
   - Trend strength: separation percentage

3. **MACD (Moving Average Convergence Divergence)**: Momentum confirmation
   - Bullish: MACD > Signal and Histogram > 0
   - Bearish: MACD < Signal and Histogram < 0

4. **Bollinger Bands**: Volatility and mean reversion
   - Near lower band (<30% position): Oversold, potential long
   - Near upper band (>70% position): Overbought, potential short

5. **ADX (Average Directional Index)**: Trend strength
   - ADX > 25: Strong trend (boost signals by 20%)
   - ADX < 20: Weak trend (reduce signals by 30%)

6. **Price Momentum**: Recent price action
   - 3-candle momentum calculation
   - Confirms trend direction

**Signal Strength Calculation:**
- Base trend signal: ±3 points
- RSI confirmation: ±1 to ±2 points
- MACD confirmation: ±2 points
- Bollinger position: ±1.5 points
- Price momentum: ±1 point
- ADX multiplier: 0.7x to 1.2x

**Confidence Mapping:**
- Signal strength ≥ 3: Long (confidence 0.4-0.85)
- Signal strength ≤ -3: Short (confidence 0.4-0.85)
- Signal strength < 3 and > -3: Flat (confidence 0.2)

**Performance Adjustment:**
- Win rate > 55% and >10 trades: Boost confidence by 15%
- Win rate < 45% and >10 trades: Reduce confidence by 15%

**Minimum Requirements:**
- At least 3 indicators must be present to take a trade
- Minimum confidence of 0.4 to take a trade (otherwise flat)

#### `decide()`
Unified decision entry point that:
1. Extracts indicators from candles
2. Gets fast decision first (always)
3. Checks if AI should be used based on:
   - AI mode (OFF/ASSIST/FULL)
   - Fast decision confidence threshold
   - Minimum trades required
4. Combines fast and AI decisions if AI is used
5. Returns final decision

#### `combineFastAndAI()`
Intelligently combines fast and AI decisions:
- Rejects AI ideas that violate risk limits
- If fast is flat and AI suggests action: Use AI with 20% confidence reduction
- If both suggest same action: Blend (70% fast, 30% AI)
- If actions conflict: Prefer fast if confidence similar, otherwise use AI with 20% size reduction

## Risk Limits Application

Risk limits are enforced via `RiskManager`:
- **Daily loss limit**: Checked before decision
- **Position size limit**: Enforced on final decision
- **Max drawdown**: Checked in context building
- **Circuit breakers**: Applied by RiskManager

## AI Integration

### Current State (Phase 1)
- AI hooks in via `matchaBrain.getDecision()` when called from `decide()`
- AI is optional and only used when:
  - AI mode is not 'OFF'
  - Fast decision confidence is below threshold (ASSIST mode)
  - Minimum trades requirement is met

### Future State (Phase 2)
- AI will be gated more intelligently
- Prompts will be shortened significantly
- AI will only be used for edge cases, not every decision

## Usage Across Modes

### Backtest Mode
```typescript
// Fast mode: AI is OFF
decision = await decisionEngine.decide(context, strategyConfig, {
  aiMode: 'OFF',
  strategyId,
});

// Normal mode: Uses AI config from strategy
decision = await decisionEngine.decide(context, strategyConfig, {
  aiMode: strategyConfig.ai?.mode || 'ASSIST',
  strategyId,
  historicalDecisions,
});
```

### Paper Trading Mode
```typescript
// Uses AI config from strategy (defaults to ASSIST)
decision = await decisionEngine.decide(context, config, {
  aiMode: config.ai?.mode || 'ASSIST',
  strategyId,
  historicalDecisions,
});
```

### Live Trading Mode
```typescript
// Uses AI config from strategy (defaults to ASSIST)
decision = await decisionEngine.decide(context, strategyConfig, {
  aiMode: strategyConfig.ai?.mode || 'ASSIST',
  strategyId,
  historicalDecisions,
});
```

## Benefits

1. **Consistency**: Same logic across all modes
2. **Maintainability**: Single source of truth for decision logic
3. **Performance**: Fast decisions are always available (no AI required)
4. **Flexibility**: AI can be enabled/disabled per strategy
5. **Cost Reduction**: AI only used when needed (Phase 2)

## Future Enhancements (Phase 3)

- Regime detection (trending vs ranging vs choppy)
- Regime-based decision rules
- Parameter optimization via backtesting
- More sophisticated signal combinations

