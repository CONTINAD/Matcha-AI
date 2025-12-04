#!/bin/bash
STRATEGY_ID="cmirqducl0001127mw8pxhkfq"
LOG_FILE="/tmp/paper-trading-monitor.log"

while true; do
    TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
    
    # Check API server
    if ! curl -s http://localhost:4000/health > /dev/null 2>&1; then
        echo "[$TIMESTAMP] ❌ API server down!" >> "$LOG_FILE"
    fi
    
    # Check paper trading status
    STATUS=$(curl -s http://localhost:4000/strategies/$STRATEGY_ID/trading-status 2>/dev/null)
    if [ $? -eq 0 ]; then
        IS_ACTIVE=$(echo "$STATUS" | python3 -c "import sys, json; d=json.load(sys.stdin); print('YES' if d.get('isActive') else 'NO')" 2>/dev/null)
        DECISIONS=$(echo "$STATUS" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('metrics', {}).get('totalDecisions', 0))" 2>/dev/null)
        TRADES=$(echo "$STATUS" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('metrics', {}).get('tradesExecuted', 0))" 2>/dev/null)
        SUCCESS_RATE=$(echo "$STATUS" | python3 -c "import sys, json; d=json.load(sys.stdin); print(f\"{d.get('metrics', {}).get('dataFeedHealth', {}).get('successRate', 0)*100:.1f}%\")" 2>/dev/null)
        
        echo "[$TIMESTAMP] Active: $IS_ACTIVE | Decisions: $DECISIONS | Trades: $TRADES | Data Feed: $SUCCESS_RATE" >> "$LOG_FILE"
    else
        echo "[$TIMESTAMP] ❌ Cannot reach API" >> "$LOG_FILE"
    fi
    
    sleep 60  # Check every minute
done
