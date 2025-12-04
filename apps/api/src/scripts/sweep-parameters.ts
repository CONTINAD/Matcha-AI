import 'dotenv/config';
import { parameterSweeper } from '../services/parameterSweeper';
import { logger } from '../config/logger';

/**
 * CLI tool to run parameter sweeps for a symbol/timeframe
 * 
 * Usage:
 *   pnpm tsx apps/api/src/scripts/sweep-parameters.ts <symbol> <timeframe> <chainId>
 * 
 * Example:
 *   pnpm tsx apps/api/src/scripts/sweep-parameters.ts WETH 5m 137
 */

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 3) {
    console.error('Usage: sweep-parameters.ts <symbol> <timeframe> <chainId>');
    console.error('Example: sweep-parameters.ts WETH 5m 137');
    process.exit(1);
  }

  const symbol = args[0];
  const timeframe = args[1];
  const chainId = parseInt(args[2], 10);
  const baseAsset = 'USDC';

  if (isNaN(chainId)) {
    console.error('Invalid chainId:', args[2]);
    process.exit(1);
  }

  // Calculate date range (last 30 days)
  const to = Date.now();
  const from = to - (30 * 24 * 60 * 60 * 1000);

  logger.info({ symbol, timeframe, chainId, from: new Date(from), to: new Date(to) }, 'Starting parameter sweep');

  try {
    const results = await parameterSweeper.sweep({
      symbol,
      baseAsset,
      timeframe,
      chainId,
      from,
      to,
      initialEquity: 10000,
      // Use smaller ranges for faster sweeps
      rsiOversoldRange: { min: 25, max: 35, step: 5 },
      rsiOverboughtRange: { min: 65, max: 75, step: 5 },
      adxThresholdRange: { min: 20, max: 30, step: 10 }, // Larger step for ADX
      positionSizeRange: { min: 3, max: 8, step: 1 },
      stopLossRange: { min: 1.5, max: 2.5, step: 0.5 },
      takeProfitRange: { min: 3, max: 5, step: 1 },
    });

    // Get top 10 configs
    const topConfigs = parameterSweeper.getTopConfigs(results, 10);

    console.log('\n=== TOP 10 CONFIGURATIONS ===\n');
    topConfigs.forEach((result, i) => {
      console.log(`${i + 1}. Return: ${result.result.totalReturnPct.toFixed(2)}%, Sharpe: ${result.result.sharpe?.toFixed(2) || 'N/A'}, Win Rate: ${(result.result.winRate * 100).toFixed(1)}%, Trades: ${result.result.totalTrades}`);
      console.log(`   Params: RSI(${result.params.rsiOversold}/${result.params.rsiOverbought}), Position: ${result.params.positionSize}%, Stop: ${result.params.stopLoss}%, Profit: ${result.params.takeProfit}%`);
      console.log(`   Max DD: ${result.result.maxDrawdown.toFixed(2)}%\n`);
    });

    // Save top config to JSON
    const fs = require('fs');
    const path = require('path');
    const outputPath = path.join(process.cwd(), `sweep-results-${symbol}-${timeframe}-${Date.now()}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(topConfigs, null, 2));
    console.log(`\nResults saved to: ${outputPath}`);
  } catch (error: any) {
    logger.error({ error: error.message, stack: error.stack }, 'Parameter sweep failed');
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error({ error }, 'Fatal error in parameter sweep');
  process.exit(1);
});

