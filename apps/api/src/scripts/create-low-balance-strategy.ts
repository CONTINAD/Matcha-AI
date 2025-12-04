import dotenv from 'dotenv';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';
import { paperTrader } from '../services/paperTrader';
import type { StrategyConfig } from '@matcha-ai/shared/types';

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config(); // Also try current directory

const prisma = new PrismaClient();

/**
 * Create a low-balance trading strategy optimized for Polygon
 * - USDC base asset (stable)
 * - WETH trading pair (high liquidity, low slippage)
 * - Small position sizes (5% max) for low balance accounts
 * - Conservative risk limits
 * - 5-minute timeframe for active trading
 */
async function createLowBalanceStrategy() {
  try {
    logger.info('🚀 Creating low-balance Polygon strategy...');

    // Get or create default user
    let user = await prisma.user.findUnique({
      where: { email: 'default-user@matcha.ai' },
    });
    if (!user) {
      user = await prisma.user.create({
        data: { email: 'default-user@matcha.ai' },
      });
      logger.info('✅ Created default user');
    }

    // Strategy config optimized for low balance + fees
    const config: StrategyConfig = {
      baseAsset: 'USDC',
      universe: ['WETH'], // Trade WETH with USDC base
      timeframe: '5m', // 5-minute candles - good balance of signals vs gas costs
      riskLimits: {
        maxPositionPct: 5, // Small positions - 5% max per trade
        maxDailyLossPct: 3, // Conservative daily loss limit
        stopLossPct: 2, // 2% stop loss per trade
        takeProfitPct: 4, // 4% take profit (2:1 risk/reward)
        trailingStopPct: 1.5, // 1.5% trailing stop
      },
      indicators: {
        rsi: { period: 14, overbought: 70, oversold: 30 },
        macd: { fast: 12, slow: 26, signal: 9 },
        ema: { short: 9, long: 21 },
      },
      signals: {
        minConfidence: 0.6, // Require 60% confidence
        requireMultipleSignals: true, // Need multiple indicators to agree
      },
      timeBased: false,
    };

    // Create strategy on Polygon (chainId: 137)
    const strategy = await prisma.strategy.create({
      data: {
        userId: user.id,
        name: 'Polygon Low-Balance USDC/WETH',
        description: 'Optimized for low balance trading on Polygon. Trades WETH/USDC with small position sizes (5% max) and conservative risk limits. Polygon gas fees are ~$0.001-0.01 per trade.',
        mode: 'PAPER', // Start in paper trading mode
        baseAsset: 'USDC',
        universeJson: JSON.stringify(['WETH']),
        timeframe: '5m',
        chainId: 137, // Polygon
        configJson: JSON.stringify(config),
        status: 'ACTIVE', // Set to ACTIVE so it auto-starts
      },
    });

    logger.info(
      {
        strategyId: strategy.id,
        name: strategy.name,
        chainId: strategy.chainId,
        mode: strategy.mode,
      },
      '✅ Strategy created'
    );

    // Start paper trading
    try {
      await paperTrader.start(strategy.id);
      logger.info({ strategyId: strategy.id }, '✅ Paper trading started');
    } catch (error: any) {
      logger.warn(
        { error: error.message, strategyId: strategy.id },
        '⚠️  Could not start paper trading immediately (will auto-start on server restart)'
      );
    }

    // Verify strategy is set up correctly
    const verify = await prisma.strategy.findUnique({
      where: { id: strategy.id },
      include: {
        trades: {
          take: 1,
          orderBy: { timestamp: 'desc' },
        },
      },
    });

    logger.info(
      {
        strategyId: verify?.id,
        status: verify?.status,
        mode: verify?.mode,
        chainId: verify?.chainId,
        baseAsset: verify?.baseAsset,
        isPaperTradingActive: paperTrader.isActive(strategy.id),
      },
      '📊 Strategy verification'
    );

    console.log('\n🎉 Strategy created successfully!');
    console.log(`\n📋 Strategy Details:`);
    console.log(`   ID: ${strategy.id}`);
    console.log(`   Name: ${strategy.name}`);
    console.log(`   Chain: Polygon (137)`);
    console.log(`   Mode: PAPER`);
    console.log(`   Base Asset: USDC`);
    console.log(`   Trading Pair: USDC/WETH`);
    console.log(`   Max Position: 5%`);
    console.log(`   Timeframe: 5 minutes`);
    console.log(`   Status: ${verify?.status}`);
    console.log(`   Paper Trading: ${paperTrader.isActive(strategy.id) ? '✅ ACTIVE' : '⏸️  PAUSED'}`);
    console.log(`\n💡 Next Steps:`);
    console.log(`   1. Monitor trades at: GET /strategies/${strategy.id}`);
    console.log(`   2. View analytics at: GET /analytics/strategy/${strategy.id}`);
    console.log(`   3. Check paper trading status: GET /strategies/${strategy.id}`);
    console.log(`\n💰 Why this setup is good for low balance:`);
    console.log(`   • Polygon gas fees: ~$0.001-0.01 per trade (vs $5-50 on Ethereum)`);
    console.log(`   • USDC/WETH has high liquidity = low slippage`);
    console.log(`   • 5% max position = can trade with small balances`);
    console.log(`   • Conservative risk limits protect capital`);
    console.log(`   • 5m timeframe = good signal frequency without excessive gas costs\n`);

    return strategy.id;
  } catch (error: any) {
    logger.error({ error: error.message, stack: error.stack }, '❌ Failed to create strategy');
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  createLowBalanceStrategy()
    .then((strategyId) => {
      console.log(`\n✅ Done! Strategy ID: ${strategyId}\n`);
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Error:', error.message);
      process.exit(1);
    });
}

export { createLowBalanceStrategy };

