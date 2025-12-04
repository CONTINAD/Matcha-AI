import axios, { AxiosError } from 'axios';
import { config } from '../config/env';
import { logger } from '../config/logger';
import type { ZeroXQuote, ZeroXSwapTx, ChainConfig } from '@matcha-ai/shared';
import type { GaslessQuoteParams } from '@matcha-ai/shared';
import { getChainConfig } from '@matcha-ai/shared';

export interface GaslessPriceResponse {
  price: string;
  buyAmount: string;
  sellAmount: string;
  estimatedPriceImpact: string;
}

export interface GaslessQuoteResponse extends ZeroXQuote {
  metaTransaction: {
    to: string;
    data: string;
    value: string;
  };
}

export class GaslessService {
  private apiKey: string;

  constructor() {
    this.apiKey = config.zeroX.apiKey;
  }

  /**
   * Get indicative price for a gasless swap
   * Uses /swap/allowance-holder/price endpoint
   */
  async getIndicativePrice(params: GaslessQuoteParams): Promise<GaslessPriceResponse> {
    if (!params.takerAddress) {
      throw new Error('takerAddress is required for gasless quotes');
    }

    const chainConfig = getChainConfig(params.chainId);
    if (!chainConfig) {
      throw new Error(`Unsupported chain ID: ${params.chainId}`);
    }

    if (!chainConfig.zeroXApiUrl) {
      throw new Error(`0x API URL not configured for chain ${params.chainId}`);
    }

    if (!this.apiKey) {
      throw new Error('0x API key not configured. Set ZEROX_API_KEY environment variable.');
    }

    const slippageBps = params.slippageBps || 50; // Default 0.5%

    try {
      logger.info(
        {
          chainId: params.chainId,
          sellToken: params.sellToken,
          buyToken: params.buyToken,
          amount: params.amount,
          takerAddress: params.takerAddress,
        },
        'Getting indicative price from 0x Gasless API'
      );

      const endpoint = `${chainConfig.zeroXApiUrl}/swap/allowance-holder/price`;

      const response = await axios.get<GaslessPriceResponse>(endpoint, {
        params: {
          sellToken: params.sellToken,
          buyToken: params.buyToken,
          sellAmount: params.amount,
          slippagePercentage: slippageBps / 10000,
          takerAddress: params.takerAddress,
        },
        headers: {
          '0x-api-key': this.apiKey,
          '0x-version': 'v2',
        },
        timeout: 15000,
      });

      if (!response.data || !response.data.price) {
        throw new Error('Invalid response from 0x Gasless API: missing price');
      }

      logger.info(
        {
          price: response.data.price,
          buyAmount: response.data.buyAmount,
          estimatedPriceImpact: response.data.estimatedPriceImpact,
        },
        'Indicative price received from 0x Gasless API'
      );

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<{ reason?: string; code?: string; validationErrors?: any }>;

        if (axiosError.response?.status === 400) {
          const validationErrors = axiosError.response.data?.validationErrors;
          const message = validationErrors
            ? `Invalid request: ${JSON.stringify(validationErrors)}`
            : axiosError.response.data?.reason || 'Invalid request parameters';
          logger.error({ params, validationErrors }, '0x Gasless API validation error');
          throw new Error(`0x Gasless API validation error: ${message}`);
        }

        if (axiosError.response?.status === 401 || axiosError.response?.status === 403) {
          logger.error({ status: axiosError.response.status }, '0x Gasless API authentication error');
          throw new Error('0x Gasless API authentication failed. Check your API key.');
        }

        const message =
          axiosError.response?.data?.reason ||
          axiosError.message ||
          'Failed to get indicative price from 0x Gasless API';
        logger.error(
          {
            error: axiosError.response?.data,
            status: axiosError.response?.status,
            params,
          },
          '0x Gasless API error'
        );
        throw new Error(`0x Gasless API error: ${message}`);
      }

      if (error instanceof Error) {
        throw error;
      }

      throw new Error('Unknown error calling 0x Gasless API');
    }
  }

  /**
   * Get firm quote for a gasless swap
   * Uses /swap/allowance-holder/quote endpoint
   */
  async getFirmQuote(params: GaslessQuoteParams): Promise<GaslessQuoteResponse> {
    if (!params.takerAddress) {
      throw new Error('takerAddress is required for gasless quotes');
    }

    const chainConfig = getChainConfig(params.chainId);
    if (!chainConfig) {
      throw new Error(`Unsupported chain ID: ${params.chainId}`);
    }

    if (!chainConfig.zeroXApiUrl) {
      throw new Error(`0x API URL not configured for chain ${params.chainId}`);
    }

    if (!this.apiKey) {
      throw new Error('0x API key not configured. Set ZEROX_API_KEY environment variable.');
    }

    const slippageBps = params.slippageBps || 50; // Default 0.5%

    try {
      logger.info(
        {
          chainId: params.chainId,
          sellToken: params.sellToken,
          buyToken: params.buyToken,
          amount: params.amount,
          takerAddress: params.takerAddress,
        },
        'Getting firm quote from 0x Gasless API'
      );

      const endpoint = `${chainConfig.zeroXApiUrl}/swap/allowance-holder/quote`;

      const response = await axios.get<GaslessQuoteResponse>(endpoint, {
        params: {
          sellToken: params.sellToken,
          buyToken: params.buyToken,
          sellAmount: params.amount,
          slippagePercentage: slippageBps / 10000,
          takerAddress: params.takerAddress,
        },
        headers: {
          '0x-api-key': this.apiKey,
          '0x-version': 'v2',
        },
        timeout: 15000,
      });

      if (!response.data || !response.data.buyAmount) {
        throw new Error('Invalid response from 0x Gasless API: missing buyAmount');
      }

      if (!response.data.metaTransaction) {
        throw new Error('Invalid response from 0x Gasless API: missing metaTransaction');
      }

      logger.info(
        {
          buyAmount: response.data.buyAmount,
          price: response.data.price,
          hasMetaTransaction: !!response.data.metaTransaction,
        },
        'Firm quote received from 0x Gasless API'
      );

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<{ reason?: string; code?: string; validationErrors?: any }>;

        if (axiosError.response?.status === 400) {
          const validationErrors = axiosError.response.data?.validationErrors;
          const message = validationErrors
            ? `Invalid request: ${JSON.stringify(validationErrors)}`
            : axiosError.response.data?.reason || 'Invalid request parameters';
          logger.error({ params, validationErrors }, '0x Gasless API validation error');
          throw new Error(`0x Gasless API validation error: ${message}`);
        }

        if (axiosError.response?.status === 401 || axiosError.response?.status === 403) {
          logger.error({ status: axiosError.response.status }, '0x Gasless API authentication error');
          throw new Error('0x Gasless API authentication failed. Check your API key.');
        }

        const message =
          axiosError.response?.data?.reason ||
          axiosError.message ||
          'Failed to get firm quote from 0x Gasless API';
        logger.error(
          {
            error: axiosError.response?.data,
            status: axiosError.response?.status,
            params,
          },
          '0x Gasless API error'
        );
        throw new Error(`0x Gasless API error: ${message}`);
      }

      if (error instanceof Error) {
        throw error;
      }

      throw new Error('Unknown error calling 0x Gasless API');
    }
  }

  /**
   * Build a gasless swap transaction
   * Returns meta-transaction data for gasless execution
   */
  async buildGaslessSwapTx(params: GaslessQuoteParams): Promise<ZeroXSwapTx> {
    const quote = await this.getFirmQuote(params);
    const chainConfig = getChainConfig(params.chainId);
    if (!chainConfig) {
      throw new Error(`Unsupported chain ID: ${params.chainId}`);
    }

    if (!quote.metaTransaction) {
      throw new Error('Invalid quote from 0x Gasless API: missing metaTransaction');
    }

    // For gasless swaps, we use the meta-transaction data
    const swapTx: ZeroXSwapTx = {
      to: quote.metaTransaction.to,
      data: quote.metaTransaction.data,
      value: quote.metaTransaction.value,
      gas: quote.gas || '0',
      gasPrice: quote.gasPrice || '0',
      chainId: params.chainId,
      allowanceTarget: quote.allowanceTarget,
    };

    logger.info(
      {
        chainId: params.chainId,
        to: swapTx.to,
        isGasless: true,
        allowanceTarget: swapTx.allowanceTarget,
      },
      'Gasless swap transaction built'
    );

    return swapTx;
  }
}

export const gaslessService = new GaslessService();

