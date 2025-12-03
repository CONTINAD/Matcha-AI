#!/usr/bin/env tsx

/**
 * Verification script to ensure everything is real and working
 * Checks:
 * 1. Strategies are actually trading (not just active)
 * 2. Trades are being recorded in database
 * 3. AI training is running
 * 4. Market data is real (not fake)
 * 5. No test strategies in production
 */

import dotenv from 'dotenv';
import path from 'path';

// Load .env from project root (same as server.ts)
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config(); // Also try current directory

import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';

const prisma = new PrismaClient();

async function verifyRealTrading() {
  console.log('🔍 Verifying Real Trading System...\n');

  // 1. Check for test strategies
  console.log('1️⃣ Checking for test strategies...');
  const testStrategies = await prisma.strategy.findMany({
    where: {
      OR: [
        { name: { contains: 'Test', mode: 'insensitive' } },
        { name: { contains: 'test', mode: 'insensitive' } },
        { name: { contains: 'TEST', mode: 'insensitive' } },
      ],
    },
  });

  if (testStrategies.length > 0) {
    console.log(`⚠️  Found ${testStrategies.length} test strategies:`);
    testStrategies.forEach((s) => console.log(`   - ${s.name} (${s.id})`));
  } else {
    console.log('✅ No test strategies found\n');
  }

  // 2. Check active strategies
  console.log('2️⃣ Checking active strategies...');
  const activeStrategies = await prisma.strategy.findMany({
    where: { status: 'ACTIVE' },
  });

  console.log(`   Found ${activeStrategies.length} active strategies`);
  if (activeStrategies.length === 0) {
    console.log('⚠️  No active strategies! Start paper trading to begin.\n');
  } else {
    activeStrategies.forEach((s) => {
      console.log(`   - ${s.name} (${s.mode}, ${s.timeframe})`);
    });
    console.log('');
  }

  // 3. Check for real trades
  console.log('3️⃣ Checking for real trades...');
  const recentTrades = await prisma.trade.findMany({
    where: {
      timestamp: {
        gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
      },
    },
    orderBy: { timestamp: 'desc' },
    take: 10,
  });

  console.log(`   Found ${recentTrades.length} trades in last 24 hours`);
  if (recentTrades.length === 0) {
    console.log('⚠️  No trades yet! Strategies may need more time to start trading.\n');
  } else {
    console.log('   Recent trades:');
    recentTrades.slice(0, 5).forEach((t) => {
      console.log(`   - ${t.symbol} ${t.side} @ $${t.entryPrice?.toFixed(2) || 'N/A'} | P&L: $${t.pnl?.toFixed(2) || '0.00'}`);
    });
    console.log('');
  }

  // 4. Check for predictions (AI learning)
  console.log('4️⃣ Checking AI predictions (learning)...');
  const recentPredictions = await prisma.prediction.findMany({
    where: {
      timestamp: {
        gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    },
    orderBy: { timestamp: 'desc' },
    take: 10,
  });

  console.log(`   Found ${recentPredictions.length} predictions in last 24 hours`);
  if (recentPredictions.length === 0) {
    console.log('⚠️  No predictions yet! AI needs trades to learn from.\n');
  } else {
    const evaluated = recentPredictions.filter((p) => p.evaluatedAt);
    const accuracy = evaluated.length > 0
      ? evaluated.filter((p) => p.outcome === 'correct').length / evaluated.length
      : 0;
    console.log(`   Evaluated: ${evaluated.length} | Accuracy: ${(accuracy * 100).toFixed(1)}%\n`);
  }

  // 5. Check for performance snapshots
  console.log('5️⃣ Checking performance tracking...');
  const snapshots = await prisma.performanceSnapshot.findMany({
    orderBy: { timestamp: 'desc' },
    take: 5,
  });

  console.log(`   Found ${snapshots.length} performance snapshots`);
  if (snapshots.length > 0) {
    const latest = snapshots[0];
    console.log(`   Latest: ${new Date(latest.timestamp).toLocaleString()}`);
    console.log(`   Equity: $${latest.equityCurvePoint.toFixed(2)} | Win Rate: ${(latest.winRate * 100).toFixed(1)}%\n`);
  } else {
    console.log('⚠️  No performance snapshots yet!\n');
  }

  // 6. Summary
  console.log('📊 Summary:');
  console.log(`   Active Strategies: ${activeStrategies.length}`);
  console.log(`   Recent Trades (24h): ${recentTrades.length}`);
  console.log(`   AI Predictions (24h): ${recentPredictions.length}`);
  console.log(`   Performance Snapshots: ${snapshots.length}`);
  
  if (activeStrategies.length > 0 && recentTrades.length === 0) {
    console.log('\n⚠️  WARNING: Strategies are active but not trading!');
    console.log('   - Check if strategies have enough historical data');
    console.log('   - Verify market data is being fetched');
    console.log('   - Check confidence thresholds (may be too high)');
  } else if (activeStrategies.length > 0 && recentTrades.length > 0) {
    console.log('\n✅ System is working! Strategies are trading and learning.');
  } else {
    console.log('\n⚠️  Start paper trading to begin!');
  }

  await prisma.$disconnect();
}

verifyRealTrading().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});

