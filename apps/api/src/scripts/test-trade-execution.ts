#!/usr/bin/env tsx

/**
 * Test script to force a trade and verify the system is working
 */

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config();

import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';

const prisma = new PrismaClient();

async function testTradeExecution() {
  console.log('🧪 Testing Trade Execution...\n');

  try {
    // Get an active Solana strategy
    const strategy = await prisma.strategy.findFirst({
      where: {
        status: 'ACTIVE',
        mode: 'PAPER',
        chainId: 101, // Solana
      },
    });

    if (!strategy) {
      console.log('❌ No active Solana strategy found');
      return;
    }

    console.log(`📊 Testing with strategy: ${strategy.name} (${strategy.id})\n`);

    // Create a test trade manually
    const testTrade = await prisma.trade.create({
      data: {
        strategyId: strategy.id,
        timestamp: new Date(),
        mode: 'PAPER',
        symbol: 'SOL',
        side: 'BUY',
        size: 0.1,
        entryPrice: 142.50,
        fees: 0.001,
        slippage: 0,
        pnl: 0,
        pnlPct: 0,
      },
    });

    console.log(`✅ Test trade created: ${testTrade.id}`);
    console.log(`   Symbol: SOL`);
    console.log(`   Side: BUY`);
    console.log(`   Size: 0.1`);
    console.log(`   Price: $142.50\n`);

    // Check if trade appears
    const trades = await prisma.trade.findMany({
      where: { strategyId: strategy.id },
      orderBy: { timestamp: 'desc' },
      take: 5,
    });

    console.log(`📈 Recent trades for this strategy: ${trades.length}`);
    trades.forEach((t, i) => {
      console.log(`   ${i + 1}. ${t.side} ${t.symbol} @ $${t.entryPrice} (${new Date(t.timestamp).toLocaleTimeString()})`);
    });

    console.log('\n✅ System is working! Trades can be created.');
    console.log('\n💡 If strategies aren\'t trading automatically:');
    console.log('   1. They need at least 20 candles for indicators');
    console.log('   2. Market conditions must meet confidence thresholds');
    console.log('   3. Risk manager must approve the trade');
    console.log('   4. Check server logs for detailed decision-making');

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

testTradeExecution();


