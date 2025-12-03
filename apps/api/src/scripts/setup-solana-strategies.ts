#!/usr/bin/env tsx

/**
 * Setup script for research-based Solana strategies
 * Generates 5 proven Solana trading strategies optimized for small accounts
 */

import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config();

import { solanaStrategyGenerator } from '../services/solanaStrategyGenerator';
import { paperTrader } from '../services/paperTrader';
import { logger } from '../config/logger';
import { solanaLogger } from '../services/solanaLogger';

async function setupSolanaStrategies() {
  console.log('🚀 Setting up Research-Based Solana Strategies...\n');

  try {
    // Generate research-based Solana strategies
    console.log('📊 Generating research-based Solana strategies...');
    const strategyIds = await solanaStrategyGenerator.generateSolanaStrategies(5);
    
    console.log(`✅ Generated ${strategyIds.length} Solana strategies:\n`);
    strategyIds.forEach((id, index) => {
      console.log(`   ${index + 1}. Strategy ID: ${id}`);
    });

    // Start paper trading for all strategies
    console.log('\n🔄 Starting paper trading for all strategies...');
    for (const strategyId of strategyIds) {
      try {
        await paperTrader.start(strategyId);
        console.log(`   ✅ Started paper trading for ${strategyId}`);
        solanaLogger.logger.info({ strategyId }, 'Paper trading started');
      } catch (error: any) {
        console.log(`   ⚠️  Failed to start paper trading for ${strategyId}: ${error.message}`);
        solanaLogger.error(strategyId, error);
      }
    }

    console.log('\n✅ Solana strategies setup complete!');
    console.log('\n📋 Strategy Types:');
    console.log('   1. Cross-DEX Arbitrage - Fast execution, low risk');
    console.log('   2. Momentum Breakout - Trending markets');
    console.log('   3. RSI Mean Reversion - Volatile markets');
    console.log('   4. MACD Trend Following - Established trends');
    console.log('   5. Small Account Optimized - Perfect for $20 wallet');
    console.log('\n📁 Logs: Check logs/solana/ for detailed Solana activity logs');
    console.log('\n🎯 Next Steps:');
    console.log('   1. Monitor strategies in dashboard');
    console.log('   2. Check Solana logs for detailed activity');
    console.log('   3. When profitable, switch to LIVE mode');
    console.log('   4. Connect your $20 Solana wallet');

  } catch (error: any) {
    console.error('❌ Error setting up Solana strategies:', error);
    solanaLogger.error(null, error);
    process.exit(1);
  }
}

setupSolanaStrategies();


