# Quick Setup Guide

## Step 1: Install Dependencies

```bash
pnpm install
```

## Step 2: Set Up Environment Variables

Create a `.env` file in the root directory with your API keys:

```bash
# OpenAI API Key (get from https://platform.openai.com/api-keys)
OPENAI_API_KEY=your_openai_api_key_here

# 0x.org API Key (get from https://0x.org/docs/api)
ZEROX_API_KEY=your_0x_api_key_here

# Database (adjust if needed)
DATABASE_URL=postgresql://user:password@localhost:5432/matcha_ai?schema=public

# Data providers (new)
COINGECKO_API_KEY=your_coingecko_pro_key
COINGECKO_API_URL=https://pro-api.coingecko.com/api/v3
BINANCE_WS_URL=wss://stream.binance.com:9443/stream
BINANCE_REST_URL=https://api.binance.com
BINANCE_DEFAULT_QUOTE=USDT
CACHE_TTL_SECONDS=30
UNISWAP_V3_SUBGRAPH=https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3
REDIS_URL=redis://localhost:6379

# Observability
ENABLE_METRICS=true

# Environment
NODE_ENV=development

# Ports
PORT_API=4000
PORT_WEB=3000
```

## Step 3: Set Up Database

Make sure PostgreSQL is running, then:

```bash
# Generate Prisma client
pnpm db:generate

# Run migrations
pnpm db:migrate

# (Optional) Seed database
pnpm db:seed
```

## Step 4: Start Development Servers

```bash
# Start both API and web
pnpm dev

# Or start individually:
pnpm dev:api  # API on http://localhost:4000
pnpm dev:web  # Web on http://localhost:3000
```

## Step 5: Access the Application

- Web UI: http://localhost:3000
- API: http://localhost:4000
- API Health: http://localhost:4000/health

## Using Docker

Alternatively, use Docker Compose:

```bash
# Make sure .env file exists with API keys
docker-compose up
```

This will start:
- PostgreSQL on port 5432
- API on port 4000
- Web on port 3000

## Next Steps

1. Create your first strategy in the web UI
2. Run a backtest to see how it performs
3. Try paper trading with live prices
4. When ready, enable live trading (requires wallet connection)

## Troubleshooting

### Database Connection Issues

- Ensure PostgreSQL is running
- Check DATABASE_URL in .env matches your PostgreSQL setup
- Try: `psql -U postgres -c "CREATE DATABASE matcha_ai;"`

### API Key Issues

- Verify your OpenAI API key is valid
- Verify your 0x API key is valid
- Check that keys are correctly set in .env

### Port Already in Use

- Change PORT_API or PORT_WEB in .env
- Or stop the process using those ports
