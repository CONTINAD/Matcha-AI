import pino from 'pino';
import path from 'path';
import fs from 'fs';

/**
 * Dedicated Solana Logger
 * Separate log files for Solana strategies and wallet activities
 */
class SolanaLogger {
  private logger: pino.Logger;
  private logDir: string;
  private logFile: string;
  private fileStream: fs.WriteStream | null = null;

  constructor() {
    // Create logs directory if it doesn't exist
    this.logDir = path.resolve(__dirname, '../../../logs/solana');
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    // Create separate log file for Solana activities
    this.logFile = path.join(this.logDir, `solana-${new Date().toISOString().split('T')[0]}.log`);
    
    // Create file stream for writing
    this.fileStream = fs.createWriteStream(this.logFile, { flags: 'a' });
    
    // Create logger with console output
    this.logger = pino({
      level: 'info',
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    });
  }

  private writeToFile(level: string, data: any, message: string) {
    if (this.fileStream) {
      const logEntry = {
        level,
        time: new Date().toISOString(),
        ...data,
        msg: message,
      };
      this.fileStream.write(JSON.stringify(logEntry) + '\n');
    }
  }

  /**
   * Log Solana wallet connection
   */
  walletConnected(walletId: string, address: string, chainType: string) {
    const data = {
      type: 'WALLET_CONNECTED',
      walletId,
      address: address.slice(0, 8) + '...' + address.slice(-6),
      chainType,
      timestamp: new Date().toISOString(),
    };
    this.logger.info(data, '🔗 Solana wallet connected');
    this.writeToFile('info', data, '🔗 Solana wallet connected');
  }

  /**
   * Log Solana transaction building
   */
  transactionBuilding(strategyId: string, symbol: string, side: string, amount: number, quote: any) {
    const data = {
      type: 'TX_BUILDING',
      strategyId,
      symbol,
      side,
      amount,
      quotePrice: quote?.outAmount,
      slippage: quote?.slippageBps,
      timestamp: new Date().toISOString(),
    };
    const message = `🔨 Building Solana swap: ${side} ${amount} ${symbol}`;
    this.logger.info(data, message);
    this.writeToFile('info', data, message);
  }

  /**
   * Log Solana transaction signed
   */
  transactionSigned(strategyId: string, txHash: string, symbol: string, side: string) {
    this.logger.info({
      type: 'TX_SIGNED',
      strategyId,
      txHash,
      symbol,
      side,
      timestamp: new Date().toISOString(),
    }, `✍️  Transaction signed: ${txHash.slice(0, 8)}...`);
  }

  /**
   * Log Solana transaction sent
   */
  transactionSent(strategyId: string, txHash: string, symbol: string) {
    this.logger.info({
      type: 'TX_SENT',
      strategyId,
      txHash,
      symbol,
      timestamp: new Date().toISOString(),
    }, `📤 Transaction sent to network: ${txHash.slice(0, 8)}...`);
  }

  /**
   * Log Solana transaction confirmed
   */
  transactionConfirmed(strategyId: string, txHash: string, symbol: string, pnl: number) {
    this.logger.info({
      type: 'TX_CONFIRMED',
      strategyId,
      txHash,
      symbol,
      pnl,
      timestamp: new Date().toISOString(),
    }, `✅ Transaction confirmed: ${txHash.slice(0, 8)}... | P&L: $${pnl.toFixed(2)}`);
  }

  /**
   * Log Solana transaction failed
   */
  transactionFailed(strategyId: string, txHash: string | null, error: string, symbol: string) {
    this.logger.error({
      type: 'TX_FAILED',
      strategyId,
      txHash: txHash?.slice(0, 8) || 'N/A',
      error,
      symbol,
      timestamp: new Date().toISOString(),
    }, `❌ Transaction failed: ${error}`);
  }

  /**
   * Log Solana balance check
   */
  balanceChecked(address: string, solBalance: number, tokenBalances: Record<string, number>) {
    this.logger.info({
      type: 'BALANCE_CHECKED',
      address: address.slice(0, 8) + '...' + address.slice(-6),
      solBalance,
      tokenBalances,
      timestamp: new Date().toISOString(),
    }, `💰 Balance: ${solBalance.toFixed(4)} SOL`);
  }

  /**
   * Log Solana strategy decision
   */
  strategyDecision(strategyId: string, symbol: string, decision: any, confidence: number) {
    const data = {
      type: 'STRATEGY_DECISION',
      strategyId,
      symbol,
      action: decision.action,
      confidence,
      targetSize: decision.targetPositionSizePct,
      reasoning: decision.notes,
      timestamp: new Date().toISOString(),
    };
    const message = `🧠 Strategy decision: ${decision.action} ${symbol} (confidence: ${(confidence * 100).toFixed(1)}%)`;
    this.logger.info(data, message);
    this.writeToFile('info', data, message);
  }

  /**
   * Log Solana trade executed
   */
  tradeExecuted(strategyId: string, symbol: string, side: string, size: number, price: number, fees: number, pnl: number) {
    this.logger.info({
      type: 'TRADE_EXECUTED',
      strategyId,
      symbol,
      side,
      size,
      price,
      fees,
      pnl,
      timestamp: new Date().toISOString(),
    }, `💸 Trade executed: ${side} ${size} ${symbol} @ $${price.toFixed(2)} | P&L: $${pnl.toFixed(2)}`);
  }

  /**
   * Log Solana position opened
   */
  positionOpened(strategyId: string, symbol: string, side: string, size: number, entryPrice: number) {
    const data = {
      type: 'POSITION_OPENED',
      strategyId,
      symbol,
      side,
      size,
      entryPrice,
      timestamp: new Date().toISOString(),
    };
    const message = `📈 Position opened: ${side} ${size} ${symbol} @ $${entryPrice.toFixed(2)}`;
    this.logger.info(data, message);
    this.writeToFile('info', data, message);
  }

  /**
   * Log Solana position closed
   */
  positionClosed(strategyId: string, symbol: string, side: string, pnl: number, reason: string) {
    const data = {
      type: 'POSITION_CLOSED',
      strategyId,
      symbol,
      side,
      pnl,
      reason,
      timestamp: new Date().toISOString(),
    };
    const message = `📉 Position closed: ${symbol} | P&L: $${pnl.toFixed(2)} | Reason: ${reason}`;
    this.logger.info(data, message);
    this.writeToFile('info', data, message);
  }

  /**
   * Log Solana error
   */
  error(strategyId: string | null, error: any, context: Record<string, any> = {}) {
    this.logger.error({
      type: 'ERROR',
      strategyId,
      error: error.message || error,
      stack: error.stack,
      ...context,
      timestamp: new Date().toISOString(),
    }, `❌ Solana error: ${error.message || error}`);
  }

  /**
   * Log Solana performance update
   */
  performanceUpdate(strategyId: string, equity: number, winRate: number, totalTrades: number, dailyPnl: number) {
    this.logger.info({
      type: 'PERFORMANCE_UPDATE',
      strategyId,
      equity,
      winRate,
      totalTrades,
      dailyPnl,
      timestamp: new Date().toISOString(),
    }, `📊 Performance: Equity $${equity.toFixed(2)} | Win Rate ${(winRate * 100).toFixed(1)}% | Trades ${totalTrades}`);
  }

  /**
   * Log Solana Jupiter quote
   */
  jupiterQuote(symbol: string, amount: number, quote: any) {
    this.logger.debug({
      type: 'JUPITER_QUOTE',
      symbol,
      amount,
      outAmount: quote?.outAmount,
      priceImpact: quote?.priceImpactPct,
      timestamp: new Date().toISOString(),
    }, `💱 Jupiter quote: ${amount} → ${quote?.outAmount || 'N/A'}`);
  }

  /**
   * Get log file path for today
   */
  getLogFilePath(): string {
    return path.join(this.logDir, `solana-${new Date().toISOString().split('T')[0]}.log`);
  }
}

export const solanaLogger = new SolanaLogger();

