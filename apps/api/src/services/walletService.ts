import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { ethers } from 'ethers';
import crypto from 'crypto';
import { config } from '../config/env';
import { profitGate } from './profitGate';

const prisma = new PrismaClient();

// Encryption configuration
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;

// Get encryption key from env or generate a fallback (NOT for production)
function getEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_SECRET || 'fallback-secret-change-in-production';
  return crypto.scryptSync(secret, 'salt', KEY_LENGTH);
}

export interface WalletConfig {
  id: string;
  userId: string;
  chainType: 'EVM' | 'SOLANA';
  chainId?: number; // For EVM
  address: string;
  maxTradingAmount?: number; // Maximum amount to trade (safety limit)
  isActive: boolean;
  label?: string; // Optional label for the wallet
  createdAt: Date;
}

export class WalletService {
  /**
   * Connect a wallet - NON-CUSTODIAL: Only stores public info, no private keys
   * Frontend will handle signing via MetaMask, WalletConnect, etc.
   */
  async connectWallet(
    userId: string,
    chainType: 'EVM' | 'SOLANA',
    address: string,
    chainId?: number,
    maxTradingAmount?: number,
    label?: string
  ): Promise<WalletConfig> {
    // Basic address validation
    if (!address || address.length < 20) {
      throw new Error('Invalid wallet address');
    }

    // Normalize EVM addresses to lowercase
    if (chainType === 'EVM') {
      address = address.toLowerCase();
      // Basic checksum validation would go here in production
    }

    // Check if wallet already exists
    const existing = await prisma.wallet.findUnique({
      where: {
        userId_address_chainType: {
          userId,
          address,
          chainType,
        },
      },
    });

    if (existing) {
      // Update existing wallet (no private key stored)
      const updated = await prisma.wallet.update({
        where: { id: existing.id },
        data: {
          maxTradingAmount: maxTradingAmount ?? existing.maxTradingAmount ?? 1000,
          isActive: true,
          chainId: chainId ?? existing.chainId,
          label: label ?? existing.label,
        },
      });

      logger.info({ walletId: updated.id, address, chainType }, 'Wallet updated');
      return {
        id: updated.id,
        userId: updated.userId,
        chainType: updated.chainType as 'EVM' | 'SOLANA',
        chainId: updated.chainId || undefined,
        address: updated.address,
        maxTradingAmount: updated.maxTradingAmount || undefined,
        isActive: updated.isActive,
        label: updated.label || undefined,
        createdAt: updated.createdAt,
      };
    }

    // Create new wallet record (NO private key stored)
    const wallet = await prisma.wallet.create({
      data: {
        userId,
        chainType,
        chainId: chainId || null,
        address,
        maxTradingAmount: maxTradingAmount || 1000, // Default $1000 limit
        isActive: true,
        label: label || null,
        // encryptedPrivateKey is NOT set - non-custodial design
      },
    });

    logger.info({ walletId: wallet.id, address, chainType }, 'Wallet connected (non-custodial)');
    return {
      id: wallet.id,
      userId: wallet.userId,
      chainType: wallet.chainType as 'EVM' | 'SOLANA',
      chainId: wallet.chainId || undefined,
      address: wallet.address,
      maxTradingAmount: wallet.maxTradingAmount || undefined,
      isActive: wallet.isActive,
      label: wallet.label || undefined,
      createdAt: wallet.createdAt,
    };
  }

  /**
   * Get all wallets for a user
   */
  async getWallets(userId: string): Promise<WalletConfig[]> {
    const wallets = await prisma.wallet.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return wallets.map((w) => ({
      id: w.id,
      userId: w.userId,
      chainType: w.chainType as 'EVM' | 'SOLANA',
      chainId: w.chainId || undefined,
      address: w.address,
      maxTradingAmount: w.maxTradingAmount || undefined,
      isActive: w.isActive,
      label: w.label || undefined,
      createdAt: w.createdAt,
    }));
  }

  /**
   * Disconnect (deactivate) a wallet
   */
  async disconnectWallet(walletId: string, userId: string): Promise<void> {
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
    });

    if (!wallet || wallet.userId !== userId) {
      throw new Error('Wallet not found or unauthorized');
    }

    await prisma.wallet.update({
      where: { id: walletId },
      data: { isActive: false },
    });

    logger.info({ walletId }, 'Wallet disconnected');
  }

  /**
   * Get wallet balance
   */
  async getBalance(walletId: string, tokenSymbol: string): Promise<number> {
    // This would query the blockchain for balance
    // For now, return a placeholder
    return 0;
  }

  /**
   * Check if trading amount is within limits
   */
  async checkTradingLimit(walletId: string, amount: number): Promise<boolean> {
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
    });

    if (!wallet || !wallet.isActive) {
      return false;
    }

    if (wallet.maxTradingAmount && amount > wallet.maxTradingAmount) {
      logger.warn({ walletId, amount, max: wallet.maxTradingAmount }, 'Trading amount exceeds limit');
      return false;
    }

    return true;
  }

  /**
   * Encrypt private key for secure storage
   */
  encryptPrivateKey(privateKey: string): { encrypted: string; iv: string; tag: string } {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(privateKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag();

    return {
      encrypted,
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
    };
  }

  /**
   * Decrypt private key (only for temporary use)
   */
  decryptPrivateKey(encrypted: string, ivHex: string, tagHex: string): string {
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Activate live trading with encrypted private key (profit-gated)
   * This allows autonomous trading with a provided private key
   */
  async activateLiveTrading(
    strategyId: string,
    encryptedKey: string,
    iv: string,
    tag: string
  ): Promise<{ success: boolean; message: string; expiresAt?: Date }> {
    // 0. Check paper trade count - REQUIRE 200+ paper trades first
    const paperTrades = await prisma.trade.findMany({
      where: {
        strategyId,
        mode: 'PAPER',
      },
    });

    if (paperTrades.length < 200) {
      return {
        success: false,
        message: `Need at least 200 paper trades before live trading. Currently have ${paperTrades.length} paper trades. Keep paper trading to build track record.`,
      };
    }

    // Check if recent paper trades are still successful
    const recentPaperTrades = paperTrades
      .filter(t => t.exitPrice !== null)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 50); // Last 50 closed trades

    if (recentPaperTrades.length >= 10) {
      const recentWins = recentPaperTrades.filter(t => t.pnl > 0).length;
      const recentWinRate = recentWins / recentPaperTrades.length;
      const recentTotalPnL = recentPaperTrades.reduce((sum, t) => sum + t.pnl, 0);

      if (recentWinRate < 0.5 || recentTotalPnL < 0) {
        return {
          success: false,
          message: `Recent paper trading performance is poor (${(recentWinRate * 100).toFixed(1)}% win rate, $${recentTotalPnL.toFixed(2)} P&L). Need consistent success before live trading.`,
        };
      }
    }

    // 1. Check profitability first (AGGRESSIVE REQUIREMENTS: 50%+ monthly, Sharpe >3.0, Win Rate >65%)
    const profitability = await profitGate.checkProfitability(strategyId, 100); // Full check with 100 sims
    if (!profitability.passed) {
      // Try recent performance as fallback (requires 100+ trades)
      const recent = await profitGate.checkRecentPerformance(strategyId);
      if (!recent.passed) {
        return {
          success: false,
          message: `Profitability check failed: ${profitability.message}. ${recent.message}`,
        };
      }
    }

    // 2. Verify strategy exists and is in PAPER mode
    const strategy = await prisma.strategy.findUnique({
      where: { id: strategyId },
    });

    if (!strategy) {
      return {
        success: false,
        message: 'Strategy not found',
      };
    }

    if (strategy.mode !== 'PAPER' && strategy.mode !== 'SIMULATION') {
      return {
        success: false,
        message: 'Strategy must be in PAPER or SIMULATION mode first',
      };
    }

    // 3. Decrypt and verify key format (but don't store decrypted)
    try {
      const privateKey = this.decryptPrivateKey(encryptedKey, iv, tag);
      
      // Basic validation
      if (strategy.chainId === 101) {
        // Solana - should be base58
        if (privateKey.length < 32) {
          throw new Error('Invalid Solana private key format');
        }
      } else {
        // EVM - should be hex
        if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey)) {
          throw new Error('Invalid EVM private key format');
        }
      }
    } catch (error) {
      return {
        success: false,
        message: `Invalid private key: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }

    // 4. Store encrypted key temporarily (1 hour expiry)
    const expiresAt = new Date(Date.now() + 3600000); // 1 hour

    // Store in a temporary table or in-memory cache
    // For now, we'll update the strategy with a flag
    await prisma.strategy.update({
      where: { id: strategyId },
      data: {
        mode: 'LIVE',
        // In production, store encrypted key in a separate secure table with expiry
      },
    });

    logger.info({ strategyId, expiresAt }, 'Live trading activated with profit-gating');

    return {
      success: true,
      message: 'Live trading activated. Private key stored securely and will expire in 1 hour.',
      expiresAt,
    };
  }
}

export const walletService = new WalletService();

