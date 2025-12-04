import { ZeroXService } from './zeroExService';
import type { ZeroXQuote } from '@matcha-ai/shared';

// Mock axios
jest.mock('axios');
jest.mock('../config/env', () => ({
  config: {
    zeroX: {
      apiKey: 'test-api-key',
    },
    trading: {
      enableSolanaLive: false,
    },
    logging: {
      level: 'info',
    },
    server: {
      nodeEnv: 'test',
    },
  },
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

describe('ZeroXService', () => {
  let zeroExService: ZeroXService;
  const mockAxios = require('axios');

  beforeEach(() => {
    zeroExService = new ZeroXService();
    jest.clearAllMocks();
  });

  describe('getAllowanceTarget', () => {
    it('should return allowance target from quote', () => {
      const quote: ZeroXQuote = {
        price: '1.0',
        guaranteedPrice: '0.99',
        estimatedPriceImpact: '0.01',
        buyAmount: '1000000000000000000',
        sellAmount: '1000000000000000000',
        allowanceTarget: '0x1234567890123456789012345678901234567890',
        to: '0x0000000000000000000000000000000000000000',
        data: '0x',
        value: '0',
      };

      const target = zeroExService.getAllowanceTarget(quote, 1);
      expect(target).toBe('0x1234567890123456789012345678901234567890');
    });

    it('should return null if no allowance target', () => {
      const quote: ZeroXQuote = {
        price: '1.0',
        guaranteedPrice: '0.99',
        estimatedPriceImpact: '0.01',
        buyAmount: '1000000000000000000',
        sellAmount: '1000000000000000000',
        to: '0x0000000000000000000000000000000000000000',
        data: '0x',
        value: '0',
      };

      const target = zeroExService.getAllowanceTarget(quote, 1);
      expect(target).toBeNull();
    });
  });

  describe('validateAllowanceTarget', () => {
    it('should not throw for valid allowance target', () => {
      expect(() => {
        zeroExService.validateAllowanceTarget('0x1234567890123456789012345678901234567890', 1);
      }).not.toThrow();
    });

    it('should not throw for null allowance target', () => {
      expect(() => {
        zeroExService.validateAllowanceTarget('', 1);
      }).not.toThrow();
    });
  });

  describe('checkAllowance', () => {
    it('should have checkAllowance method defined', () => {
      expect(typeof zeroExService.checkAllowance).toBe('function');
    });

    // Note: Full integration test of checkAllowance requires real RPC connection
    // This would be tested in integration tests with testnet
  });
});

