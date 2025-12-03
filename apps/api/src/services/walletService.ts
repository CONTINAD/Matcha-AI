import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { ethers } from 'ethers';

const prisma = new PrismaClient();

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
    // Get wallet config
    // Check maxTradingAmount
    return true; // Placeholder
  }
}

export const walletService = new WalletService();

