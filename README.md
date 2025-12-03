# Matcha AI

AI-driven crypto trading system powered by OpenAI and 0x Swap API.

## Overview

Matcha AI is a complete, production-ready trading system that uses:
- **OpenAI API** as the "brain" to reason about markets and generate trade decisions (throttled for efficiency)
- **0x Swap API** as the execution engine for EVM on-chain trades (Ethereum, Polygon, Arbitrum)
- **PostgreSQL** for data persistence
- **Next.js** for the web interface
- **Non-custodial design**: Frontend handles all transaction signing via MetaMask/WalletConnect

## Features

- ✅ **Backtest/Simulation Mode**: Test strategies on historical data with fast rule-based decisions
- ✅ **Paper Trading Mode**: Live prices, fake money, continuous AI learning
- ✅ **Live Trading Mode**: Real on-chain trades via 0x (EVM only - Ethereum, Polygon, Arbitrum)
- ✅ **Non-Custodial**: No private keys stored server-side - frontend signs all transactions
- ✅ **AI Training Loop**: Stores predictions, evaluates outcomes, continuously improves
- ✅ **Risk Management**: Unified risk checks across all modes (VaR, CVaR, Kelly, circuit breakers)
- ✅ **Stop Loss/Take Profit**: Automatic position management with trailing stops
- ✅ **Performance Analytics**: Equity curves, drawdown, Sharpe ratio, win rate
- ⚠️ **Solana**: Supported for simulation/paper only (live trading not yet implemented)

## Architecture

```
matcha-ai/
├── apps/
│   ├── api/          # Fastify API server
│   └── web/          # Next.js frontend
├── packages/
│   └── shared/       # Shared types and utilities
└── docker-compose.yml
```

### Tech Stack

- **Backend**: Node.js + TypeScript + Fastify
- **Frontend**: Next.js (App Router) + TypeScript + TailwindCSS
- **Database**: PostgreSQL + Prisma ORM
- **AI**: OpenAI API (GPT-4)
- **Execution**: 0x Swap API
- **Monorepo**: PNPM workspaces

## Quick Start

### Prerequisites

- Node.js 18+
- PNPM 8+
- PostgreSQL 15+ (or use Docker Compose)

### Installation

1. **Clone and install**

```bash
git clone <repo-url>
cd matcha-ai
pnpm install
```

2. **Set up environment variables**

Create a `.env` file in the root directory (see `.env.example`):

```bash
# Required
OPENAI_API_KEY=sk-proj-...
ZEROX_API_KEY=...
DATABASE_URL=postgresql://user:password@localhost:5432/matcha_ai?schema=public

# Optional (with defaults)
COINGECKO_API_KEY=...  # For historical data
PORT_API=4000
PORT_WEB=3000
```

3. **Set up the database**

```bash
# Generate Prisma client
pnpm db:generate

# Run migrations
pnpm db:migrate
```

4. **Start development servers**

```bash
# Start both API and web in parallel
pnpm dev

# Or start separately:
pnpm dev:api  # API on http://localhost:4000
pnpm dev:web  # Web on http://localhost:3000
```

5. **Create your first strategy**

Visit http://localhost:3000/strategies/new and create a strategy:
- Choose EVM chain (Ethereum, Polygon, or Arbitrum) for live trading
- Or choose Solana for simulation/paper only
- Set risk limits (max position %, daily loss %, stop loss, take profit)
- Run a backtest to verify profitability
- Start paper trading to let the AI learn
- Connect wallet and go live when ready!

## Architecture

```
matcha-ai/
├── apps/
│   ├── api/          # Fastify API server
│   └── web/          # Next.js frontend
├── packages/
│   └── shared/       # Shared types and utilities
└── docker-compose.yml
```

### Tech Stack

- **Backend**: Node.js + TypeScript + Fastify
- **Frontend**: Next.js (App Router) + TypeScript + TailwindCSS
- **Database**: PostgreSQL + Prisma ORM
- **AI**: OpenAI API (GPT-4) - Throttled for efficiency
- **Execution**: 0x Swap API (EVM chains only for live trading)
- **Monorepo**: PNPM workspaces

## Usage

### Creating a Strategy

1. Navigate to the web interface at `http://localhost:3000`
2. Click "New Strategy"
3. Fill in:
   - Name and description
   - Mode (Simulation, Paper, or Live)
   - Base asset (e.g., USDC)
   - Trading universe (tokens to trade)
   - Timeframe (1m, 5m, 1h, etc.)
   - Risk limits (max position %, max daily loss %)

### Running a Backtest

1. Go to your strategy detail page
2. Click "Run Backtest"
3. View results including:
   - Total return %
   - Equity curve
   - Trade history
   - Performance metrics (Sharpe, win rate, drawdown)

### Paper Trading

1. Create a strategy in "PAPER" mode
2. Click "Start Paper Trading"
3. The system will:
   - Use live price feeds
   - Execute simulated trades
   - Track performance
   - Log all trades to the database

### Live Trading (EVM Only)

**⚠️ Important**: Live trading is only available for EVM chains (Ethereum, Polygon, Arbitrum). Solana strategies can only run in SIMULATION or PAPER mode.

1. Create a strategy in "LIVE" mode on an EVM chain
2. Connect your wallet (MetaMask, WalletConnect, etc.) - **No private keys stored server-side**
3. Click "Start Live Trading"
4. When the AI suggests a trade:
   - Review the trade details in the UI
   - Sign the transaction with your wallet (frontend handles signing)
   - The trade executes on-chain via 0x Swap API
   - Transaction hash is recorded in the database

### Learning Loop

The AI learning loop runs daily (or can be triggered manually) and:
- Analyzes recent performance
- Suggests config improvements
- Never increases risk limits
- Requires human approval before applying changes

View suggestions at `/strategies/:id/config-suggestions` and accept/reject them.

## API Endpoints

### Strategies

- `POST /strategies` - Create strategy
- `GET /strategies` - List strategies
- `GET /strategies/:id` - Get strategy details
- `POST /strategies/:id/backtest` - Run backtest
- `POST /strategies/:id/paper/start` - Start paper trading
- `POST /strategies/:id/paper/stop` - Stop paper trading
- `POST /strategies/:id/live/start` - Start live trading
- `POST /strategies/:id/live/stop` - Stop live trading
- `GET /strategies/:id/trades` - Get trades
- `GET /strategies/:id/performance` - Get performance metrics

### Config Suggestions

- `GET /strategies/:id/config-suggestions` - List suggestions
- `POST /strategies/:id/config-suggestions/:suggestionId/accept` - Accept suggestion
- `POST /strategies/:id/config-suggestions/:suggestionId/reject` - Reject suggestion

### Health

- `GET /health` - Health check
- `GET /metrics` - System metrics

## Docker

### Development

```bash
docker-compose up
```

This starts:
- PostgreSQL on port 5432
- API on port 4000
- Web on port 3000

### Production

Build and run with Docker:

```bash
docker-compose -f docker-compose.yml build
docker-compose -f docker-compose.yml up -d
```

## Testing

```bash
# Run all tests
pnpm test

# Run API tests
pnpm test:api

# Run web tests
pnpm test:web
```

## Development

### Project Structure

```
apps/api/
├── src/
│   ├── config/        # Environment config, logger
│   ├── services/      # Business logic (backtester, trader, etc.)
│   ├── routes/        # API routes
│   ├── jobs/          # Background jobs (learning loop)
│   └── server.ts      # Fastify server
└── prisma/            # Prisma schema

apps/web/
├── src/
│   └── app/           # Next.js App Router pages
└── public/            # Static assets

packages/shared/
└── src/
    ├── types/         # Shared TypeScript types
    ├── config/        # Chain/token configs
    └── utils/         # Shared utilities
```

### Key Services

- **matchaBrain**: OpenAI integration for trading decisions
- **zeroExService**: 0x Swap API integration
- **backtester**: Historical backtesting engine
- **paperTrader**: Paper trading simulation
- **liveTrader**: Live trading orchestration
- **riskManager**: Risk limit enforcement
- **dataFeed**: Price data provider (mock in v1)
- **features**: Technical indicator calculations

## Security & Architecture Notes

### Non-Custodial Design
- ✅ **No private keys stored**: Wallets only store public addresses and configuration
- ✅ **Frontend signing**: All transactions are signed by user's wallet (MetaMask, WalletConnect, etc.)
- ✅ **Server builds, user signs**: API builds transaction data, frontend requests user signature
- ⚠️ **Never paste private keys**: The system is designed to never require or store private keys

### Chain Support
- ✅ **EVM Chains (Production)**: Ethereum, Polygon, Arbitrum - Full support for backtest, paper, and live trading
- ⚠️ **Solana (Experimental)**: Simulation and paper trading only. Live trading not yet implemented.

### Risk Management
- ✅ **Unified risk checks**: Same risk limits enforced across backtest, paper, and live modes
- ✅ **Daily loss limits**: Trading stops automatically if daily loss exceeds limit
- ✅ **Position size limits**: Maximum position percentage enforced
- ✅ **Stop Loss/Take Profit**: Automatic position management with trailing stops
- ✅ **VaR/CVaR**: Tail risk protection for portfolios
- ✅ **Circuit breakers**: Automatic trading halt on extreme losses

### AI Usage
- ✅ **Throttled**: LLM calls limited to max once per 5 minutes per strategy
- ✅ **Fast fallback**: Rule-based decisions when LLM unavailable or slow
- ✅ **Backtest optimization**: Defaults to fast mode (no LLM per candle)
- ✅ **Continuous learning**: AI stores predictions and learns from outcomes

### Data Sources
- ✅ **CoinGecko**: Historical price data
- ✅ **Binance**: Live price feeds via WebSocket
- ✅ **The Graph**: DEX volume and liquidity data
- ✅ **Caching**: Redis-backed caching for performance

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## Support

For issues and questions, please open a GitHub issue.

