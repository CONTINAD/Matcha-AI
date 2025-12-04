import dotenv from 'dotenv';
import path from 'path';
import axios from 'axios';

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config();

const API_URL = process.env.API_URL || 'http://localhost:4000';
const STRATEGY_ID = process.argv[2];

if (!STRATEGY_ID) {
  console.error('❌ Please provide a strategy ID');
  console.log('Usage: tsx src/scripts/backtest-strategy.ts <strategy-id>');
  process.exit(1);
}

async function runBacktest() {
  try {
    console.log(`\n🚀 Running backtest for strategy: ${STRATEGY_ID}\n`);

    // Run backtest with 30 days of data
    const response = await axios.post(
      `${API_URL}/strategies/${STRATEGY_ID}/backtest`,
      {
        from: Date.now() - 30 * 24 * 60 * 60 * 1000, // 30 days ago
        to: Date.now(),
        initialEquity: 10000, // $10k starting capital
      },
      {
        timeout: 120000, // 2 minute timeout
        validateStatus: (status) => status < 500,
      }
    );

    if (response.status >= 400) {
      const error = response.data?.error || response.data?.message || 'Unknown error';
      console.error(`❌ Backtest failed: ${error}`);
      process.exit(1);
    }

    const result = response.data;

    console.log('\n📊 Backtest Results:\n');
    console.log(`   Total Return: ${result.totalReturnPct?.toFixed(2) || 'N/A'}%`);
    console.log(`   Total Trades: ${result.totalTrades || 0}`);
    console.log(`   Win Rate: ${result.winRate ? (result.winRate * 100).toFixed(2) : 'N/A'}%`);
    console.log(`   Sharpe Ratio: ${result.sharpe?.toFixed(2) || 'N/A'}`);
    console.log(`   Max Drawdown: ${result.maxDrawdown?.toFixed(2) || 'N/A'}%`);
    console.log(`   Total PnL: $${result.totalPnL?.toFixed(2) || '0.00'}`);
    console.log(`   Average Trade: $${result.avgTradePnL?.toFixed(2) || '0.00'}`);

    if (result.trades && result.trades.length > 0) {
      console.log(`\n📈 Recent Trades:`);
      result.trades.slice(0, 5).forEach((trade: any, i: number) => {
        console.log(`   ${i + 1}. ${trade.side} ${trade.symbol} @ $${trade.entryPrice?.toFixed(2)} → PnL: ${trade.pnlPct?.toFixed(2)}%`);
      });
    }

    console.log(`\n✅ Backtest complete! Strategy now has ${result.totalTrades || 0} historical trades.\n`);

    // Verify trades were saved
    const strategyResponse = await axios.get(`${API_URL}/strategies/${STRATEGY_ID}`);
    const trades = strategyResponse.data?.trades || [];
    console.log(`📋 Strategy now has ${trades.length} trades in database\n`);

  } catch (error: any) {
    if (error.code === 'ECONNREFUSED') {
      console.error('\n❌ API server is not running!');
      console.log('   Please start it with: cd apps/api && pnpm dev\n');
    } else {
      console.error('\n❌ Error:', error.message);
      if (error.response?.data) {
        console.error('   Details:', JSON.stringify(error.response.data, null, 2));
      }
    }
    process.exit(1);
  }
}

runBacktest();

