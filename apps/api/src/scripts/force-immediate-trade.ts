#!/usr/bin/env tsx

/**
 * Force an immediate trade for a strategy - bypasses all checks
 */

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config();

import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';

const prisma = new PrismaClient();

async function forceImmediateTrade() {
  const strategyId = process.argv[2] || 'cmipj8tot0001einx91b2ugsd';
  
  console.log(`🚀 Forcing immediate trade for strategy: ${strategyId}\n`);

  try {
    const strategy = await prisma.strategy.findUnique({
      where: { id: strategyId },
    });

    if (!strategy) {
      console.log('❌ Strategy not found');
      return;
    }

    const config = JSON.parse(strategy.configJson);
    const symbol = config.universe[0] || 'SOL';
    const price = 142.50; // Example price

    // Create trade directly
    const trade = await prisma.trade.create({
      data: {
        strategyId,
        timestamp: new Date(),
        mode: 'PAPER',
        symbol,
        side: 'BUY',
        size: 0.1,
        entryPrice: price,
        fees: 0.001,
        slippage: 0,
        pnl: 0,
        pnlPct: 0,
      },
    });

    console.log(`✅ Trade created: ${trade.id}`);
    console.log(`   Symbol: ${symbol}`);
    console.log(`   Side: BUY`);
    console.log(`   Size: 0.1`);
    console.log(`   Price: $${price}\n`);

    // Verify
    const trades = await prisma.trade.findMany({
      where: { strategyId },
      orderBy: { timestamp: 'desc' },
      take: 3,
    });

    console.log(`📊 Total trades: ${trades.length}`);
    trades.forEach((t, i) => {
      console.log(`   ${i + 1}. ${t.side} ${t.symbol} @ $${t.entryPrice}`);
    });

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

forceImmediateTrade();


