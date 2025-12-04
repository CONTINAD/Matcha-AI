'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import axios from 'axios';
import { useWebSocket } from '../hooks/useWebSocket';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:4001';

interface LiveTrade {
  id: string;
  strategyId: string;
  strategyName: string;
  timestamp: number;
  side: 'BUY' | 'SELL';
  symbol: string;
  pnl: number;
  mode: string;
  chainId?: number;
}

export function LiveActivity() {
  const [recentTrades, setRecentTrades] = useState<LiveTrade[]>([]);
  const [activeStrategies, setActiveStrategies] = useState<number>(0);
  const { isConnected, lastMessage } = useWebSocket(WS_URL);

  useEffect(() => {
    // Fetch recent trades from all active strategies
    const fetchRecentActivity = async () => {
      try {
        // Get all active strategies
        const strategiesRes = await axios.get(`${API_URL}/strategies?quality=good`);
        const strategies = strategiesRes.data.filter((s: any) => s.status === 'ACTIVE');
        setActiveStrategies(strategies.length);

        // Get recent trades from active strategies
        const allTrades: LiveTrade[] = [];
        for (const strategy of strategies.slice(0, 5)) {
          try {
            const tradesRes = await axios.get(`${API_URL}/strategies/${strategy.id}/trades?limit=3`);
            const trades = tradesRes.data.map((t: any) => ({
              ...t,
              strategyName: strategy.name,
              strategyId: strategy.id,
              chainId: strategy.chainId,
              timestamp: new Date(t.timestamp).getTime(),
            }));
            allTrades.push(...trades);
          } catch (err) {
            // Skip if error
          }
        }

        // Sort by timestamp and take most recent
        allTrades.sort((a, b) => b.timestamp - a.timestamp);
        setRecentTrades(allTrades.slice(0, 10));
      } catch (err) {
        console.error('Error fetching live activity:', err);
      }
    };

    fetchRecentActivity();
    const interval = setInterval(fetchRecentActivity, 10000); // Update every 10 seconds

    return () => clearInterval(interval);
  }, []);

  // Handle WebSocket updates
  useEffect(() => {
    if (!lastMessage) return;

    if (lastMessage.type === 'trade') {
      const trade = lastMessage.data.trade || lastMessage.data;
      setRecentTrades((prev) => {
        const exists = prev.some((t) => t.id === trade.id);
        if (exists) return prev;
        return [{
          ...trade,
          strategyId: trade.strategyId || '',
          chainId: trade.chainId,
          timestamp: trade.timestamp || Date.now(),
        }, ...prev].slice(0, 10);
      });
    }
  }, [lastMessage]);

  // Always show if there are active strategies, even without trades yet
  if (activeStrategies === 0) {
    return null;
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-8">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">⚡ Live Activity</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            {activeStrategies} active strategy{activeStrategies !== 1 ? 'ies' : ''} trading right now
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isConnected ? (
            <span className="px-3 py-1 bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 rounded-full text-xs font-semibold flex items-center gap-2">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
              Live
            </span>
          ) : (
            <span className="px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded-full text-xs font-semibold">
              Offline
            </span>
          )}
        </div>
      </div>

      {recentTrades.length > 0 ? (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {recentTrades.map((trade) => {
            const isBuy = trade.side === 'BUY';
            const isProfitable = trade.pnl > 0;
            const timeAgo = Math.floor((Date.now() - trade.timestamp) / 1000 / 60);
            
            return (
              <div
                key={trade.id}
                className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className={`text-lg ${isBuy ? 'text-green-600' : 'text-red-600'}`}>
                    {isBuy ? '🟢' : '🔴'}
                  </span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/strategies/${trade.strategyId}`}
                        className="font-semibold text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                      >
                        {trade.strategyName}
                      </Link>
                      {trade.chainId === 101 && (
                        <span className="px-1.5 py-0.5 text-xs bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 rounded">
                          SOL
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {trade.side} {trade.symbol} • {timeAgo === 0 ? 'Just now' : `${timeAgo}m ago`}
                    </div>
                  </div>
                </div>
                <div className={`text-right font-semibold ${
                  isProfitable ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                }`}>
                  {isProfitable ? '+' : ''}${trade.pnl.toFixed(2)}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-12">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-blue-100 dark:bg-blue-900/30 mb-6">
            <span className="text-4xl">⏳</span>
          </div>
          <p className="text-gray-900 dark:text-white font-semibold text-lg mb-2">Waiting for first trades</p>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            {activeStrategies} strateg{activeStrategies !== 1 ? 'ies are' : 'y is'} actively monitoring markets
          </p>
          <div className="flex items-center justify-center gap-2 text-xs text-gray-500 dark:text-gray-400 mb-2">
            <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
            <span>Strategies checking every 10-30 seconds</span>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            First trades typically appear within 5-10 minutes of activation
          </p>
        </div>
      )}
    </div>
  );
}

