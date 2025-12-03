#!/usr/bin/env tsx

/**
 * Check trading status and debug why trades aren't happening
 */

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config();

import { PrismaClient } from '@prisma/client';
import { dataFeed } from '../services/dataFeed';
import { logger } from '../config/logger';

const prisma = new PrismaClient();

async function checkTradingStatus() {
  const strategyId = process.argv[2] || 'cmipj8tot0001einx91b2ugsd';
  
  console.log(`\n🔍 Checking Trading Status for Strategy: ${strategyId}\n`);

  try {
    const strategy = await prisma.strategy.findUnique({
      where: { id: strategyId },
    });

    if (!strategy) {
      console.log('❌ Strategy not found');
      return;
    }

    console.log(`✅ Strategy found: ${strategy.name}`);
    console.log(`   Status: ${strategy.status}`);
    console.log(`   Chain: ${strategy.chainId}`);
    console.log(`   Timeframe: ${strategy.timeframe}\n`);

    const config = JSON.parse(strategy.configJson);
    const symbol = config.universe[0] || 'SOL';
    
    console.log(`📊 Checking market data for: ${symbol}`);
    
    // Check if we can get candle data
    const snapshot = await dataFeed.getLatestMarketSnapshot(
      symbol,
      strategy.timeframe,
      strategy.chainId
    );
    
    if (!snapshot || !snapshot.candle) {
      console.log('❌ NO CANDLE DATA AVAILABLE - This is the problem!');
      console.log('   The strategy cannot trade without candle data.');
      return;
    }
    
    console.log(`✅ Candle data available:`);
    console.log(`   Price: $${snapshot.candle.close}`);
    console.log(`   Timestamp: ${new Date(snapshot.candle.timestamp).toISOString()}`);
    console.log(`   Source: ${snapshot.source}\n`);

    // Check trades
    const trades = await prisma.trade.findMany({
      where: { strategyId, mode: 'PAPER' },
      orderBy: { timestamp: 'desc' },
      take: 5,
    });

    console.log(`📈 Trades: ${trades.length} total`);
    trades.forEach((t, i) => {
      console.log(`   ${i + 1}. ${t.side} ${t.symbol} @ $${t.entryPrice} (${new Date(t.timestamp).toLocaleTimeString()})`);
    });

    // Check if strategy should be trading
    if (strategy.status !== 'ACTIVE') {
      console.log(`\n⚠️  Strategy status is "${strategy.status}" - should be "ACTIVE"`);
    }

    if (trades.length === 0) {
      console.log(`\n🚀 Strategy has NO trades - force trade logic should trigger`);
      console.log(`   The trading loop should create a trade within 10 seconds`);
    } else if (trades.length < 3) {
      console.log(`\n🚀 Strategy has ${trades.length} trades - force trade logic should trigger`);
      console.log(`   The trading loop should create more trades within 10 seconds`);
    }

    // Check for open positions
    const openTrades = trades.filter(t => !t.exitPrice);
    if (openTrades.length > 0) {
      console.log(`\n📊 Open positions: ${openTrades.length}`);
      openTrades.forEach(t => {
        console.log(`   ${t.side} ${t.symbol} @ $${t.entryPrice}`);
      });
    }

    console.log(`\n💡 Next Steps:`);
    console.log(`   1. Check server console for logs (should see "Processing symbol" every 10s)`);
    console.log(`   2. Look for "FORCING IMMEDIATE TRADE" messages`);
    console.log(`   3. If no logs appear, the trading loop might not be running`);
    console.log(`   4. Restart the strategy: curl -X POST http://localhost:4000/strategies/${strategyId}/paper/stop && curl -X POST http://localhost:4000/strategies/${strategyId}/paper/start\n`);

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

checkTradingStatus();


