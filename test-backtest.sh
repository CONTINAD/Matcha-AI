#!/bin/bash

STRATEGY_ID="cmipd7jlt0001da41lq1y308k"
echo "Running backtest on strategy: $STRATEGY_ID"
echo ""

RESPONSE=$(curl -s -X POST "http://localhost:4000/strategies/$STRATEGY_ID/backtest" \
  -H "Content-Type: application/json" \
  -d '{"fastMode": true, "maxCandles": 50, "initialEquity": 1000}')

echo "=== BACKTEST RESULTS ==="
echo "$RESPONSE" | python3 << 'PYTHON'
import sys, json
try:
    data = json.load(sys.stdin)
    print(f"✅ Backtest Complete")
    print(f"Initial Equity: ${data.get('initialEquity', 0):.2f}")
    print(f"Final Equity: ${data.get('finalEquity', 0):.2f}")
    print(f"Total Return: {data.get('totalReturnPct', 0):.2f}%")
    print(f"Total Trades: {len(data.get('trades', []))}")
    print(f"Win Rate: {data.get('winRate', 0):.1f}%")
    print(f"Max Drawdown: {data.get('maxDrawdown', 0):.2f}%")
    print(f"Sharpe Ratio: {data.get('sharpeRatio', 0):.2f}")
    
    trades = data.get('trades', [])
    if trades:
        print(f"\n=== TRADE ANALYSIS ===")
        print(f"Total Trades: {len(trades)}")
        winning = [t for t in trades if t.get('pnl', 0) > 0]
        losing = [t for t in trades if t.get('pnl', 0) < 0]
        print(f"Winning Trades: {len(winning)}")
        print(f"Losing Trades: {len(losing)}")
        
        totalPnL = sum(t.get('pnl', 0) for t in trades)
        print(f"Total P&L: ${totalPnL:.2f}")
        
        if winning:
            avgWin = sum(t.get('pnl', 0) for t in winning) / len(winning)
            print(f"Average Win: ${avgWin:.2f}")
        if losing:
            avgLoss = sum(t.get('pnl', 0) for t in losing) / len(losing)
            print(f"Average Loss: ${avgLoss:.2f}")
        
        print(f"\nFirst Trade:")
        t = trades[0]
        print(f"  {t.get('side', 'N/A')} {t.get('size', 0):.4f} @ ${t.get('entryPrice', 0):.2f} → ${t.get('exitPrice', 0):.2f}")
        print(f"  P&L: ${t.get('pnl', 0):.2f} ({t.get('pnlPct', 0):.2f}%)")
        
        if len(trades) > 1:
            print(f"\nLast Trade:")
            t = trades[-1]
            print(f"  {t.get('side', 'N/A')} {t.get('size', 0):.4f} @ ${t.get('entryPrice', 0):.2f} → ${t.get('exitPrice', 0):.2f}")
            print(f"  P&L: ${t.get('pnl', 0):.2f} ({t.get('pnlPct', 0):.2f}%)")
        
        # Verify P&L math
        print(f"\n=== P&L VERIFICATION ===")
        equity = data.get('initialEquity', 1000)
        for i, trade in enumerate(trades[:3]):  # Check first 3 trades
            entry = trade.get('entryPrice', 0)
            exit = trade.get('exitPrice', 0)
            size = trade.get('size', 0)
            side = trade.get('side', 'BUY')
            fees = trade.get('fees', 0)
            
            if side == 'BUY':
                rawPnL = (exit - entry) * size
            else:
                rawPnL = (entry - exit) * size
            
            netPnL = rawPnL - fees
            reportedPnL = trade.get('pnl', 0)
            
            equity += netPnL
            
            print(f"Trade {i+1}:")
            print(f"  Raw P&L: ${rawPnL:.2f}, Fees: ${fees:.2f}, Net: ${netPnL:.2f}")
            print(f"  Reported: ${reportedPnL:.2f}, Match: {'✅' if abs(netPnL - reportedPnL) < 0.01 else '❌'}")
            print(f"  Equity after: ${equity:.2f}")
    else:
        print("⚠️  No trades generated")
        
except json.JSONDecodeError as e:
    print(f"❌ Error parsing JSON: {e}")
    print("Response:", sys.stdin.read())
except Exception as e:
    print(f"❌ Error: {e}")
    import traceback
    traceback.print_exc()
PYTHON

echo ""
echo "=== VALIDATION ==="
echo "✅ Results are realistic if:"
echo "  - P&L matches calculated values"
echo "  - Equity changes correctly"
echo "  - Fees are deducted"
echo "  - Win rate is reasonable (30-70%)"
echo "  - Returns are not extreme (< 100% for 50 candles)"


