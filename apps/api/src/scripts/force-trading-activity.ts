#!/usr/bin/env tsx

/**
 * Restart trading activity for active strategies
 * Restarts paper trading to ensure they're actively checking markets
 * Note: No longer forces fake trades - strategies will only trade when AI signals are generated
 */

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config();

import { PrismaClient } from '@prisma/client';
import { paperTrader } from '../services/paperTrader';
import { logger } from '../config/logger';

const prisma = new PrismaClient();

async function forceTradingActivity() {
  console.log('🔄 Forcing trading activity for all active strategies...\n');

  try {
    // Get all active strategies
    const strategies = await prisma.strategy.findMany({
      where: {
        status: 'ACTIVE',
        mode: 'PAPER',
      },
    });

    console.log(`Found ${strategies.length} active paper trading strategies\n`);

    for (const strategy of strategies) {
      try {
        // Stop if running
        try {
          await paperTrader.stop(strategy.id);
          console.log(`   ⏹️  Stopped ${strategy.name}`);
        } catch {
          // Already stopped or not running
        }

        // Wait a moment
        await new Promise(resolve => setTimeout(resolve, 500));

        // Start with timeout wrapper (15s max per strategy)
        const startPromise = paperTrader.start(strategy.id);
        const timeoutPromise = new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Strategy start timeout (15s)')), 15000)
        );
        
        try {
          await Promise.race([startPromise, timeoutPromise]);
          console.log(`   ▶️  Started ${strategy.name} (${strategy.timeframe})`);
          
          // Check status after starting
          const metrics = paperTrader.getTradingMetrics(strategy.id);
          if (metrics) {
            console.log(`      📊 Metrics: ${metrics.totalDecisions} decisions, ${metrics.tradesExecuted} trades executed`);
          }
        } catch (timeoutError: any) {
          console.log(`   ⚠️  ${strategy.name} start timed out or failed: ${timeoutError.message}`);
          console.log(`      Continuing with next strategy...`);
        }
      } catch (error: any) {
        console.log(`   ❌ Failed to restart ${strategy.name}: ${error.message}`);
      }
    }

    console.log('\n✅ All strategies restarted!');
    console.log('\n📊 Strategies will start trading when AI generates signals');
    console.log('   - Checking markets every 30 seconds');
    console.log('   - Trading only when confidence thresholds are met');
    console.log('   - No fake trades - all trades from real AI decisions');

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

forceTradingActivity();


