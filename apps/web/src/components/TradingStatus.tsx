'use client';

import { useEffect, useState } from 'react';
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface TradingStatusData {
  strategyId: string;
  strategyName: string;
  isActive: boolean;
  status: string;
  mode: string;
  metrics: {
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
      notes: string;
    } | null;
    lastDecisionReason: string | null;
    decisionHistory: Array<{
      action: string;
      confidence: number;
      signalStrength: number;
      timestamp: string;
      notes: string;
      indicators: any;
    }>;
    signalStrengthHistory: number[];
    actionDistribution: Record<string, number>;
    dataFeedHealth: {
      lastSuccessTime: string | null;
      lastFailureTime: string | null;
      successRate: number;
      consecutiveFailures: number;
    };
  } | null;
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

interface TradingStatusProps {
  strategyId: string;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

export function TradingStatus({ strategyId, autoRefresh = true, refreshInterval = 30000 }: TradingStatusProps) {
  const [data, setData] = useState<TradingStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      const response = await axios.get(`${API_URL}/strategies/${strategyId}/trading-status`);
      setData(response.data);
      setError(null);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to load trading status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    if (autoRefresh) {
      const interval = setInterval(fetchStatus, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [strategyId, autoRefresh, refreshInterval]);

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-3 text-gray-600 dark:text-gray-400">Loading trading status...</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-red-200 dark:border-red-800 p-6">
        <p className="text-red-600 dark:text-red-400">{error || 'No trading status available'}</p>
      </div>
    );
  }

  const { metrics, lastTrade, recentTradesCount, issues, recommendations } = data;

  const getActionColor = (action: string) => {
    switch (action?.toUpperCase()) {
      case 'BUY':
        return 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200';
      case 'SELL':
        return 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200';
      case 'FLAT':
        return 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200';
      default:
        return 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200';
    }
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.7) return 'text-green-600 dark:text-green-400';
    if (confidence >= 0.5) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-red-600 dark:text-red-400';
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Trading Status Dashboard</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Real-time decision making and trade execution metrics
          </p>
        </div>
        <div className={`px-3 py-1 rounded-full text-sm font-semibold ${
          data.isActive 
            ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
            : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'
        }`}>
          {data.isActive ? '🟢 Active' : '⚪ Inactive'}
        </div>
      </div>

      {metrics ? (
        <div className="space-y-6">
          {/* Key Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900 dark:to-blue-800 p-4 rounded-lg border border-blue-200 dark:border-blue-700">
              <div className="text-xs text-blue-600 dark:text-blue-300 font-medium mb-1">Total Decisions</div>
              <div className="text-2xl font-bold text-blue-900 dark:text-blue-100">{metrics.totalDecisions}</div>
            </div>
            <div className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900 dark:to-green-800 p-4 rounded-lg border border-green-200 dark:border-green-700">
              <div className="text-xs text-green-600 dark:text-green-300 font-medium mb-1">Trades Executed</div>
              <div className="text-2xl font-bold text-green-900 dark:text-green-100">{metrics.tradesExecuted}</div>
            </div>
            <div className="bg-gradient-to-br from-red-50 to-red-100 dark:from-red-900 dark:to-red-800 p-4 rounded-lg border border-red-200 dark:border-red-700">
              <div className="text-xs text-red-600 dark:text-red-300 font-medium mb-1">Risk Blocks</div>
              <div className="text-2xl font-bold text-red-900 dark:text-red-100">{metrics.riskBlocks}</div>
            </div>
            <div className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900 dark:to-purple-800 p-4 rounded-lg border border-purple-200 dark:border-purple-700">
              <div className="text-xs text-purple-600 dark:text-purple-300 font-medium mb-1">Fast Decisions</div>
              <div className="text-2xl font-bold text-purple-900 dark:text-purple-100">{metrics.fastDecisions}</div>
            </div>
          </div>

          {/* Last Decision */}
          {metrics.lastDecision && (
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Last Decision</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Action</div>
                  <div className={`px-2 py-1 rounded text-sm font-semibold inline-block ${getActionColor(metrics.lastDecision.action)}`}>
                    {metrics.lastDecision.action}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Confidence</div>
                  <div className={`text-lg font-bold ${getConfidenceColor(metrics.lastDecision.confidence)}`}>
                    {(metrics.lastDecision.confidence * 100).toFixed(0)}%
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Position Size</div>
                  <div className="text-lg font-bold text-gray-900 dark:text-white">
                    {metrics.lastDecision.targetPositionSizePct.toFixed(1)}%
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Time</div>
                  <div className="text-sm text-gray-900 dark:text-white">
                    {metrics.lastDecisionTime ? new Date(metrics.lastDecisionTime).toLocaleTimeString() : 'N/A'}
                  </div>
                </div>
              </div>
              {metrics.lastDecision.notes && (
                <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-600">
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Notes</div>
                  <div className="text-sm text-gray-700 dark:text-gray-300">{metrics.lastDecision.notes}</div>
                </div>
              )}
            </div>
          )}

          {/* Decision History */}
          {metrics.decisionHistory && metrics.decisionHistory.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Recent Decisions</h3>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {metrics.decisionHistory.slice(0, 10).map((decision, idx) => (
                  <div key={idx} className="bg-gray-50 dark:bg-gray-700/50 rounded p-3 border border-gray-200 dark:border-gray-600">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className={`px-2 py-1 rounded text-xs font-semibold ${getActionColor(decision.action)}`}>
                          {decision.action}
                        </span>
                        <span className={`text-sm font-semibold ${getConfidenceColor(decision.confidence)}`}>
                          {(decision.confidence * 100).toFixed(0)}%
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          Signal: {decision.signalStrength.toFixed(2)}
                        </span>
                      </div>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {new Date(decision.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Data Feed Health */}
          {metrics.dataFeedHealth && (
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 border border-gray-200 dark:border-gray-600">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Data Feed Health</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Success Rate</div>
                  <div className={`text-lg font-bold ${
                    metrics.dataFeedHealth.successRate >= 0.9 
                      ? 'text-green-600 dark:text-green-400'
                      : metrics.dataFeedHealth.successRate >= 0.7
                      ? 'text-yellow-600 dark:text-yellow-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}>
                    {(metrics.dataFeedHealth.successRate * 100).toFixed(1)}%
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Consecutive Failures</div>
                  <div className={`text-lg font-bold ${
                    metrics.dataFeedHealth.consecutiveFailures === 0
                      ? 'text-green-600 dark:text-green-400'
                      : metrics.dataFeedHealth.consecutiveFailures < 3
                      ? 'text-yellow-600 dark:text-yellow-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}>
                    {metrics.dataFeedHealth.consecutiveFailures}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Last Success</div>
                  <div className="text-sm text-gray-900 dark:text-white">
                    {metrics.dataFeedHealth.lastSuccessTime 
                      ? new Date(metrics.dataFeedHealth.lastSuccessTime).toLocaleTimeString()
                      : 'Never'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Last Failure</div>
                  <div className="text-sm text-gray-900 dark:text-white">
                    {metrics.dataFeedHealth.lastFailureTime 
                      ? new Date(metrics.dataFeedHealth.lastFailureTime).toLocaleTimeString()
                      : 'None'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Issues & Recommendations */}
          {issues.length > 0 && (
            <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4 border border-amber-200 dark:border-amber-700">
              <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-200 mb-2">⚠️ Issues Detected</h3>
              <ul className="list-disc list-inside space-y-1 text-sm text-amber-700 dark:text-amber-300">
                {issues.map((issue, idx) => (
                  <li key={idx}>{issue}</li>
                ))}
              </ul>
              {recommendations.length > 0 && (
                <div className="mt-3 pt-3 border-t border-amber-200 dark:border-amber-700">
                  <h4 className="text-xs font-semibold text-amber-800 dark:text-amber-200 mb-2">Recommendations</h4>
                  <ul className="list-disc list-inside space-y-1 text-xs text-amber-600 dark:text-amber-400">
                    {recommendations.map((rec, idx) => (
                      <li key={idx}>{rec}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-8">
          <p className="text-gray-500 dark:text-gray-400">No trading metrics available. Start paper trading to see status.</p>
        </div>
      )}

      {/* Last Trade Info */}
      {lastTrade && (
        <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">Last Trade</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {lastTrade.symbol} • {lastTrade.side} • {new Date(lastTrade.timestamp).toLocaleString()}
              </p>
            </div>
            <div className={`text-lg font-bold ${
              lastTrade.pnl >= 0 
                ? 'text-green-600 dark:text-green-400'
                : 'text-red-600 dark:text-red-400'
            }`}>
              {lastTrade.pnl >= 0 ? '+' : ''}${lastTrade.pnl.toFixed(2)}
            </div>
          </div>
          <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {recentTradesCount} trades in last 24 hours
          </div>
        </div>
      )}
    </div>
  );
}

