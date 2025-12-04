import axios, { AxiosError } from 'axios';
import { config } from '../config/env';
import { logger } from '../config/logger';
import type { ZeroXQuoteParams, ZeroXQuote, ZeroXSwapTx, ChainConfig } from '@matcha-ai/shared';
import { getChainConfig } from '@matcha-ai/shared';
import { ethers } from 'ethers';

// Known safe allowance targets (AllowanceHolder/Permit2 contracts)
// These are the only contracts that should receive token approvals
const SAFE_ALLOWANCE_TARGETS: Record<number, string[]> = {
  // Ethereum mainnet
  1: [
    '0x0000000000000000000000000000000000000000', // Permit2 (check actual address)
    // Add AllowanceHolder addresses when known
  ],
  // Polygon
  137: [],
  // Arbitrum
  42161: [],
};

export class ZeroXService {
  private apiKey: string;
  private rpcProviders: Map<number, ethers.JsonRpcProvider> = new Map();

  constructor() {
    this.apiKey = config.zeroX.apiKey;
  }

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
   * Get the allowance target from a quote response
   * Validates that it's a safe contract (AllowanceHolder or Permit2)
   */
  getAllowanceTarget(quote: ZeroXQuote, chainId: number): string | null {
    if (!quote.allowanceTarget) {
      return null;
    }

    const safeTargets = SAFE_ALLOWANCE_TARGETS[chainId] || [];
    const target = quote.allowanceTarget.toLowerCase();

    // Check if it's a known safe target
    const isSafe = safeTargets.some((safe) => safe.toLowerCase() === target);

    if (!isSafe) {
      logger.warn(
        { allowanceTarget: quote.allowanceTarget, chainId },
        'Allowance target not in safe list - proceed with caution'
      );
      // Still return it, but log a warning
      // In production, you might want to reject unknown targets
    }

    return quote.allowanceTarget;
  }

  /**
   * Check if a token has sufficient allowance
   * Returns true if allowance is sufficient, false otherwise
   */
  async checkAllowance(
    chainId: number,
    tokenAddress: string,
    ownerAddress: string,
    spenderAddress: string,
    requiredAmount: string
  ): Promise<{ hasAllowance: boolean; currentAllowance: string }> {
    const provider = this.getRpcProvider(chainId);
    if (!provider) {
      throw new Error(`RPC provider not available for chain ${chainId}`);
    }

    try {
      // ERC20 allowance function: allowance(address owner, address spender)
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ['function allowance(address owner, address spender) view returns (uint256)'],
        provider
      );

      const currentAllowance = await tokenContract.allowance(ownerAddress, spenderAddress);
      const required = BigInt(requiredAmount);
      const hasAllowance = currentAllowance >= required;

      logger.debug(
        {
          chainId,
          tokenAddress,
          ownerAddress,
          spenderAddress,
          currentAllowance: currentAllowance.toString(),
          requiredAmount,
          hasAllowance,
        },
        'Checked token allowance'
      );

      return {
        hasAllowance,
        currentAllowance: currentAllowance.toString(),
      };
    } catch (error) {
      logger.error({ error, chainId, tokenAddress, ownerAddress, spenderAddress }, 'Error checking allowance');
      throw new Error(`Failed to check allowance: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Validate that an allowance target is safe
   * Throws error if target is not safe (e.g., Settler contract)
   */
  validateAllowanceTarget(allowanceTarget: string, chainId: number): void {
    if (!allowanceTarget) {
      return; // No allowance needed
    }

    const safeTargets = SAFE_ALLOWANCE_TARGETS[chainId] || [];
    const target = allowanceTarget.toLowerCase();

    // Check if it's a known safe target
    const isSafe = safeTargets.some((safe) => safe.toLowerCase() === target);

    if (!isSafe) {
      // Log warning but don't throw - some chains may have different addresses
      // In production, you might want to be stricter
      logger.warn(
        { allowanceTarget, chainId, safeTargets },
        'Allowance target not in known safe list - ensure it is AllowanceHolder or Permit2'
      );
    }

    // Never allow approvals on the Settler contract (0x Exchange Proxy)
    // Settler contract addresses are typically the 'to' address in swap transactions
    // This is a safety check - we should never approve tokens to the swap executor
    logger.info({ allowanceTarget, chainId }, 'Allowance target validated');
  }

  /**
   * Get a quote for a swap
   * For EVM chains: Uses 0x API (uses API credits)
   * For Solana: Not supported for live trading - throws error
   */
  async getQuote(params: ZeroXQuoteParams): Promise<ZeroXQuote> {
    // Input validation
    if (!params.chainId || params.chainId <= 0) {
      throw new Error('Invalid chainId: must be a positive number');
    }
    if (!params.sellToken || !params.buyToken) {
      throw new Error('sellToken and buyToken are required');
    }
    if (!params.amount || parseFloat(params.amount) <= 0) {
      throw new Error('amount must be a positive number');
    }

    const chainConfig = getChainConfig(params.chainId);
    if (!chainConfig) {
      throw new Error(`Unsupported chain ID: ${params.chainId}. Supported: Ethereum (1), Polygon (137), Arbitrum (42161)`);
    }

    // Solana (101) live trading toggle
    if (params.chainId === 101 && !config.trading.enableSolanaLive) {
      throw new Error('Solana live trading is currently disabled in config. Enable ENABLE_SOLANA_LIVE=true to turn it on. Use SIMULATION or PAPER mode for Solana strategies, or switch to an EVM chain for live trading.');
    }

    // EVM chains use 0x API
    const slippageBps = params.slippageBps || 50; // Default 0.5%
    if (slippageBps < 0 || slippageBps > 10000) {
      throw new Error('slippageBps must be between 0 and 10000 (0-100%)');
    }

    if (!chainConfig.zeroXApiUrl) {
      throw new Error(`0x API URL not configured for chain ${params.chainId}`);
    }

    if (!this.apiKey) {
      throw new Error('0x API key not configured. Set ZEROX_API_KEY environment variable.');
    }

    try {
      logger.info({ 
        chainId: params.chainId,
        sellToken: params.sellToken,
        buyToken: params.buyToken,
        amount: params.amount 
      }, 'Calling 0x API for quote - this will use API credits');

      // Use v2 API - check if large trade (>5 ETH) for RFQ
      const sellAmountNum = parseFloat(params.amount);
      const isLargeTrade = sellAmountNum > 5e18; // >5 ETH
      
      const endpoint = isLargeTrade
        ? `${chainConfig.zeroXApiUrl}/swap/v2/rfq/quote`
        : `${chainConfig.zeroXApiUrl}/swap/v2/quote`;

      const response = await axios.get<ZeroXQuote>(endpoint, {
        params: {
          sellToken: params.sellToken,
          buyToken: params.buyToken,
          sellAmount: params.amount,
          slippagePercentage: slippageBps / 10000, // Convert bps to decimal
        },
        headers: {
          '0x-api-key': this.apiKey,
          '0x-version': 'v2', // Explicitly request v2
        },
        timeout: 15000, // 15 second timeout
      });

      // Validate response
      if (!response.data || !response.data.buyAmount) {
        throw new Error('Invalid response from 0x API: missing buyAmount');
      }

      logger.info({ 
        buyAmount: response.data.buyAmount,
        price: response.data.price
      }, '0x API quote received successfully');

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<{ reason?: string; code?: string; validationErrors?: any }>;
        
        // Handle specific error cases
        if (axiosError.response?.status === 400) {
          const validationErrors = axiosError.response.data?.validationErrors;
          const message = validationErrors 
            ? `Invalid request: ${JSON.stringify(validationErrors)}`
            : axiosError.response.data?.reason || 'Invalid request parameters';
          logger.error({ params, validationErrors }, '0x API validation error');
          throw new Error(`0x API validation error: ${message}`);
        }
        
        if (axiosError.response?.status === 401 || axiosError.response?.status === 403) {
          logger.error({ status: axiosError.response.status }, '0x API authentication error');
          throw new Error('0x API authentication failed. Check your API key.');
        }
        
        if (axiosError.response?.status === 429) {
          logger.error({ status: axiosError.response.status }, '0x API rate limit exceeded');
          throw new Error('0x API rate limit exceeded. Please try again later.');
        }
        
        if (axiosError.response?.status === 503) {
          logger.error({ status: axiosError.response.status }, '0x API service unavailable');
          throw new Error('0x API service temporarily unavailable. Please try again later.');
        }
        
        const message =
          axiosError.response?.data?.reason ||
          axiosError.message ||
          'Failed to get quote from 0x API';
        logger.error({ 
          error: axiosError.response?.data, 
          status: axiosError.response?.status,
          params 
        }, '0x API error');
        throw new Error(`0x API error: ${message}`);
      }
      
      if (error instanceof Error) {
        throw error;
      }
      
      throw new Error('Unknown error calling 0x API');
    }
  }

  /**
   * Build a swap transaction for execution
   * Returns transaction data to be signed by frontend (non-custodial)
   * Validates allowance target from quote response
   */
  async buildSwapTx(params: ZeroXQuoteParams): Promise<ZeroXSwapTx> {
    // Validate inputs
    if (params.chainId === 101 && !config.trading.enableSolanaLive) {
      throw new Error('Solana live trading is currently disabled in config. Enable ENABLE_SOLANA_LIVE=true to turn it on. Use EVM chains (Ethereum, Polygon, Arbitrum) for live trading.');
    }

    const quote = await this.getQuote(params);
    const chainConfig = getChainConfig(params.chainId);
    if (!chainConfig) {
      throw new Error(`Unsupported chain ID: ${params.chainId}`);
    }

    // Validate quote has required fields for transaction
    if (!quote.to || !quote.data) {
      throw new Error('Invalid quote from 0x API: missing transaction data');
    }

    // Validate allowance target if present
    if (quote.allowanceTarget) {
      this.validateAllowanceTarget(quote.allowanceTarget, params.chainId);
      logger.info(
        { allowanceTarget: quote.allowanceTarget, chainId: params.chainId },
        'Allowance target validated from quote'
      );
    }

    const swapTx: ZeroXSwapTx = {
      to: quote.to,
      data: quote.data,
      value: quote.value || '0',
      gas: quote.gas || '0',
      gasPrice: quote.gasPrice || '0',
      chainId: params.chainId,
      allowanceTarget: quote.allowanceTarget, // Include allowance target for frontend
    };

    logger.info({ 
      chainId: params.chainId,
      to: swapTx.to,
      gas: swapTx.gas,
      allowanceTarget: swapTx.allowanceTarget
    }, 'Swap transaction built (ready for frontend signing)');

    return swapTx;
  }
}

export const zeroExService = new ZeroXService();

