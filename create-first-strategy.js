const axios = require('axios');

const API_URL = process.env.API_URL || 'http://localhost:4000';

async function createFirstStrategy() {
  try {
    console.log('🚀 Creating your first profitable Solana strategy...\n');

    const strategyData = {
      name: 'Solana Momentum AI',
      description: 'AI-powered momentum strategy optimized for Solana. Uses multi-indicator analysis (RSI, EMA, MACD, Bollinger Bands) with continuous learning from predictions. Perfect for small accounts starting with $5.',
      mode: 'PAPER', // Start in paper trading mode
      baseAsset: 'USDC',
      universe: ['SOL'], // Trade SOL/USDC on Solana
      timeframe: '5m', // 5-minute candles for faster learning
      chainId: 101, // Solana Mainnet
      maxPositionPct: 15, // 15% position size (good for small accounts)
      maxDailyLossPct: 3, // Stop trading if down 3% in a day
      stopLossPct: 2, // 2% stop loss
      takeProfitPct: 4, // 4% take profit (2:1 risk/reward)
      trailingStopPct: 1.5, // 1.5% trailing stop to lock in profits
    };

    console.log('Strategy Configuration:');
    console.log(JSON.stringify(strategyData, null, 2));
    console.log('\n📡 Sending to API...\n');

    const response = await axios.post(`${API_URL}/strategies`, strategyData, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (response.status === 201) {
      const strategy = response.data;
      console.log('✅ Strategy created successfully!\n');
      console.log('Strategy Details:');
      console.log(`  ID: ${strategy.id}`);
      console.log(`  Name: ${strategy.name}`);
      console.log(`  Mode: ${strategy.mode}`);
      console.log(`  Chain: Solana (${strategy.chainId})`);
      console.log(`  Status: ${strategy.status}`);
      console.log(`\n🌐 View it at: http://localhost:3000/strategies/${strategy.id}`);
      console.log(`\n📊 Next Steps:`);
      console.log(`  1. Go to the strategy page`);
      console.log(`  2. Click "Run Backtest" to test it (use fast mode)`);
      console.log(`  3. Once profitable, click "Start Paper Trading"`);
      console.log(`  4. After paper trading proves profitable, connect your Solana wallet`);
      console.log(`  5. Switch to LIVE mode and start trading!\n`);
      
      return strategy;
    } else {
      throw new Error(`Unexpected status code: ${response.status}`);
    }
  } catch (error) {
    if (error.response) {
      console.error('❌ API Error:', error.response.data);
      console.error('Status:', error.response.status);
    } else if (error.request) {
      console.error('❌ No response from API. Is the server running?');
      console.error('Make sure the API is running on', API_URL);
    } else {
      console.error('❌ Error:', error.message);
    }
    process.exit(1);
  }
}

createFirstStrategy();


