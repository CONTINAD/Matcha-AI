#!/usr/bin/env tsx

/**
 * Force trading activity for active strategies
 * Restarts paper trading to ensure they're actively checking markets
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

        // Start again
        await paperTrader.start(strategy.id);
        console.log(`   ▶️  Started ${strategy.name} (${strategy.timeframe})`);
      } catch (error: any) {
        console.log(`   ❌ Failed to restart ${strategy.name}: ${error.message}`);
      }
    }

    console.log('\n✅ All strategies restarted!');
    console.log('\n📊 Strategies should start trading within 30-60 seconds');
    console.log('   - Checking markets every 30 seconds');
    console.log('   - More aggressive confidence thresholds');
    console.log('   - Forcing trades for new strategies (< 5 trades)');

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

forceTradingActivity();


