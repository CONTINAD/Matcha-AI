import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';
import { getChainConfig } from '@matcha-ai/shared';
import { ethers } from 'ethers';
import type { TransactionStatus } from '@matcha-ai/shared';

const prisma = new PrismaClient();

export interface TransactionInfo {
  txHash: string;
  chainId: number;
  status: TransactionStatus;
  blockNumber?: number;
  gasUsed?: string;
  gasPrice?: string;
  submittedAt: Date;
  confirmedAt?: Date;
  failedAt?: Date;
  failureReason?: string;
}

export class TransactionTracker {
  private rpcProviders: Map<number, ethers.JsonRpcProvider> = new Map();
  private trackingIntervals: Map<string, NodeJS.Timeout> = new Map();
  private readonly CONFIRMATION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
  private readonly POLL_INTERVAL_MS = 5000; // Poll every 5 seconds

  /**
   * Get RPC provider for a chain
   */
  private getRpcProvider(chainId: number): ethers.JsonRpcProvider | null {
    if (this.rpcProviders.has(chainId)) {
      return this.rpcProviders.get(chainId)!;
    }

    const chainConfig = getChainConfig(chainId);
    if (!chainConfig?.rpcUrl) {
      return null;
    }

    const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
    this.rpcProviders.set(chainId, provider);
    return provider;
  }

  /**
   * Start tracking a transaction
   */
  async startTracking(txHash: string, chainId: number, tradeId?: string): Promise<void> {
    // Check if already tracking
    if (this.trackingIntervals.has(txHash)) {
      logger.warn({ txHash, chainId }, 'Transaction already being tracked');
      return;
    }

    // Create or update transaction record
    await prisma.transaction.upsert({
      where: { txHash },
      create: {
        txHash,
        chainId,
        status: 'PENDING',
        tradeId,
        submittedAt: new Date(),
      },
      update: {
        status: 'PENDING',
        tradeId,
      },
    });

    // Start polling for confirmation
    const interval = setInterval(async () => {
      try {
        await this.checkTransactionStatus(txHash, chainId);
      } catch (error) {
        logger.error({ error, txHash, chainId }, 'Error checking transaction status');
      }
    }, this.POLL_INTERVAL_MS);

    this.trackingIntervals.set(txHash, interval);

    // Set timeout to stop tracking after CONFIRMATION_TIMEOUT_MS
    setTimeout(() => {
      this.stopTracking(txHash);
    }, this.CONFIRMATION_TIMEOUT_MS);

    logger.info({ txHash, chainId, tradeId }, 'Started tracking transaction');
  }

  /**
   * Stop tracking a transaction
   */
  stopTracking(txHash: string): void {
    const interval = this.trackingIntervals.get(txHash);
    if (interval) {
      clearInterval(interval);
      this.trackingIntervals.delete(txHash);
      logger.debug({ txHash }, 'Stopped tracking transaction');
    }
  }

  /**
   * Check transaction status on blockchain
   */
  async checkTransactionStatus(txHash: string, chainId: number): Promise<TransactionStatus> {
    const provider = this.getRpcProvider(chainId);
    if (!provider) {
      throw new Error(`RPC provider not available for chain ${chainId}`);
    }

    try {
      // Get transaction receipt
      const receipt = await provider.getTransactionReceipt(txHash);

      if (!receipt) {
        // Transaction not yet mined
        return 'PENDING';
      }

      // Transaction was mined - check status
      const status: TransactionStatus = receipt.status === 1 ? 'CONFIRMED' : 'REVERTED';

      // Get transaction details
      const tx = await provider.getTransaction(txHash);
      const blockNumber = receipt.blockNumber;
      const gasUsed = receipt.gasUsed.toString();
      const gasPrice = tx?.gasPrice?.toString() || '0';

      // Update database
      await prisma.transaction.update({
        where: { txHash },
        data: {
          status,
          blockNumber,
          gasUsed,
          gasPrice,
          confirmedAt: status === 'CONFIRMED' ? new Date() : undefined,
          failedAt: status === 'REVERTED' ? new Date() : undefined,
          failureReason: status === 'REVERTED' ? 'Transaction reverted' : undefined,
        },
      });

      // Stop tracking if confirmed or reverted
      if (status === 'CONFIRMED' || status === 'REVERTED') {
        this.stopTracking(txHash);
      }

      logger.info(
        {
          txHash,
          chainId,
          status,
          blockNumber,
          gasUsed,
        },
        'Transaction status updated'
      );

      return status;
    } catch (error) {
      logger.error({ error, txHash, chainId }, 'Error checking transaction status');
      throw error;
    }
  }

  /**
   * Get transaction info from database
   */
  async getTransactionInfo(txHash: string): Promise<TransactionInfo | null> {
    const tx = await prisma.transaction.findUnique({
      where: { txHash },
    });

    if (!tx) {
      return null;
    }

    return {
      txHash: tx.txHash,
      chainId: tx.chainId,
      status: tx.status as TransactionStatus,
      blockNumber: tx.blockNumber || undefined,
      gasUsed: tx.gasUsed || undefined,
      gasPrice: tx.gasPrice || undefined,
      submittedAt: tx.submittedAt,
      confirmedAt: tx.confirmedAt || undefined,
      failedAt: tx.failedAt || undefined,
      failureReason: tx.failureReason || undefined,
    };
  }

  /**
   * Mark transaction as failed
   */
  async markAsFailed(txHash: string, reason: string): Promise<void> {
    await prisma.transaction.update({
      where: { txHash },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        failureReason: reason,
      },
    });

    this.stopTracking(txHash);

    logger.warn({ txHash, reason }, 'Transaction marked as failed');
  }

  /**
   * Get all pending transactions
   */
  async getPendingTransactions(): Promise<TransactionInfo[]> {
    const txs = await prisma.transaction.findMany({
      where: { status: 'PENDING' },
      orderBy: { submittedAt: 'desc' },
    });

    return txs.map((tx) => ({
      txHash: tx.txHash,
      chainId: tx.chainId,
      status: tx.status as TransactionStatus,
      blockNumber: tx.blockNumber || undefined,
      gasUsed: tx.gasUsed || undefined,
      gasPrice: tx.gasPrice || undefined,
      submittedAt: tx.submittedAt,
      confirmedAt: tx.confirmedAt || undefined,
      failedAt: tx.failedAt || undefined,
      failureReason: tx.failureReason || undefined,
    }));
  }

  /**
   * Cleanup old confirmed transactions (older than 7 days)
   */
  async cleanupOldTransactions(): Promise<void> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const result = await prisma.transaction.deleteMany({
      where: {
        status: 'CONFIRMED',
        confirmedAt: {
          lt: sevenDaysAgo,
        },
      },
    });

    logger.info({ deletedCount: result.count }, 'Cleaned up old confirmed transactions');
  }
}

export const transactionTracker = new TransactionTracker();

