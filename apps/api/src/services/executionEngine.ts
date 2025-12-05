import type { ZeroXQuoteParams, ZeroXQuote, ZeroXSwapTx } from '@matcha-ai/shared';
import { zeroExService } from './zeroExService';
import { gaslessService } from './gaslessService';
import { logger } from '../config/logger';
import { getChainConfig } from '@matcha-ai/shared';
import { config } from '../config/env';
import { executionLatency, executionFallbacks } from './metrics';
import axios from 'axios';

export interface ExecutionResult {
  quote: ZeroXQuote;
  source: '0x-v2' | '0x-v1' | '0x-gasless' | 'direct-dex' | 'aggregator';
  latency: number;
  fallbackUsed: boolean;
}

export interface ExecutionOptions {
  enableGasless?: boolean;
  maxSlippageBps?: number;
  timeout?: number;
}

/**
 * Execution Engine with Fallback Routing
 * 
 * Provides resilient trade execution with multiple fallback routes:
 * 1. Primary: 0x API v2
 * 2. Fallback 1: 0x API v1
 * 3. Fallback 2: 0x Gasless API (if enabled)
 * 4. Fallback 3: Direct DEX calls (Uniswap, Sushiswap) - future
 * 5. Fallback 4: Aggregator comparison (1inch, Paraswap) - future
 */
export class ExecutionEngine {
  /**
   * Execute trade with fallback routing
   */
  async executeTrade(
    params: ZeroXQuoteParams,
    options: ExecutionOptions = {}
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const routes = this.buildRouteChain(params, options);
    
    let lastError: Error | null = null;
    let fallbackUsed = false;

    for (let i = 0; i < routes.length; i++) {
      const route = routes[i];
      try {
        logger.info(
          {
            route: route.name,
            attempt: i + 1,
            totalRoutes: routes.length,
            chainId: params.chainId,
            sellToken: params.sellToken,
            buyToken: params.buyToken,
          },
          `Attempting route: ${route.name}`
        );

        const quote = await route.execute(params);
        const latency = Date.now() - startTime;
        const latencySeconds = latency / 1000;

        if (i > 0) {
          fallbackUsed = true;
          executionFallbacks.inc({ fallback_type: route.name });
          logger.warn(
            {
              route: route.name,
              attempt: i + 1,
              latency,
              latencyMs: latency,
              fallbackType: route.name,
            },
            `Fallback route succeeded: ${route.name}`
          );
        } else {
          logger.info(
            {
              route: route.name,
              latency,
              latencyMs: latency,
              source: route.source,
            },
            `Primary route succeeded: ${route.name}`
          );
        }

        // Record metrics
        executionLatency.observe(
          { source: route.source, fallback_used: fallbackUsed ? 'true' : 'false' },
          latencySeconds
        );

        return {
          quote,
          source: route.source,
          latency,
          fallbackUsed,
        };
      } catch (error: any) {
        lastError = error;
        logger.warn(
          {
            route: route.name,
            attempt: i + 1,
            error: error.message,
            willTryFallback: i < routes.length - 1,
          },
          `Route ${route.name} failed, ${i < routes.length - 1 ? 'trying fallback' : 'no more fallbacks'}`
        );

        // If this is the last route, break and throw
        if (i === routes.length - 1) {
          break;
        }

        // Small delay before trying next route
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    // All routes failed
    const latency = Date.now() - startTime;
    logger.error(
      {
        chainId: params.chainId,
        sellToken: params.sellToken,
        buyToken: params.buyToken,
        attempts: routes.length,
        latency,
        lastError: lastError?.message,
      },
      'All execution routes failed'
    );

    throw new Error(
      `All execution routes failed after ${routes.length} attempts. Last error: ${lastError?.message || 'Unknown error'}`
    );
  }

  /**
   * Build chain of routes to try
   */
  private buildRouteChain(
    params: ZeroXQuoteParams,
    options: ExecutionOptions
  ): Array<{ name: string; source: ExecutionResult['source']; execute: (p: ZeroXQuoteParams) => Promise<ZeroXQuote> }> {
    const routes: Array<{
      name: string;
      source: ExecutionResult['source'];
      execute: (p: ZeroXQuoteParams) => Promise<ZeroXQuote>;
    }> = [];

    // Route 1: 0x API v2 (Primary)
    routes.push({
      name: '0x API v2',
      source: '0x-v2',
      execute: async (p) => {
        return await zeroExService.getQuote({
          ...p,
          // Ensure v2 endpoint is used
        });
      },
    });

    // Route 2: 0x API v1 (Fallback)
    routes.push({
      name: '0x API v1',
      source: '0x-v1',
      execute: async (p) => {
        // Try v1 endpoint by modifying the request
        // Note: zeroExService currently uses v2, so we'll need to add v1 support
        // For now, we'll try the same service but with different error handling
        const chainConfig = getChainConfig(p.chainId);
        if (!chainConfig?.zeroXApiUrl) {
          throw new Error('0x API URL not configured');
        }

        // Try v1 endpoint directly
        const response = await axios.get<ZeroXQuote>(
          `${chainConfig.zeroXApiUrl}/swap/v1/quote`,
          {
            params: {
              sellToken: p.sellToken,
              buyToken: p.buyToken,
              sellAmount: p.amount,
              slippagePercentage: (p.slippageBps || 50) / 10000,
            },
            headers: {
              '0x-api-key': config.zeroX.apiKey,
            },
            timeout: options.timeout || 15000,
          }
        );

        if (!response.data || !response.data.buyAmount) {
          throw new Error('Invalid response from 0x API v1');
        }

        return response.data;
      },
    });

    // Route 3: 0x Gasless API (if enabled)
    if (options.enableGasless) {
      routes.push({
        name: '0x Gasless API',
        source: '0x-gasless',
        execute: async (p) => {
          const gaslessQuote = await gaslessService.getFirmQuote({
            ...p,
            takerAddress: '', // Will need to be provided by caller
            enableGasless: true,
          });

          // Convert GaslessQuoteResponse to ZeroXQuote format
          return {
            buyAmount: gaslessQuote.buyAmount,
            sellAmount: gaslessQuote.sellAmount,
            price: gaslessQuote.price,
            guaranteedPrice: gaslessQuote.guaranteedPrice,
            to: gaslessQuote.to || '',
            data: gaslessQuote.data || '',
            value: gaslessQuote.value || '0',
            gas: gaslessQuote.gas || '0',
            gasPrice: gaslessQuote.gasPrice || '0',
            allowanceTarget: gaslessQuote.allowanceTarget,
            metaTransaction: gaslessQuote.metaTransaction,
          } as ZeroXQuote;
        },
      });
    }

    // Route 4: Direct DEX calls (Future - placeholder)
    // This would require direct integration with Uniswap/Sushiswap routers
    // For now, we'll skip this as it requires significant additional work

    // Route 5: Aggregator comparison (Future - placeholder)
    // This would require integration with 1inch, Paraswap APIs
    // For now, we'll skip this as it requires significant additional work

    return routes;
  }

  /**
   * Try multiple routes and return the first successful result
   */
  private async tryRoutes<T>(
    routes: Array<{ name: string; execute: () => Promise<T> }>
  ): Promise<{ result: T; route: string }> {
    let lastError: Error | null = null;

    for (const route of routes) {
      try {
        const result = await route.execute();
        return { result, route: route.name };
      } catch (error: any) {
        lastError = error;
        logger.warn(
          { route: route.name, error: error.message },
          `Route ${route.name} failed, trying next`
        );
        // Continue to next route
      }
    }

    throw lastError || new Error('All routes failed');
  }
}

export const executionEngine = new ExecutionEngine();

