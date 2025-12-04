#!/usr/bin/env tsx

/**
 * Test profitability of strategies based on actual paper trading trades
 * Calculates real P&L, win rate, Sharpe ratio from executed trades
 */

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config();

import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';

const prisma = new PrismaClient();

interface ProfitabilityMetrics {
  totalTrades: number;
  closedTrades: number;
  openTrades: number;
  totalPnl: number;
  totalPnlPct: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  sharpeRatio: number;
  maxDrawdown: number;
  daysTrading: number;
  tradesPerDay: number;
}

function calculateSharpeRatio(returns: number[], riskFreeRate = 0): number {
  if (returns.length === 0) return 0;
  
  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  
  if (stdDev === 0) return 0;
  
  // Annualized Sharpe (assuming daily returns)
  const annualizedReturn = avgReturn * 365;
  const annualizedStdDev = stdDev * Math.sqrt(365);
  
  return (annualizedReturn - riskFreeRate) / annualizedStdDev;
}

function calculateMaxDrawdown(equityCurve: number[]): number {
  if (equityCurve.length === 0) return 0;
  
  let maxDrawdown = 0;
  let peak = equityCurve[0];
  
  for (const value of equityCurve) {
    if (value > peak) {
      peak = value;
    }
    const drawdown = (peak - value) / peak;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }
  
  return maxDrawdown * 100; // Return as percentage
}

async function calculateProfitability(strategyId: string): Promise<ProfitabilityMetrics | null> {
  const strategy = await prisma.strategy.findUnique({
    where: { id: strategyId },
  });

  if (!strategy) {
    return null;
  }

  // Get all paper trading trades
  const allTrades = await prisma.trade.findMany({
    where: {
      strategyId,
      mode: 'PAPER',
    },
    orderBy: {
      timestamp: 'asc',
    },
  });

  if (allTrades.length === 0) {
    return {
      totalTrades: 0,
      closedTrades: 0,
      openTrades: 0,
      totalPnl: 0,
      totalPnlPct: 0,
      winRate: 0,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      daysTrading: 0,
      tradesPerDay: 0,
    };
  }

  const closedTrades = allTrades.filter(t => t.exitPrice !== null && t.pnl !== null);
  const openTrades = allTrades.filter(t => t.exitPrice === null);
  
  const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const totalPnlPct = closedTrades.reduce((sum, t) => sum + (t.pnlPct || 0), 0) / closedTrades.length;
  
  const wins = closedTrades.filter(t => (t.pnl || 0) > 0);
  const losses = closedTrades.filter(t => (t.pnl || 0) < 0);
  
  const winRate = closedTrades.length > 0 ? wins.length / closedTrades.length : 0;
  const avgWin = wins.length > 0 ? wins.reduce((sum, t) => sum + (t.pnl || 0), 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((sum, t) => sum + (t.pnl || 0), 0) / losses.length) : 0;
  
  const totalWins = wins.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const totalLosses = Math.abs(losses.reduce((sum, t) => sum + (t.pnl || 0), 0));
  const profitFactor = totalLosses > 0 ? totalWins / totalLosses : (totalWins > 0 ? Infinity : 0);
  
  // Calculate equity curve for drawdown
  let equity = 10000; // Starting equity
  const equityCurve: number[] = [equity];
  const returns: number[] = [];
  
  for (const trade of closedTrades) {
    equity += trade.pnl || 0;
    equityCurve.push(equity);
    if (equityCurve.length > 1) {
      const returnPct = (equity - equityCurve[equityCurve.length - 2]) / equityCurve[equityCurve.length - 2];
      returns.push(returnPct);
    }
  }
  
  const sharpeRatio = calculateSharpeRatio(returns);
  const maxDrawdown = calculateMaxDrawdown(equityCurve);
  
  // Calculate days trading
  const firstTrade = allTrades[0];
  const lastTrade = allTrades[allTrades.length - 1];
  const daysTrading = firstTrade && lastTrade
    ? Math.max(1, Math.ceil((lastTrade.timestamp.getTime() - firstTrade.timestamp.getTime()) / (1000 * 60 * 60 * 24)))
    : 0;
  const tradesPerDay = daysTrading > 0 ? closedTrades.length / daysTrading : 0;

  return {
    totalTrades: allTrades.length,
    closedTrades: closedTrades.length,
    openTrades: openTrades.length,
    totalPnl,
    totalPnlPct,
    winRate: winRate * 100, // As percentage
    avgWin,
    avgLoss,
    profitFactor,
    sharpeRatio,
    maxDrawdown,
    daysTrading,
    tradesPerDay,
  };
}

async function testProfitability() {
  console.log('📊 Testing Profitability from Actual Trades\n');

  try {
    const strategies = await prisma.strategy.findMany({
      where: {
        status: 'ACTIVE',
        mode: 'PAPER',
      },
    });

    console.log(`Found ${strategies.length} active paper trading strategies\n`);

    if (strategies.length === 0) {
      console.log('⚠️  No active strategies found. Start paper trading first.\n');
      return;
    }

    // Profitability gate requirements
    const requirements = {
      sharpe: 2.0,
      return: 25, // 25% monthly
      winRate: 55, // 55%
      drawdown: 15, // 15% max
      minTrades: 50,
    };

    console.log('Profitability Requirements:');
    console.log(`  - Sharpe Ratio > ${requirements.sharpe}`);
    console.log(`  - Monthly Return > ${requirements.return}%`);
    console.log(`  - Win Rate > ${requirements.winRate}%`);
    console.log(`  - Max Drawdown < ${requirements.drawdown}%`);
    console.log(`  - Minimum ${requirements.minTrades} trades\n`);

    const results: Array<{ strategy: any; metrics: ProfitabilityMetrics; passed: boolean }> = [];

    for (const strategy of strategies) {
      const metrics = await calculateProfitability(strategy.id);
      
      if (!metrics) {
        console.log(`❌ ${strategy.name}: Could not calculate metrics\n`);
        continue;
      }

      // Check if meets requirements
      const monthlyReturn = metrics.totalPnlPct * (30 / metrics.daysTrading || 1);
      const passed = 
        metrics.sharpeRatio > requirements.sharpe &&
        monthlyReturn > requirements.return &&
        metrics.winRate > requirements.winRate &&
        metrics.maxDrawdown < requirements.drawdown &&
        metrics.closedTrades >= requirements.minTrades;

      results.push({ strategy, metrics, passed });

      console.log(`\n${strategy.name} (${strategy.chainId === 101 ? 'Solana' : 'Ethereum'})`);
      console.log(`  Status: ${passed ? '✅ PASSED' : '❌ NOT YET'}`);
      console.log(`  Total Trades: ${metrics.totalTrades} (${metrics.closedTrades} closed, ${metrics.openTrades} open)`);
      console.log(`  Total P&L: $${metrics.totalPnl.toFixed(2)} (${metrics.totalPnlPct.toFixed(2)}%)`);
      console.log(`  Win Rate: ${metrics.winRate.toFixed(1)}% (target: >${requirements.winRate}%) ${metrics.winRate > requirements.winRate ? '✅' : '❌'}`);
      console.log(`  Avg Win: $${metrics.avgWin.toFixed(2)} | Avg Loss: $${metrics.avgLoss.toFixed(2)}`);
      console.log(`  Profit Factor: ${metrics.profitFactor.toFixed(2)}`);
      console.log(`  Sharpe Ratio: ${metrics.sharpeRatio.toFixed(2)} (target: >${requirements.sharpe}) ${metrics.sharpeRatio > requirements.sharpe ? '✅' : '❌'}`);
      console.log(`  Max Drawdown: ${metrics.maxDrawdown.toFixed(2)}% (target: <${requirements.drawdown}%) ${metrics.maxDrawdown < requirements.drawdown ? '✅' : '❌'}`);
      console.log(`  Days Trading: ${metrics.daysTrading} | Trades/Day: ${metrics.tradesPerDay.toFixed(1)}`);
      
      if (metrics.daysTrading > 0) {
        const monthlyReturn = metrics.totalPnlPct * (30 / metrics.daysTrading);
        console.log(`  Est. Monthly Return: ${monthlyReturn.toFixed(2)}% (target: >${requirements.return}%) ${monthlyReturn > requirements.return ? '✅' : '❌'}`);
      }
      
      if (metrics.closedTrades < requirements.minTrades) {
        console.log(`  ⚠️  Need ${requirements.minTrades - metrics.closedTrades} more trades`);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('\nSummary:');
    const passedCount = results.filter(r => r.passed).length;
    console.log(`  ✅ Passed: ${passedCount}/${results.length}`);
    console.log(`  ❌ Not Yet: ${results.length - passedCount}/${results.length}`);

    if (passedCount > 0) {
      console.log('\n🎉 Strategies ready for live trading:');
      results.filter(r => r.passed).forEach(r => {
        console.log(`  - ${r.strategy.name}`);
      });
    }

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    logger.error({ error }, 'Error testing profitability');
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

testProfitability();


