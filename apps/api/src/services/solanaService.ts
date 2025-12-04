import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { config } from '../config/env';
import { logger } from '../config/logger';
import { solanaLogger } from './solanaLogger';
import axios from 'axios';

export interface JupiterQuoteParams {
  inputMint: string; // Token mint address
  outputMint: string; // Token mint address
  amount: number; // Amount in smallest unit
  slippageBps?: number; // Basis points
}

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  priceImpactPct: string;
  routePlan: any[];
}

export interface JupiterSwapTx {
  swapTransaction: string; // Base64 encoded transaction
}

export class SolanaService {
  private connection: Connection;
  private jupiterApiUrl = 'https://quote-api.jup.ag/v6';

  constructor() {
    // Use mainnet or devnet based on env
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  /**
   * Get a quote from Jupiter Aggregator
   */
  async getJupiterQuote(params: JupiterQuoteParams): Promise<JupiterQuote> {
    const maxRetries = 2;
    let lastError: any = null;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await axios.get<JupiterQuote>(`${this.jupiterApiUrl}/quote`, {
          params: {
            inputMint: params.inputMint,
            outputMint: params.outputMint,
            amount: params.amount.toString(),
            slippageBps: params.slippageBps || 50, // 0.5% default
          },
          timeout: 15000, // Increased from 10s to 15s
        });

        return response.data;
      } catch (error: any) {
        lastError = error;
        const isNetworkError = error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT';
        const isRetryable = isNetworkError || (error.response?.status >= 500 && error.response?.status < 600);
        
        if (attempt < maxRetries - 1 && isRetryable) {
          const delay = 1000 * (attempt + 1); // 1s, 2s
          logger.warn({ 
            attempt: attempt + 1, 
            maxRetries, 
            delay, 
            error: error.message,
            code: error.code,
            status: error.response?.status 
          }, 'Retrying Jupiter API call');
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          break;
        }
      }
    }
    
    logger.error({ 
      error: lastError?.message, 
      params,
      code: lastError?.code,
      status: lastError?.response?.status 
    }, 'Jupiter API error after retries');
    throw new Error(`Jupiter API error after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`);
  }

  /**
   * Build a swap transaction
   */
  async buildSwapTransaction(
    quote: JupiterQuote,
    userPublicKey: string,
    wrapUnwrapSOL?: boolean
  ): Promise<JupiterSwapTx> {
    try {
      const response = await axios.post<JupiterSwapTx>(
        `${this.jupiterApiUrl}/swap`,
        {
          quoteResponse: quote,
          userPublicKey,
          wrapUnwrapSOL: wrapUnwrapSOL ?? true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: 'auto',
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }
      );

      return response.data;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Jupiter swap transaction error');
      throw new Error(`Failed to build swap transaction: ${error.message}`);
    }
  }

  /**
   * Execute a swap transaction (requires private key)
   */
  async executeSwap(
    swapTxBase64: string,
    privateKey: string // Base58 encoded private key
  ): Promise<string> {
    try {
      // Decode private key
      const keypair = Keypair.fromSecretKey(
        Buffer.from(JSON.parse(privateKey))
      );

      // Deserialize transaction
      const transaction = Transaction.from(Buffer.from(swapTxBase64, 'base64'));

      // Sign transaction
      transaction.sign(keypair);

      // Send and confirm
      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [keypair],
        {
          commitment: 'confirmed',
          skipPreflight: false,
        }
      );

      logger.info({ signature, wallet: keypair.publicKey.toString() }, 'Swap executed');
      solanaLogger.transactionConfirmed('', signature, '', 0); // Will be updated with actual data
      return signature;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Swap execution error');
      throw new Error(`Failed to execute swap: ${error.message}`);
    }
  }

  /**
   * Get SOL balance
   */
  async getBalance(publicKey: string): Promise<number> {
    try {
      const pubkey = new PublicKey(publicKey);
      const balance = await this.connection.getBalance(pubkey);
      return balance / 1e9; // Convert lamports to SOL
    } catch (error: any) {
      logger.error({ error: error.message, publicKey }, 'Balance check error');
      throw new Error(`Failed to get balance: ${error.message}`);
    }
  }

  /**
   * Get SPL token balance
   */
  async getTokenBalance(publicKey: string, tokenMint: string): Promise<number> {
    try {
      const pubkey = new PublicKey(publicKey);
      const mint = new PublicKey(tokenMint);
      
      // Get token accounts
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(pubkey, {
        mint: mint,
      });

      if (tokenAccounts.value.length === 0) {
        return 0;
      }

      const balance = tokenAccounts.value[0].account.data.parsed.info.tokenAmount.uiAmount;
      return balance || 0;
    } catch (error: any) {
      logger.error({ error: error.message, publicKey, tokenMint }, 'Token balance error');
      return 0;
    }
  }
}

export const solanaService = new SolanaService();

