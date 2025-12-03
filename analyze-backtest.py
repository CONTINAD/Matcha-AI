#!/usr/bin/env python3
import sys
import json

data = json.load(sys.stdin)

print("=" * 60)
print("BACKTEST ANALYSIS - VERIFYING RESULTS")
print("=" * 60)

initial_equity = data.get('initialEquity', 0)
final_equity = data.get('finalEquity', 0)
total_return_pct = data.get('totalReturnPct', 0)
trades = data.get('trades', [])
performance = data.get('performance', {})

print(f"\n📊 SUMMARY:")
print(f"  Initial Equity: ${initial_equity:,.2f}")
print(f"  Final Equity: ${final_equity:,.2f}")
print(f"  Total Return: {total_return_pct:.2f}%")
print(f"  Total Trades: {len(trades)}")
print(f"  Win Rate: {performance.get('winRate', 0) * 100:.1f}%")
print(f"  Max Drawdown: {data.get('maxDrawdown', 0):.2f}%")
print(f"  Sharpe Ratio: {performance.get('sharpe', 0):.2f}")

# Verify P&L calculation
print(f"\n🔍 P&L VERIFICATION:")
equity = initial_equity
errors = 0

for i, trade in enumerate(trades[:10]):  # Check first 10 trades
    entry = trade.get('entryPrice', 0)
    exit = trade.get('exitPrice', 0)
    size = trade.get('size', 0)
    side = trade.get('side', 'BUY')
    fees = trade.get('fees', 0)
    slippage = trade.get('slippage', 0)
    reported_pnl = trade.get('pnl', 0)
    
    # Calculate P&L
    # Note: trade['side'] is the CLOSING action, not the original position
    # If side='SELL', we're closing a LONG position (opened with BUY)
    # If side='BUY', we're closing a SHORT position (opened with SELL)
    if side == 'SELL':  # Closing a long position
        raw_pnl = (exit - entry) * size
    else:  # side == 'BUY', closing a short position
        raw_pnl = (entry - exit) * size
    
    net_pnl = raw_pnl - fees
    equity += net_pnl
    
    # Check if reported matches calculated
    diff = abs(net_pnl - reported_pnl)
    match = diff < 0.01  # Allow 1 cent tolerance
    
    if not match:
        errors += 1
        print(f"  ❌ Trade {i+1}: Mismatch!")
        print(f"     Calculated: ${net_pnl:.2f}, Reported: ${reported_pnl:.2f}, Diff: ${diff:.2f}")
    
    if i < 3:  # Show first 3 trades in detail
        print(f"\n  Trade {i+1} ({side}):")
        print(f"    Size: {size:.4f}, Entry: ${entry:.2f}, Exit: ${exit:.2f}")
        print(f"    Raw P&L: ${raw_pnl:.2f}, Fees: ${fees:.2f}, Net: ${net_pnl:.2f}")
        print(f"    Reported: ${reported_pnl:.2f} {'✅' if match else '❌'}")
        print(f"    Equity: ${equity:.2f}")

if errors == 0:
    print(f"\n✅ All P&L calculations verified!")
else:
    print(f"\n⚠️  Found {errors} P&L mismatches")

# Verify equity curve
print(f"\n📈 EQUITY CURVE VERIFICATION:")
equity_curve = data.get('equityCurve', [])
if equity_curve:
    print(f"  Points: {len(equity_curve)}")
    print(f"  Start: ${equity_curve[0]:,.2f}")
    print(f"  End: ${equity_curve[-1]:,.2f}")
    print(f"  Expected End: ${final_equity:,.2f}")
    
    if abs(equity_curve[-1] - final_equity) < 0.01:
        print(f"  ✅ Equity curve matches final equity")
    else:
        print(f"  ❌ Equity curve mismatch!")

# Check for realistic values
print(f"\n🎯 REALISM CHECK:")
issues = []

if abs(total_return_pct) > 100:
    issues.append(f"⚠️  Extreme return: {total_return_pct:.2f}%")
else:
    print(f"  ✅ Return is reasonable: {total_return_pct:.2f}%")

win_rate = performance.get('winRate', 0) * 100
if win_rate < 20 or win_rate > 80:
    issues.append(f"⚠️  Unusual win rate: {win_rate:.1f}%")
else:
    print(f"  ✅ Win rate is reasonable: {win_rate:.1f}%")

if len(trades) == 0:
    issues.append("⚠️  No trades generated")
else:
    print(f"  ✅ Generated {len(trades)} trades")

max_dd = data.get('maxDrawdown', 0)
if max_dd > 50:
    issues.append(f"⚠️  Extreme drawdown: {max_dd:.2f}%")
else:
    print(f"  ✅ Max drawdown is reasonable: {max_dd:.2f}%")

# Check fees are being deducted
total_fees = sum(t.get('fees', 0) for t in trades)
if total_fees == 0:
    issues.append("⚠️  No fees deducted")
else:
    print(f"  ✅ Fees deducted: ${total_fees:.2f}")

if issues:
    print(f"\n⚠️  ISSUES FOUND:")
    for issue in issues:
        print(f"  {issue}")
else:
    print(f"\n✅ All checks passed - results look realistic!")

print("\n" + "=" * 60)

