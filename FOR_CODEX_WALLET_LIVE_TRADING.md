# 🚀 Codex 5.1: Wallet Integration & Live Trading Upgrade

You are Codex 5.1, an expert AI systems architect and quantitative trading specialist. Transform the Matcha AI trading system to support **real wallet connections and live trading with actual funds**.

## CURRENT STATE

The system has:
- ✅ Backtesting with fast mode
- ✅ Paper trading simulation
- ✅ Basic live trading infrastructure (0x API for EVM, Jupiter for Solana)
- ✅ Wallet connection UI component
- ✅ Database schema for wallets
- ✅ Risk management and position sizing

## CRITICAL IMPROVEMENTS NEEDED

### 1. WALLET SECURITY & ENCRYPTION (P0)
- **Encrypt private keys** before storing in database (use AES-256-GCM)
- **Never expose private keys** to frontend - all signing happens server-side
- Add **wallet session management** (temporary decryption keys)
- Implement **hardware wallet support** (Ledger, Trezor)
- Add **multi-sig wallet support** for institutional users

### 2. LIVE TRADING EXECUTION (P0)
- **EVM Chains (Ethereum, Polygon, Arbitrum):**
  - Integrate with 0x Swap API for quotes
  - Build and sign transactions server-side
  - Send transactions via ethers.js
  - Wait for confirmation before recording trade
  - Handle transaction failures gracefully

- **Solana:**
  - Integrate Jupiter Aggregator API for quotes
  - Build swap transactions
  - Sign with user's private key (server-side)
  - Send via @solana/web3.js
  - Handle transaction confirmation

### 3. TRANSACTION SIGNING FLOW (P0)
- When strategy wants to trade:
  1. Build transaction (0x or Jupiter)
  2. Store as "pending" in database
  3. Send to frontend for user approval (show trade details)
  4. User approves → sign transaction server-side
  5. Broadcast to blockchain
  6. Wait for confirmation
  7. Record trade in database
  8. Update strategy state

### 4. SAFETY LIMITS & CIRCUIT BREAKERS (P0)
- **Max trading amount per wallet** (enforced)
- **Daily loss limits** (stop trading if exceeded)
- **Max position size** (per trade)
- **Gas price limits** (don't trade if gas too high)
- **Slippage protection** (reject if slippage > threshold)
- **Emergency stop** button (immediate halt)

### 5. REAL-TIME BALANCE TRACKING (P1)
- Poll wallet balances periodically
- Update UI with current balances
- Warn if balance too low for trading
- Track P&L in real-time

### 6. TRANSACTION HISTORY & MONITORING (P1)
- Show all pending transactions
- Show transaction status (pending, confirmed, failed)
- Link to block explorers (Etherscan, Solscan)
- Alert on failed transactions

### 7. GAS OPTIMIZATION (P1)
- **EVM:** Use EIP-1559 for gas estimation
- **EVM:** Batch transactions when possible
- **Solana:** Use priority fees for faster confirmation
- **Solana:** Bundle multiple swaps when possible

### 8. IMPROVE PROFITABLE STRATEGIES (P1)
Based on backtest results:
- **"Maximum Profit Strategy"**: 9.00% return, 58.3% win rate, 115 trades
- **"Fast Profit Strategy"**: 8.66% return, 63.2% win rate, 68 trades
- **"High Performance Strategy - Optimized"**: 5.49% return, 47.0% win rate, 66 trades

Optimize these strategies:
- Fine-tune risk parameters
- Adjust position sizing
- Improve entry/exit signals
- Add more filters to reduce false signals

### 9. UI/UX IMPROVEMENTS (P2)
- **Wallet connection modal** with clear instructions
- **Transaction approval modal** showing:
  - Trade details (symbol, side, size, price)
  - Estimated gas fees
  - Slippage tolerance
  - Max loss/profit scenarios
- **Real-time balance display**
- **Transaction status indicators**
- **Error messages** with actionable steps

### 10. TESTING & MONITORING (P2)
- Add integration tests for wallet operations
- Add end-to-end tests for live trading flow
- Monitor transaction success rates
- Alert on unusual patterns
- Log all wallet operations for audit

## FILES TO MODIFY

### Backend:
- `apps/api/src/services/walletService.ts` - Add encryption, balance checks
- `apps/api/src/services/liveTrader.ts` - Implement actual transaction execution
- `apps/api/src/services/solanaService.ts` - Complete Jupiter integration
- `apps/api/src/services/zeroExService.ts` - Add transaction execution
- `apps/api/src/routes/wallets.ts` - Add balance endpoints, encryption
- `apps/api/src/routes/strategies.ts` - Add transaction approval endpoints

### Frontend:
- `apps/web/src/components/WalletConnect.tsx` - Improve UI, add instructions
- `apps/web/src/app/strategies/[id]/page.tsx` - Add transaction approval modal
- `apps/web/src/components/TransactionApproval.tsx` - NEW: Modal for approving trades

### Database:
- `apps/api/prisma/schema.prisma` - Already has Wallet model, may need Transaction model

## SECURITY REQUIREMENTS

1. **NEVER** log private keys
2. **NEVER** send private keys to frontend
3. **ALWAYS** encrypt private keys at rest
4. **ALWAYS** use HTTPS in production
5. **ALWAYS** validate transaction amounts against limits
6. **ALWAYS** require explicit user approval for each trade

## TESTING STRATEGY

1. Start with **testnet** (Sepolia, Mumbai, Solana Devnet)
2. Use **small amounts** ($1-10)
3. Test **all failure scenarios**:
   - Insufficient balance
   - Gas too high
   - Slippage too high
   - Transaction timeout
   - Network errors
4. Verify **all safety limits** work
5. Test **emergency stop**

## SUCCESS CRITERIA

✅ User can connect EVM wallet (private key)
✅ User can connect Solana wallet (private key)
✅ User can set max trading amount
✅ Strategy can generate trade signals
✅ User can approve/reject trades
✅ Approved trades execute on blockchain
✅ Trades are recorded in database
✅ Safety limits are enforced
✅ Real-time balance tracking works
✅ Transaction history is visible

## NOTES

- The system already has 0x API key and CoinGecko API key
- Jupiter API is free (no key needed)
- Use testnet for initial testing
- Consider adding support for MetaMask/Phantom browser extensions (future)

---

**Make this system production-ready for live trading with real funds while maintaining maximum security and safety.**




