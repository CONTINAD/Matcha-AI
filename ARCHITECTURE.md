# Matcha AI Architecture

## System Overview

Matcha AI is a monorepo-based trading system with three main components:

1. **API Server** (`apps/api`) - Fastify-based backend
2. **Web Frontend** (`apps/web`) - Next.js dashboard
3. **Shared Package** (`packages/shared`) - Common types and utilities

## Data Flow

### Backtest Flow

```
User Request → API Route → Backtester
                                    ↓
                            DataFeed (historical candles)
                                    ↓
                            Features (indicators)
                                    ↓
                            MatchaBrain (AI decision)
                                    ↓
                            RiskManager (validation)
                                    ↓
                            Trade Execution (simulated)
                                    ↓
                            Results → Database
```

### Paper Trading Flow

```
Timer → PaperTrader
            ↓
    DataFeed (latest candle)
            ↓
    Features (indicators)
            ↓
    MatchaBrain (AI decision)
            ↓
    RiskManager (validation)
            ↓
    Simulated Trade → Database
```

### Live Trading Flow

```
Timer → LiveTrader
            ↓
    DataFeed (latest candle)
            ↓
    Features (indicators)
            ↓
    MatchaBrain (AI decision)
            ↓
    RiskManager (validation)
            ↓
    ZeroXService (build swap tx)
            ↓
    Pending Trade → Frontend
            ↓
    User Signs → Blockchain
            ↓
    Trade Recorded → Database
```

## Key Services

### MatchaBrain (`apps/api/src/services/matchaBrain.ts`)

- **Purpose**: AI decision-making using OpenAI
- **Input**: MarketContext, StrategyConfig
- **Output**: Decision (action, confidence, targetPositionSizePct, notes)
- **Features**:
  - Enforces risk limits
  - Prevents over-trading
  - Returns structured JSON decisions

### ZeroXService (`apps/api/src/services/zeroExService.ts`)

- **Purpose**: Integration with 0x Swap API
- **Methods**:
  - `getQuote()` - Get swap quote
  - `buildSwapTx()` - Build transaction for wallet signing
- **Handles**: Error handling, timeouts, chain-specific endpoints

### Backtester (`apps/api/src/services/backtester.ts`)

- **Purpose**: Historical backtesting engine
- **Features**:
  - Loops through historical candles
  - Applies fees and slippage
  - Tracks equity curve
  - Calculates performance metrics
  - Persists trades to database

### RiskManager (`apps/api/src/services/riskManager.ts`)

- **Purpose**: Enforce risk limits
- **Checks**:
  - Position size limits
  - Daily loss limits
  - Total exposure limits
  - Leverage limits (if configured)

### DataFeed (`apps/api/src/services/dataFeed.ts`)

- **Purpose**: Price data provider
- **Current**: Mock implementation (generates synthetic data)
- **Future**: Integrate with real providers (CoinGecko, Binance, etc.)

### Features (`apps/api/src/services/features.ts`)

- **Purpose**: Technical indicator calculations
- **Indicators**:
  - RSI (Relative Strength Index)
  - EMA (Exponential Moving Average)
  - SMA (Simple Moving Average)
  - ATR (Average True Range)
  - Volatility (standard deviation)

## Learning Loop

The learning loop (`apps/api/src/jobs/learningLoop.ts`) runs daily and:

1. Fetches all active strategies
2. Gathers recent trades and performance
3. Calls `matchaBrain.getConfigSuggestions()`
4. Stores suggestions in database (status: PENDING)
5. Requires human approval before applying

**Safety**: Never auto-increases risk limits. All suggestions require manual review.

## Database Schema

### User
- Basic user information
- One-to-many with Strategy

### Strategy
- Configuration (mode, baseAsset, universe, timeframe)
- Status (ACTIVE, PAUSED)
- Config JSON (risk limits, indicators, thresholds)

### Trade
- Trade execution details
- PnL, fees, slippage
- Links to Strategy

### PerformanceSnapshot
- Equity curve points
- Metrics (Sharpe, drawdown, win rate)
- Timestamped snapshots

### ConfigSuggestion
- AI-generated config suggestions
- Status (PENDING, ACCEPTED, REJECTED)
- Reasoning from AI

## API Routes

### Strategies
- CRUD operations
- Backtest execution
- Paper/Live trading control
- Trade and performance queries

### Config Suggestions
- List suggestions
- Accept/Reject suggestions

### Health
- Health check endpoint
- Metrics endpoint

## Frontend

### Pages
- `/` - Dashboard (list strategies)
- `/strategies/new` - Create strategy
- `/strategies/[id]` - Strategy detail
- `/strategies/[id]/performance` - Performance charts

### Features
- Strategy creation form
- Backtest trigger
- Paper trading controls
- Live trading (wallet integration - coming soon)
- Performance visualization

## Security Considerations

1. **API Keys**: Stored in environment variables, never committed
2. **Non-Custodial**: User signs all transactions, system never holds funds
3. **Risk Limits**: Enforced at multiple layers (AI, RiskManager, database)
4. **Input Validation**: All API inputs validated
5. **Error Handling**: Comprehensive error handling and logging

## Deployment

### Development
- Local PostgreSQL
- `pnpm dev` for hot reload

### Production
- Docker Compose for orchestration
- Separate containers for API, Web, Database
- Environment variables from `.env` or secrets manager

## Future Enhancements

1. **Real Data Feed**: Integrate with CoinGecko, Binance, etc.
2. **Advanced Indicators**: More technical indicators
3. **Multi-Chain**: Support more chains beyond Ethereum, Polygon, Arbitrum
4. **Portfolio Management**: Multiple strategies, portfolio-level risk
5. **Advanced Analytics**: More sophisticated performance metrics
6. **Notifications**: Alerts for trades, suggestions, errors
7. **Backtesting Improvements**: Walk-forward analysis, Monte Carlo simulation

