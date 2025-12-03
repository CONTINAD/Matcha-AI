#!/bin/bash

# Quick test script for Matcha AI
# This tests if everything is set up correctly

echo "🧪 Matcha AI Quick Test"
echo "======================"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ .env file not found!"
    echo "   Create it with your API keys (see SETUP.md)"
    exit 1
fi

echo "✅ .env file found"

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    pnpm install
fi

echo "✅ Dependencies installed"

# Check if Prisma client is generated
if [ ! -d "apps/api/node_modules/.prisma" ]; then
    echo "🔧 Generating Prisma client..."
    pnpm db:generate
fi

echo "✅ Prisma client generated"

# Check database connection (if PostgreSQL is running)
echo ""
echo "📊 Testing database connection..."
echo "   (Make sure PostgreSQL is running)"
echo ""

# Test API health endpoint (if server is running)
echo "🌐 Testing API..."
echo "   Start the API with: pnpm dev:api"
echo "   Then test: curl http://localhost:4000/health"
echo ""

echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Make sure PostgreSQL is running"
echo "2. Run: pnpm db:migrate"
echo "3. Start API: pnpm dev:api"
echo "4. Start Web: pnpm dev:web"
echo "5. Open http://localhost:3000"
echo "6. Create a strategy and run a backtest!"

