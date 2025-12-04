import { TransactionTracker } from './transactionTracker';
import { PrismaClient } from '@prisma/client';

// Mock Prisma
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    transaction: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  })),
}));
jest.mock('../config/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock getChainConfig
jest.mock('@matcha-ai/shared', () => ({
  ...jest.requireActual('@matcha-ai/shared'),
  getChainConfig: jest.fn((chainId: number) => {
    if (chainId === 1) {
      return {
        chainId: 1,
        name: 'Ethereum',
        rpcUrl: 'https://eth.llamarpc.com',
        zeroXApiUrl: 'https://api.0x.org',
      };
    }
    return null;
  }),
}));

// Mock ethers
jest.mock('ethers', () => ({
  JsonRpcProvider: jest.fn().mockImplementation(() => ({
    getTransactionReceipt: jest.fn(),
    getTransaction: jest.fn(),
  })),
}));

describe('TransactionTracker', () => {
  let transactionTracker: TransactionTracker;
  let mockPrisma: any;

  beforeEach(() => {
    transactionTracker = new TransactionTracker();
    mockPrisma = (PrismaClient as jest.Mock).mock.results[0].value;
    jest.clearAllMocks();
  });

  describe('startTracking', () => {
    it('should create transaction record and start tracking', async () => {
      mockPrisma.transaction.upsert.mockResolvedValue({
        txHash: '0x123',
        chainId: 1,
        status: 'PENDING',
      });

      await transactionTracker.startTracking('0x123', 1, 'trade-id');

      expect(mockPrisma.transaction.upsert).toHaveBeenCalledWith({
        where: { txHash: '0x123' },
        create: {
          txHash: '0x123',
          chainId: 1,
          status: 'PENDING',
          tradeId: 'trade-id',
          submittedAt: expect.any(Date),
        },
        update: {
          status: 'PENDING',
          tradeId: 'trade-id',
        },
      });
    });
  });

  describe('checkTransactionStatus', () => {
    it('should return PENDING if transaction not yet mined', async () => {
      const mockProvider = require('ethers').JsonRpcProvider.mock.results[0].value;
      mockProvider.getTransactionReceipt.mockResolvedValue(null);

      const status = await transactionTracker.checkTransactionStatus('0x123', 1);

      expect(status).toBe('PENDING');
    });

    it('should return CONFIRMED if transaction succeeded', async () => {
      const mockProvider = require('ethers').JsonRpcProvider.mock.results[0].value;
      const mockTx = {
        gasPrice: BigInt('20000000000'),
      };

      mockProvider.getTransactionReceipt.mockResolvedValue({
        status: 1, // Success
        blockNumber: 12345,
        gasUsed: BigInt('21000'),
      });
      mockProvider.getTransaction.mockResolvedValue(mockTx);

      mockPrisma.transaction.update.mockResolvedValue({});

      const status = await transactionTracker.checkTransactionStatus('0x123', 1);

      expect(status).toBe('CONFIRMED');
      expect(mockPrisma.transaction.update).toHaveBeenCalledWith({
        where: { txHash: '0x123' },
        data: expect.objectContaining({
          status: 'CONFIRMED',
          blockNumber: 12345,
        }),
      });
    });

    it('should return REVERTED if transaction failed', async () => {
      const mockProvider = require('ethers').JsonRpcProvider.mock.results[0].value;
      const mockTx = {
        gasPrice: BigInt('20000000000'),
      };

      mockProvider.getTransactionReceipt.mockResolvedValue({
        status: 0, // Failed
        blockNumber: 12345,
        gasUsed: BigInt('21000'),
      });
      mockProvider.getTransaction.mockResolvedValue(mockTx);

      mockPrisma.transaction.update.mockResolvedValue({});

      const status = await transactionTracker.checkTransactionStatus('0x123', 1);

      expect(status).toBe('REVERTED');
      expect(mockPrisma.transaction.update).toHaveBeenCalledWith({
        where: { txHash: '0x123' },
        data: expect.objectContaining({
          status: 'REVERTED',
          failedAt: expect.any(Date),
          failureReason: 'Transaction reverted',
        }),
      });
    });
  });

  describe('markAsFailed', () => {
    it('should mark transaction as failed with reason', async () => {
      mockPrisma.transaction.update.mockResolvedValue({});

      await transactionTracker.markAsFailed('0x123', 'Insufficient gas');

      expect(mockPrisma.transaction.update).toHaveBeenCalledWith({
        where: { txHash: '0x123' },
        data: {
          status: 'FAILED',
          failedAt: expect.any(Date),
          failureReason: 'Insufficient gas',
        },
      });
    });
  });

  describe('getPendingTransactions', () => {
    it('should return all pending transactions', async () => {
      const mockTxs = [
        {
          txHash: '0x123',
          chainId: 1,
          status: 'PENDING',
          submittedAt: new Date(),
        },
        {
          txHash: '0x456',
          chainId: 1,
          status: 'PENDING',
          submittedAt: new Date(),
        },
      ];

      mockPrisma.transaction.findMany.mockResolvedValue(mockTxs);

      const result = await transactionTracker.getPendingTransactions();

      expect(result).toHaveLength(2);
      expect(result[0].txHash).toBe('0x123');
      expect(mockPrisma.transaction.findMany).toHaveBeenCalledWith({
        where: { status: 'PENDING' },
        orderBy: { submittedAt: 'desc' },
      });
    });
  });
});

