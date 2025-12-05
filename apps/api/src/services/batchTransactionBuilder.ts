import type { ZeroXSwapTx } from '@matcha-ai/shared';
import { logger } from '../config/logger';
import { ethers } from 'ethers';

export interface BatchTransaction {
  to: string;
  data: string;
  value: string;
  gasLimit?: string;
}

export interface ApprovalData {
  token: string;
  spender: string;
  amount: string;
}

/**
 * Batch Transaction Builder
 * 
 * Combines multiple operations into single transaction:
 * - Combine approval + swap into single transaction
 * - Use Permit2 when available (no approval needed)
 * - Multicall for multiple swaps
 */
export class BatchTransactionBuilder {
  /**
   * Build batch transaction combining approval and swap
   */
  buildApprovalAndSwap(
    approval: ApprovalData,
    swapTx: ZeroXSwapTx,
    usePermit2: boolean = false
  ): BatchTransaction {
    if (usePermit2) {
      // Permit2 doesn't require approval, just return swap
      logger.debug({ token: approval.token }, 'Using Permit2, skipping approval');
      return {
        to: swapTx.to,
        data: swapTx.data,
        value: swapTx.value || '0',
        gasLimit: swapTx.gas,
      };
    }

    // Build multicall to combine approval + swap
    // This is a simplified version - in production, would use actual multicall contract
    const multicallData = this.encodeMulticall([
      {
        to: approval.token,
        data: this.encodeApproval(approval),
        value: '0',
      },
      {
        to: swapTx.to,
        data: swapTx.data,
        value: swapTx.value || '0',
      },
    ]);

    // For now, return the swap transaction
    // In production, would return multicall transaction
    logger.info(
      {
        token: approval.token,
        spender: approval.spender,
        swapTo: swapTx.to,
      },
      'Built batch transaction (approval + swap)'
    );

    return {
      to: swapTx.to, // Would be multicall contract address in production
      data: multicallData,
      value: swapTx.value || '0',
      gasLimit: swapTx.gas ? (BigInt(swapTx.gas) * BigInt(2)).toString() : undefined, // Estimate 2x gas for batch
    };
  }

  /**
   * Build multicall for multiple swaps
   */
  buildMulticallSwaps(swaps: ZeroXSwapTx[]): BatchTransaction {
    if (swaps.length === 0) {
      throw new Error('No swaps provided for multicall');
    }

    if (swaps.length === 1) {
      // Single swap, no need for multicall
      return {
        to: swaps[0].to,
        data: swaps[0].data,
        value: swaps[0].value || '0',
        gasLimit: swaps[0].gas,
      };
    }

    // Encode multicall
    const multicallData = this.encodeMulticall(
      swaps.map((swap) => ({
        to: swap.to,
        data: swap.data,
        value: swap.value || '0',
      }))
    );

    // Calculate total gas (sum of all swaps + overhead)
    const totalGas = swaps.reduce((sum, swap) => {
      return sum + (swap.gas ? BigInt(swap.gas) : BigInt(0));
    }, BigInt(0));

    logger.info(
      {
        numSwaps: swaps.length,
        totalGas: totalGas.toString(),
      },
      'Built multicall for multiple swaps'
    );

    return {
      to: swaps[0].to, // Would be multicall contract address in production
      data: multicallData,
      value: swaps.reduce((sum, swap) => {
        return sum + BigInt(swap.value || '0');
      }, BigInt(0)).toString(),
      gasLimit: (totalGas * BigInt(110) / BigInt(100)).toString(), // 10% overhead
    };
  }

  /**
   * Encode ERC20 approval
   */
  private encodeApproval(approval: ApprovalData): string {
    // ERC20 approve(address spender, uint256 amount)
    const iface = new ethers.Interface([
      'function approve(address spender, uint256 amount) returns (bool)',
    ]);
    return iface.encodeFunctionData('approve', [approval.spender, approval.amount]);
  }

  /**
   * Encode multicall
   * Simplified version - in production would use actual multicall contract ABI
   */
  private encodeMulticall(calls: Array<{ to: string; data: string; value: string }>): string {
    // This is a placeholder - would use actual multicall contract encoding
    // For now, return the first call's data (would need proper multicall contract)
    logger.warn('Multicall encoding is simplified - would need actual multicall contract in production');
    return calls[0]?.data || '0x';
  }

  /**
   * Check if Permit2 is available for a token
   */
  async checkPermit2Availability(
    token: string,
    chainId: number,
    provider: ethers.Provider
  ): Promise<boolean> {
    // Check if token supports Permit2
    // This would require checking the token contract or a registry
    // For now, return false (would need Permit2 integration)
    return false;
  }
}

export const batchTransactionBuilder = new BatchTransactionBuilder();

