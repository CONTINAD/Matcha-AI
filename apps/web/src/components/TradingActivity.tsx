'use client';

import { useEffect, useState } from 'react';
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface TradingMetrics {
  totalDecisions: number;
  openaiCalls: number;
  fastDecisions: number;
  cacheHits: number;
  riskBlocks: number;
  tradesExecuted: number;
  tradesBlocked: number;
  lastDecisionTime: string | null;
  lastTradeTime: string | null;
  lastDecision: {
    action: string;
    confidence: number;
    targetPositionSizePct: number;
    notes?: string;
  } | null;
  lastDecisionReason: string | null;
}

interface TradingStatus {
  strategyId: string;
  strategyName: string;
  isActive: boolean;
  status: string;
  mode: string;
  metrics: TradingMetrics | null;
  lastTrade: {
    id: string;
    timestamp: string;
    symbol: string;
    side: string;
    pnl: number;
  } | null;
  recentTradesCount: number;
  issues: string[];
  recommendations: string[];
}

export function TradingActivity() {
  const [strategies, setStrategies] = useState<any[]>([]);
  const [tradingStatuses, setTradingStatuses] = useState<Record<string, TradingStatus>>({});
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  useEffect(() => {
    fetchStrategies();
    const interval = setInterval(() => {
      fetchStrategies();
    }, 30000); // Refresh every 30 seconds

    return () => clearInterval(interval);
  }, []);

  const fetchStrategies = async () => {
    try {
      const response = await axios.get(`${API_URL}/strategies`);
      const activeStrategies = response.data.filter((s: any) => s.status === 'ACTIVE' && s.mode === 'PAPER');
      setStrategies(activeStrategies);

      // Fetch trading status for each strategy
      const statuses: Record<string, TradingStatus> = {};
      for (const strategy of activeStrategies) {
        try {
          const statusResponse = await axios.get(`${API_URL}/strategies/${strategy.id}/trading-status`);
          statuses[strategy.id] = statusResponse.data;
        } catch (error) {
          console.error(`Failed to fetch status for ${strategy.id}:`, error);
        }
      }
      setTradingStatuses(statuses);
      setLastRefresh(new Date());
    } catch (error) {
      console.error('Failed to fetch strategies:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatTimeAgo = (timestamp: string | null): string => {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Trading Activity</h2>
        <div className="text-gray-500 dark:text-gray-400">Loading...</div>
      </div>
    );
  }

  if (strategies.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Trading Activity</h2>
        <div className="text-gray-500 dark:text-gray-400">No active strategies</div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Trading Activity</h2>
        <div className="text-sm text-gray-500 dark:text-gray-400">
          Last updated: {lastRefresh.toLocaleTimeString()}
        </div>
      </div>

      <div className="space-y-4">
        {strategies.map((strategy) => {
          const status = tradingStatuses[strategy.id];
          if (!status) {
            return (
              <div key={strategy.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900 dark:text-white">{strategy.name}</h3>
                  <span className="text-sm text-gray-500 dark:text-gray-400">Loading status...</span>
                </div>
              </div>
            );
          }

          const metrics = status.metrics;
          const isHealthy = status.isActive && metrics && metrics.totalDecisions > 0;

          return (
            <div
              key={strategy.id}
              className={`border rounded-lg p-4 ${
                isHealthy
                  ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20'
                  : 'border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white">{strategy.name}</h3>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    {strategy.chainId === 101 ? 'Solana' : 'Ethereum'} • {strategy.timeframe}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {status.isActive ? (
                    <span className="px-2 py-1 bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 rounded text-xs font-semibold">
                      Active
                    </span>
                  ) : (
                    <span className="px-2 py-1 bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 rounded text-xs font-semibold">
                      Inactive
                    </span>
                  )}
                </div>
              </div>

              {metrics && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
                  <div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">OpenAI Calls</div>
                    <div className="text-lg font-semibold text-gray-900 dark:text-white">
                      {metrics.openaiCalls}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Fast Decisions</div>
                    <div className="text-lg font-semibold text-gray-900 dark:text-white">
                      {metrics.fastDecisions}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Trades Executed</div>
                    <div className="text-lg font-semibold text-green-600 dark:text-green-400">
                      {metrics.tradesExecuted}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Trades Blocked</div>
                    <div className="text-lg font-semibold text-red-600 dark:text-red-400">
                      {metrics.tradesBlocked}
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 mb-3 text-sm">
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Last Decision: </span>
                  <span className="text-gray-900 dark:text-white">
                    {formatTimeAgo(metrics?.lastDecisionTime || null)}
                  </span>
                  {metrics?.lastDecision && (
                    <span className="ml-2 text-xs">
                      ({metrics.lastDecision.action}, {Math.round(metrics.lastDecision.confidence * 100)}% conf)
                    </span>
                  )}
                </div>
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Last Trade: </span>
                  <span className="text-gray-900 dark:text-white">
                    {formatTimeAgo(status.lastTrade?.timestamp || null)}
                  </span>
                </div>
              </div>

              {status.issues.length > 0 && (
                <div className="mt-3 p-3 bg-yellow-100 dark:bg-yellow-900/30 rounded">
                  <div className="text-sm font-semibold text-yellow-800 dark:text-yellow-200 mb-1">
                    Issues:
                  </div>
                  <ul className="list-disc list-inside text-xs text-yellow-700 dark:text-yellow-300">
                    {status.issues.map((issue, idx) => (
                      <li key={idx}>{issue}</li>
                    ))}
                  </ul>
                </div>
              )}

              {metrics && metrics.totalDecisions === 0 && status.isActive && (
                <div className="mt-3 p-3 bg-blue-100 dark:bg-blue-900/30 rounded">
                  <div className="text-sm text-blue-800 dark:text-blue-200">
                    ⚠️ Strategy is active but no decisions have been made yet. This may indicate:
                    <ul className="list-disc list-inside mt-1">
                      <li>Data feed is not providing candles</li>
                      <li>Strategy interval is not running</li>
                      <li>Check server logs for errors</li>
                    </ul>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}


