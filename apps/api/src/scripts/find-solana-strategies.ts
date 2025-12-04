import dotenv from 'dotenv';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

const prisma = new PrismaClient();

async function findSolanaStrategies() {
  console.log('🔍 Finding Solana strategies...\n');

  try {
    // Find all Solana strategies (chainId 101)
    const solanaStrategies = await prisma.strategy.findMany({
      where: {
        chainId: 101,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    console.log(`Found ${solanaStrategies.length} Solana strategies:\n`);

    if (solanaStrategies.length === 0) {
      console.log('❌ No Solana strategies found!');
      console.log('\n💡 To create Solana strategies, run:');
      console.log('   pnpm setup:solana\n');
      return;
    }

    solanaStrategies.forEach((strategy, index) => {
      console.log(`${index + 1}. ${strategy.name}`);
      console.log(`   ID: ${strategy.id}`);
      console.log(`   Status: ${strategy.status} | Mode: ${strategy.mode}`);
      console.log(`   Chain: ${strategy.chainId === 101 ? '✅ Solana' : '❌ Not Solana'}`);
      console.log(`   Timeframe: ${strategy.timeframe}`);
      console.log(`   Created: ${strategy.createdAt.toISOString()}`);
      console.log('');
    });

    // Find active Solana strategies
    const activeSolana = solanaStrategies.filter(s => s.status === 'ACTIVE');
    console.log(`\n✅ Active Solana strategies: ${activeSolana.length}`);
    
    if (activeSolana.length > 0) {
      console.log('\nActive strategies:');
      activeSolana.forEach(s => {
        console.log(`  - ${s.name} (${s.id})`);
      });
    }

    // Validate chainId
    const invalid = solanaStrategies.filter(s => s.chainId !== 101);
    if (invalid.length > 0) {
      console.log(`\n⚠️  Warning: ${invalid.length} strategies have incorrect chainId:`);
      invalid.forEach(s => {
        console.log(`  - ${s.name}: chainId=${s.chainId} (should be 101)`);
      });
    }

    // Return first active strategy ID for testing
    if (activeSolana.length > 0) {
      console.log(`\n📝 Use this ID for testing: ${activeSolana[0].id}`);
      return activeSolana[0].id;
    } else if (solanaStrategies.length > 0) {
      console.log(`\n📝 Use this ID for testing: ${solanaStrategies[0].id}`);
      return solanaStrategies[0].id;
    }

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

findSolanaStrategies().then((strategyId) => {
  if (strategyId) {
    process.exit(0);
  } else {
    process.exit(1);
  }
});

