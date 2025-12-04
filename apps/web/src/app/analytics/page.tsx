'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import axios from 'axios';
import { DarkModeToggle } from '../../components/DarkModeToggle';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface Trade {
  id: string;
  symbol: string;
  side: string;
  entryPrice: number;
  exitPrice: number | null;
  pnl: number | null;
  pnlPct: number | null;
  timestamp: string;
  strategyId: string;
  strategyName?: string;
}

interface AnalyticsData {
  totalTrades: number;
  profitableTrades: number;
  losingTrades: number;
  bestTrade: Trade | null;
  worstTrade: Trade | null;
  avgProfit: number;
  avgLoss: number;
  tradesByHour: Record<number, number>;
  tradesByDay: Record<string, number>;
  strategyPerformance: Array<{
    strategyId: string;
    strategyName: string;
    trades: number;
    pnl: number;
    winRate: number;
  }>;
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<'24h' | '7d' | '30d'>('7d');

  useEffect(() => {
    fetchAnalytics();
  }, [timeRange]);

  const fetchAnalytics = async () => {
    try {
      setLoading(true);
      // Get all strategies
      const strategiesRes = await axios.get(`${API_URL}/strategies?quality=good`);
      const strategies = strategiesRes.data.filter((s: any) => s.chainId !== 101); // Exclude Solana

      // Calculate time range
      const now = Date.now();
      const timeRanges = {
        '24h': now - 24 * 60 * 60 * 1000,
        '7d': now - 7 * 24 * 60 * 60 * 1000,
        '30d': now - 30 * 24 * 60 * 60 * 1000,
      };
      const fromTime = timeRanges[timeRange];

      // Fetch trades for all strategies
      const allTrades: Trade[] = [];
      for (const strategy of strategies) {
        try {
          const tradesRes = await axios.get(`${API_URL}/strategies/${strategy.id}/trades`);
          const trades = tradesRes.data.filter((t: Trade) => {
            const tradeTime = new Date(t.timestamp).getTime();
            return tradeTime >= fromTime && t.exitPrice !== null; // Only closed trades
          });
          allTrades.push(...trades.map((t: Trade) => ({
            ...t,
            strategyName: strategy.name,
          })));
        } catch {
          // Skip if error
        }
      }

      // Calculate analytics
      const profitableTrades = allTrades.filter(t => (t.pnl || 0) > 0);
      const losingTrades = allTrades.filter(t => (t.pnl || 0) < 0);
      
      const bestTrade = allTrades.length > 0
        ? allTrades.reduce((best, t) => (t.pnl || 0) > (best.pnl || 0) ? t : best)
        : null;
      
      const worstTrade = allTrades.length > 0
        ? allTrades.reduce((worst, t) => (t.pnl || 0) < (worst.pnl || 0) ? t : worst)
        : null;

      const avgProfit = profitableTrades.length > 0
        ? profitableTrades.reduce((sum, t) => sum + (t.pnl || 0), 0) / profitableTrades.length
        : 0;
      
      const avgLoss = losingTrades.length > 0
        ? losingTrades.reduce((sum, t) => sum + (t.pnl || 0), 0) / losingTrades.length
        : 0;

      // Group by hour
      const tradesByHour: Record<number, number> = {};
      allTrades.forEach(t => {
        const hour = new Date(t.timestamp).getHours();
        tradesByHour[hour] = (tradesByHour[hour] || 0) + 1;
      });

      // Group by day
      const tradesByDay: Record<string, number> = {};
      allTrades.forEach(t => {
        const day = new Date(t.timestamp).toLocaleDateString();
        tradesByDay[day] = (tradesByDay[day] || 0) + 1;
      });

      // Strategy performance
      const strategyMap: Record<string, { name: string; trades: Trade[] }> = {};
      allTrades.forEach(t => {
        if (!strategyMap[t.strategyId]) {
          strategyMap[t.strategyId] = { name: t.strategyName || 'Unknown', trades: [] };
        }
        strategyMap[t.strategyId].trades.push(t);
      });

      const strategyPerformance = Object.entries(strategyMap).map(([id, data]) => {
        const profitable = data.trades.filter(t => (t.pnl || 0) > 0).length;
        const totalPnL = data.trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
        return {
          strategyId: id,
          strategyName: data.name,
          trades: data.trades.length,
          pnl: totalPnL,
          winRate: data.trades.length > 0 ? profitable / data.trades.length : 0,
        };
      }).sort((a, b) => b.pnl - a.pnl);

      setData({
        totalTrades: allTrades.length,
        profitableTrades: profitableTrades.length,
        losingTrades: losingTrades.length,
        bestTrade,
        worstTrade,
        avgProfit,
        avgLoss,
        tradesByHour,
        tradesByDay,
        strategyPerformance,
      });
    } catch (error) {
      console.error('Error fetching analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <nav className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center space-x-4">
              <Link href="/" className="text-2xl font-bold text-gray-900 dark:text-white">
                Matcha AI
              </Link>
              <span className="text-gray-400">/</span>
              <span className="text-lg font-semibold text-gray-700 dark:text-gray-300">Analytics</span>
            </div>
            <div className="flex items-center space-x-4">
              <DarkModeToggle />
              <Link
                href="/"
                className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                ← Dashboard
              </Link>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">Trading Analytics</h1>
            <p className="text-lg text-gray-600 dark:text-gray-400">
              Deep insights into your trading performance
            </p>
          </div>
          <div className="flex gap-2">
            {(['24h', '7d', '30d'] as const).map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
                  timeRange === range
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
              >
                {range}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            <p className="mt-4 text-gray-500 dark:text-gray-400">Loading analytics...</p>
          </div>
        ) : data && data.totalTrades > 0 ? (
          <div className="space-y-8">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900 dark:to-blue-800 rounded-xl p-6 border border-blue-200 dark:border-blue-700">
                <div className="text-xs text-blue-600 dark:text-blue-300 font-medium uppercase mb-2">Total Trades</div>
                <div className="text-3xl font-bold text-blue-900 dark:text-blue-100">{data.totalTrades}</div>
              </div>
              <div className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900 dark:to-green-800 rounded-xl p-6 border border-green-200 dark:border-green-700">
                <div className="text-xs text-green-600 dark:text-green-300 font-medium uppercase mb-2">Profitable</div>
                <div className="text-3xl font-bold text-green-900 dark:text-green-100">{data.profitableTrades}</div>
                <div className="text-sm text-green-700 dark:text-green-300 mt-1">
                  {((data.profitableTrades / data.totalTrades) * 100).toFixed(1)}%
                </div>
              </div>
              <div className="bg-gradient-to-br from-red-50 to-red-100 dark:from-red-900 dark:to-red-800 rounded-xl p-6 border border-red-200 dark:border-red-700">
                <div className="text-xs text-red-600 dark:text-red-300 font-medium uppercase mb-2">Losing</div>
                <div className="text-3xl font-bold text-red-900 dark:text-red-100">{data.losingTrades}</div>
                <div className="text-sm text-red-700 dark:text-red-300 mt-1">
                  {((data.losingTrades / data.totalTrades) * 100).toFixed(1)}%
                </div>
              </div>
              <div className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900 dark:to-purple-800 rounded-xl p-6 border border-purple-200 dark:border-purple-700">
                <div className="text-xs text-purple-600 dark:text-purple-300 font-medium uppercase mb-2">Avg Profit</div>
                <div className="text-3xl font-bold text-purple-900 dark:text-purple-100">
                  ${data.avgProfit.toFixed(2)}
                </div>
                <div className="text-sm text-purple-700 dark:text-purple-300 mt-1">
                  Avg Loss: ${Math.abs(data.avgLoss).toFixed(2)}
                </div>
              </div>
            </div>

            {/* Best/Worst Trades */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {data.bestTrade && (
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">🏆 Best Trade</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Symbol:</span>
                      <span className="font-semibold text-gray-900 dark:text-white">{data.bestTrade.symbol}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">P&L:</span>
                      <span className="font-bold text-green-600 dark:text-green-400">
                        +${data.bestTrade.pnl?.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Return:</span>
                      <span className="font-semibold text-green-600 dark:text-green-400">
                        +{data.bestTrade.pnlPct?.toFixed(2)}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Time:</span>
                      <span className="text-sm text-gray-900 dark:text-white">
                        {new Date(data.bestTrade.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <Link
                      href={`/strategies/${data.bestTrade.strategyId}`}
                      className="block mt-4 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      View Strategy →
                    </Link>
                  </div>
                </div>
              )}

              {data.worstTrade && (
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-4">⚠️ Worst Trade</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Symbol:</span>
                      <span className="font-semibold text-gray-900 dark:text-white">{data.worstTrade.symbol}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">P&L:</span>
                      <span className="font-bold text-red-600 dark:text-red-400">
                        ${data.worstTrade.pnl?.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Return:</span>
                      <span className="font-semibold text-red-600 dark:text-red-400">
                        {data.worstTrade.pnlPct?.toFixed(2)}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">Time:</span>
                      <span className="text-sm text-gray-900 dark:text-white">
                        {new Date(data.worstTrade.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <Link
                      href={`/strategies/${data.worstTrade.strategyId}`}
                      className="block mt-4 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      View Strategy →
                    </Link>
                  </div>
                </div>
              )}
            </div>

            {/* Strategy Performance */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-6">Strategy Performance</h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700 dark:text-gray-300">Strategy</th>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-gray-700 dark:text-gray-300">Trades</th>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-gray-700 dark:text-gray-300">P&L</th>
                      <th className="text-right py-3 px-4 text-sm font-semibold text-gray-700 dark:text-gray-300">Win Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.strategyPerformance.map((perf) => (
                      <tr key={perf.strategyId} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="py-3 px-4">
                          <Link
                            href={`/strategies/${perf.strategyId}`}
                            className="font-semibold text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400"
                          >
                            {perf.strategyName}
                          </Link>
                        </td>
                        <td className="text-right py-3 px-4 text-gray-900 dark:text-white">{perf.trades}</td>
                        <td className={`text-right py-3 px-4 font-bold ${
                          perf.pnl >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                        }`}>
                          {perf.pnl >= 0 ? '+' : ''}${perf.pnl.toFixed(2)}
                        </td>
                        <td className={`text-right py-3 px-4 font-semibold ${
                          perf.winRate >= 0.5 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                        }`}>
                          {(perf.winRate * 100).toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Trading Activity by Hour */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-6">Trading Activity by Hour</h3>
              <div className="grid grid-cols-12 gap-2">
                {Array.from({ length: 24 }, (_, i) => i).map((hour) => {
                  const count = data.tradesByHour[hour] || 0;
                  const maxCount = Math.max(...Object.values(data.tradesByHour), 1);
                  const height = (count / maxCount) * 100;
                  return (
                    <div key={hour} className="flex flex-col items-center">
                      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-t relative" style={{ height: '100px' }}>
                        {count > 0 && (
                          <div
                            className="absolute bottom-0 w-full bg-blue-600 dark:bg-blue-500 rounded-t"
                            style={{ height: `${height}%` }}
                            title={`${count} trades`}
                          />
                        )}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{hour}h</div>
                      <div className="text-xs font-semibold text-gray-900 dark:text-white">{count}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-gray-100 dark:bg-gray-700 mb-6">
              <span className="text-4xl">📊</span>
            </div>
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">No trading data yet</h3>
            <p className="text-gray-500 dark:text-gray-400 mb-6">
              Start paper trading to see analytics
            </p>
            <Link
              href="/"
              className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Go to Dashboard
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}

