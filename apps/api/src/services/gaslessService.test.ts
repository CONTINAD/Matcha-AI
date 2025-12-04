import { GaslessService } from './gaslessService';
import type { GaslessQuoteParams } from '@matcha-ai/shared';

// Mock axios
jest.mock('axios');
jest.mock('../config/env', () => ({
  config: {
    zeroX: {
      apiKey: 'test-api-key',
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

describe('GaslessService', () => {
  let gaslessService: GaslessService;
  const mockAxios = require('axios');

  beforeEach(() => {
    gaslessService = new GaslessService();
    jest.clearAllMocks();
  });

  describe('getIndicativePrice', () => {
    it('should throw error if takerAddress is missing', async () => {
      const params = {
        chainId: 1,
        sellToken: '0xTokenA',
        buyToken: '0xTokenB',
        amount: '1000000000000000000',
        // takerAddress missing
      } as any;

      await expect(gaslessService.getIndicativePrice(params as GaslessQuoteParams)).rejects.toThrow('takerAddress is required');
    });

    it('should call 0x Gasless API for indicative price', async () => {
      const mockResponse = {
        data: {
          price: '1.0',
          buyAmount: '1000000000000000000',
          sellAmount: '1000000000000000000',
          estimatedPriceImpact: '0.01',
        },
      };

      mockAxios.get.mockResolvedValue(mockResponse);

      const params: GaslessQuoteParams = {
        chainId: 1,
        sellToken: '0xTokenA',
        buyToken: '0xTokenB',
        amount: '1000000000000000000',
        takerAddress: '0xTakerAddress',
      };

      const result = await gaslessService.getIndicativePrice(params);

      expect(result.price).toBe('1.0');
      expect(result.buyAmount).toBe('1000000000000000000');
      expect(mockAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('/swap/allowance-holder/price'),
        expect.objectContaining({
          params: expect.objectContaining({
            takerAddress: '0xTakerAddress',
          }),
        })
      );
    });
  });

  describe('getFirmQuote', () => {
    it('should throw error if takerAddress is missing', async () => {
      const params = {
        chainId: 1,
        sellToken: '0xTokenA',
        buyToken: '0xTokenB',
        amount: '1000000000000000000',
      } as any;

      await expect(gaslessService.getFirmQuote(params as GaslessQuoteParams)).rejects.toThrow('takerAddress is required');
    });

    it('should call 0x Gasless API for firm quote with meta-transaction', async () => {
      const mockResponse = {
        data: {
          price: '1.0',
          guaranteedPrice: '0.99',
          estimatedPriceImpact: '0.01',
          buyAmount: '1000000000000000000',
          sellAmount: '1000000000000000000',
          to: '0xExchangeProxy',
          data: '0x1234',
          value: '0',
          metaTransaction: {
            to: '0xMetaTransactionTarget',
            data: '0x5678',
            value: '0',
          },
        },
      };

      mockAxios.get.mockResolvedValue(mockResponse);

      const params: GaslessQuoteParams = {
        chainId: 1,
        sellToken: '0xTokenA',
        buyToken: '0xTokenB',
        amount: '1000000000000000000',
        takerAddress: '0xTakerAddress',
      };

      const result = await gaslessService.getFirmQuote(params);

      expect(result.price).toBe('1.0');
      expect(result.metaTransaction).toBeDefined();
      expect(result.metaTransaction?.to).toBe('0xMetaTransactionTarget');
      expect(mockAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('/swap/allowance-holder/quote'),
        expect.objectContaining({
          params: expect.objectContaining({
            takerAddress: '0xTakerAddress',
          }),
        })
      );
    });
  });

  describe('buildGaslessSwapTx', () => {
    it('should build gasless swap transaction with meta-transaction data', async () => {
      const mockResponse = {
        data: {
          price: '1.0',
          guaranteedPrice: '0.99',
          estimatedPriceImpact: '0.01',
          buyAmount: '1000000000000000000',
          sellAmount: '1000000000000000000',
          to: '0xExchangeProxy',
          data: '0x1234',
          value: '0',
          gas: '200000',
          gasPrice: '20000000000',
          allowanceTarget: '0xAllowanceHolder',
          metaTransaction: {
            to: '0xMetaTransactionTarget',
            data: '0x5678',
            value: '0',
          },
        },
      };

      mockAxios.get.mockResolvedValue(mockResponse);

      const params: GaslessQuoteParams = {
        chainId: 1,
        sellToken: '0xTokenA',
        buyToken: '0xTokenB',
        amount: '1000000000000000000',
        takerAddress: '0xTakerAddress',
      };

      const result = await gaslessService.buildGaslessSwapTx(params);

      expect(result.to).toBe('0xMetaTransactionTarget');
      expect(result.data).toBe('0x5678');
      expect(result.chainId).toBe(1);
      expect(result.allowanceTarget).toBe('0xAllowanceHolder');
    });
  });
});

