'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import axios from 'axios';
import { DarkModeToggle } from '../components/DarkModeToggle';
import { ToastContainer } from '../components/Toast';
import { LiveActivity } from '../components/LiveActivity';
import { SystemStatus } from '../components/SystemStatus';
import { PortfolioView } from '../components/PortfolioView';
import { StrategyFilters, FilterOptions } from '../components/StrategyFilters';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface Strategy {
  id: string;
  name: string;
  mode: string;
  status: string;
  baseAsset: string;
  timeframe: string;
  createdAt: string;
}

interface PerformanceSummary {
  totalPnL: number;
  winRate: number;
  totalTrades: number;
}

export default function Dashboard() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [performanceData, setPerformanceData] = useState<Record<string, PerformanceSummary>>({});
  const [bestStrategies, setBestStrategies] = useState<any[]>([]);
  const [showBest, setShowBest] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [mounted, setMounted] = useState(false);
  const [filters, setFilters] = useState<FilterOptions>({
    status: 'all',
    mode: 'all',
    chainId: 'all',
    timeframe: 'all',
    sortBy: 'created',
    sortOrder: 'desc',
    search: '',
  });

  useEffect(() => {
    setMounted(true);
    fetchStrategies();
    fetchBestStrategies();
  }, []);

  const fetchBestStrategies = async () => {
    try {
      const response = await axios.get(`${API_URL}/strategies/best?period=day&limit=5`);
      if (response.data?.strategies) {
        setBestStrategies(response.data.strategies);
      }
    } catch (error) {
      console.error('Error fetching best strategies:', error);
    }
  };

  // Fetch performance data for each strategy
  useEffect(() => {
    if (strategies.length > 0) {
      strategies.forEach((strategy) => {
        axios
          .get(`${API_URL}/strategies/${strategy.id}/performance`)
          .then((res) => {
            const summary = res.data?.summary || {};
            setPerformanceData((prev) => ({
              ...prev,
              [strategy.id]: {
                totalPnL: summary.totalPnL || 0,
                winRate: summary.winRate || 0,
                totalTrades: summary.totalTrades || 0,
              },
            }));
          })
          .catch(() => {
            // Silently fail - performance data is optional
          });
      });
    }
  }, [strategies]);

  const fetchStrategies = async () => {
    try {
      // Only fetch good/active strategies
      const response = await axios.get(`${API_URL}/strategies?quality=good`, {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (Array.isArray(response.data)) {
        setStrategies(response.data);
        setLastRefresh(new Date());
      } else {
        console.error('Invalid response format:', response.data);
        setStrategies([]);
      }
    } catch (error: any) {
      console.error('Error fetching strategies:', error);
      // Retry once after 2 seconds
      setTimeout(() => {
        axios.get(`${API_URL}/strategies?quality=good`)
          .then(res => {
            if (Array.isArray(res.data)) {
              setStrategies(res.data);
              setLastRefresh(new Date());
            }
          })
          .catch(err => console.error('Retry failed:', err));
      }, 2000);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    setLoading(true);
    fetchStrategies();
    fetchBestStrategies();
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <ToastContainer />
      <nav className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <Link href="/" className="text-2xl font-bold text-gray-900 dark:text-white">
                Matcha AI
              </Link>
            </div>
            <div className="flex items-center space-x-4">
              <button
                onClick={handleRefresh}
                className="px-3 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
                title="Refresh data"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
              <DarkModeToggle />
              <Link
                href="/strategies/new"
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                New Strategy
              </Link>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-3">
                Matcha AI Trading
                <span className="text-2xl">🤖</span>
              </h1>
              <p className="text-lg text-gray-600 dark:text-gray-400">
                AI-powered crypto trading strategies. Create, backtest, and trade automatically.
              </p>
              <div className="flex items-center gap-4 mt-2 text-sm text-gray-500 dark:text-gray-400">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                  Live Trading
                </span>
                <span>•</span>
                <span>Real-time AI Decisions</span>
                <span>•</span>
                <span>Multi-Chain Support</span>
              </div>
              {mounted && lastRefresh && (
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  Last updated: {lastRefresh.toLocaleTimeString()}
                </p>
              )}
            </div>
            <Link
              href="/strategies/new"
              className="px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all shadow-lg hover:shadow-xl font-semibold"
            >
              + Create Strategy
            </Link>
          </div>
        </div>

        {strategies.length > 0 && (
          <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900 dark:to-blue-800 rounded-lg p-4 border border-blue-200 dark:border-blue-700">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-blue-600 dark:text-blue-300 font-medium uppercase tracking-wide">Total Strategies</div>
                  <div className="text-3xl font-bold text-blue-900 dark:text-blue-100 mt-1">{strategies.length}</div>
                </div>
                <div className="text-2xl">📊</div>
              </div>
            </div>
            <div className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900 dark:to-green-800 rounded-lg p-4 border border-green-200 dark:border-green-700">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-green-600 dark:text-green-300 font-medium uppercase tracking-wide">Active Now</div>
                  <div className="text-3xl font-bold text-green-900 dark:text-green-100 mt-1">
                    {strategies.filter((s) => s.status === 'ACTIVE').length}
                  </div>
                </div>
                <div className="text-2xl">⚡</div>
              </div>
            </div>
            <div className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900 dark:to-purple-800 rounded-lg p-4 border border-purple-200 dark:border-purple-700">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-purple-600 dark:text-purple-300 font-medium uppercase tracking-wide">Total Trades</div>
                  <div className="text-3xl font-bold text-purple-900 dark:text-purple-100 mt-1">
                    {Object.values(performanceData).reduce((sum, p) => sum + (p.totalTrades || 0), 0)}
                  </div>
                </div>
                <div className="text-2xl">💹</div>
              </div>
            </div>
            <div className="bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-900 dark:to-amber-800 rounded-lg p-4 border border-amber-200 dark:border-amber-700">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-amber-600 dark:text-amber-300 font-medium uppercase tracking-wide">Total P&L</div>
                  <div className={`text-3xl font-bold mt-1 ${
                    Object.values(performanceData).reduce((sum, p) => sum + (p.totalPnL || 0), 0) >= 0
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}>
                    {Object.values(performanceData).reduce((sum, p) => sum + (p.totalPnL || 0), 0) >= 0 ? '+' : ''}
                    ${Object.values(performanceData).reduce((sum, p) => sum + (p.totalPnL || 0), 0).toFixed(2)}
                  </div>
                </div>
                <div className="text-2xl">💰</div>
              </div>
            </div>
          </div>
        )}

        {/* Portfolio Overview */}
        {strategies.length > 0 && <PortfolioView />}

        {/* Live Activity Dashboard */}
        <LiveActivity />

        {bestStrategies.length > 0 && showBest && (
          <div className="mb-8 bg-gradient-to-r from-yellow-50 via-amber-50 to-orange-50 dark:from-yellow-900/20 dark:via-amber-900/20 dark:to-orange-900/20 rounded-xl p-6 border-2 border-yellow-300 dark:border-yellow-700 shadow-lg">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  ⭐ Best Strategies Today
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  Top performing strategies ranked by profitability
                </p>
              </div>
              <button
                onClick={() => setShowBest(false)}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                ✕
              </button>
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {bestStrategies.map((best, idx) => {
                const perf = best.performance;
                const isProfitable = perf.totalPnL > 0;
                return (
                  <Link
                    key={best.id}
                    href={`/strategies/${best.id}`}
                    className="bg-white dark:bg-gray-800 rounded-lg p-4 border-2 border-yellow-300 dark:border-yellow-700 hover:shadow-xl transition-all"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-lg font-bold text-yellow-600 dark:text-yellow-400">#{idx + 1}</span>
                      <span className={`px-2 py-1 text-xs rounded font-semibold ${
                        isProfitable
                          ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'
                      }`}>
                        {isProfitable ? '💰 Profitable' : '📊 Active'}
                      </span>
                    </div>
                    <h3 className="font-bold text-gray-900 dark:text-white mb-2">{best.name}</h3>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">P&L:</span>
                        <span className={`font-bold ${
                          isProfitable
                            ? 'text-green-600 dark:text-green-400'
                            : 'text-red-600 dark:text-red-400'
                        }`}>
                          ${perf.totalPnL.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Win Rate:</span>
                        <span className="font-semibold text-gray-900 dark:text-white">
                          {(perf.winRate * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Trades:</span>
                        <span className="font-semibold text-gray-900 dark:text-white">{perf.totalTrades}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Return:</span>
                        <span className={`font-bold ${
                          perf.totalReturnPct > 0
                            ? 'text-green-600 dark:text-green-400'
                            : 'text-red-600 dark:text-red-400'
                        }`}>
                          {perf.totalReturnPct > 0 ? '+' : ''}{perf.totalReturnPct.toFixed(2)}%
                        </span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-4 text-gray-500 dark:text-gray-400">Loading strategies...</p>
          </div>
        ) : strategies.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 dark:text-gray-400 mb-4">No strategies yet</p>
            <Link
              href="/strategies/new"
              className="inline-block px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              Create Your First Strategy
            </Link>
          </div>
        ) : (
          <>
            {/* Strategy Filters */}
            <StrategyFilters
              filters={filters}
              onFiltersChange={setFilters}
              totalStrategies={strategies.length}
            />

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {strategies
                .filter((strategy) => {
                  // Apply filters
                  if (filters.status !== 'all' && strategy.status !== filters.status) return false;
                  if (filters.mode !== 'all' && strategy.mode !== filters.mode) return false;
                  if (filters.chainId !== 'all' && strategy.chainId?.toString() !== filters.chainId) return false;
                  if (filters.timeframe !== 'all' && strategy.timeframe !== filters.timeframe) return false;
                  if (filters.search && !strategy.name.toLowerCase().includes(filters.search.toLowerCase())) return false;
                  return true;
                })
                .sort((a, b) => {
                  // Apply sorting
                  let comparison = 0;
                  switch (filters.sortBy) {
                    case 'name':
                      comparison = a.name.localeCompare(b.name);
                      break;
                    case 'created':
                      comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
                      break;
                    case 'trades':
                      comparison = (performanceData[a.id]?.totalTrades || 0) - (performanceData[b.id]?.totalTrades || 0);
                      break;
                    case 'pnl':
                      comparison = (performanceData[a.id]?.totalPnL || 0) - (performanceData[b.id]?.totalPnL || 0);
                      break;
                    case 'winRate':
                      comparison = (performanceData[a.id]?.winRate || 0) - (performanceData[b.id]?.winRate || 0);
                      break;
                  }
                  return filters.sortOrder === 'desc' ? -comparison : comparison;
                })
                .map((strategy) => {
              const perf = performanceData[strategy.id];
              const pnl = perf?.totalPnL || 0;
              const winRate = perf?.winRate || 0;
              const trades = perf?.totalTrades || 0;
              const isProfitable = pnl > 0;

              return (
                <Link
                  key={strategy.id}
                  href={`/strategies/${strategy.id}`}
                  className="bg-white dark:bg-gray-800 rounded-xl shadow-md hover:shadow-xl transition-all duration-300 border border-gray-200 dark:border-gray-700 overflow-hidden group"
                >
                  <div className="p-6">
                    <div className="flex justify-between items-start mb-4">
                      <h3 className="text-xl font-bold text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                        {strategy.name}
                      </h3>
                      <div className="flex flex-col items-end gap-1">
                        <span
                          className={`px-2 py-1 text-xs font-semibold rounded ${
                            strategy.status === 'ACTIVE'
                              ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'
                          }`}
                        >
                          {strategy.status}
                        </span>
                        <span
                          className={`px-2 py-1 text-xs font-semibold rounded ${
                            strategy.mode === 'LIVE'
                              ? 'bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200'
                              : strategy.mode === 'PAPER'
                              ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'
                          }`}
                        >
                          {strategy.mode}
                        </span>
                      </div>
                    </div>

                    {perf && trades > 0 && (
                      <div className="mb-4 p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-gray-600 dark:text-gray-400">Total P&L</span>
                          <span
                            className={`text-lg font-bold ${
                              isProfitable
                                ? 'text-green-600 dark:text-green-400'
                                : 'text-red-600 dark:text-red-400'
                            }`}
                          >
                            {isProfitable ? '+' : ''}${pnl.toFixed(2)}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <span className="text-gray-500 dark:text-gray-400">Win Rate:</span>
                            <span className="ml-1 font-semibold text-gray-900 dark:text-white">
                              {(winRate * 100).toFixed(1)}%
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-500 dark:text-gray-400">Trades:</span>
                            <span className="ml-1 font-semibold text-gray-900 dark:text-white">{trades}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="space-y-2 text-sm text-gray-600 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700 pt-3">
                      <div className="flex justify-between items-center">
                        <span className="font-medium">Base Asset:</span>
                        <span className="text-gray-900 dark:text-white font-semibold">{strategy.baseAsset}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="font-medium">Timeframe:</span>
                        <span className="px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white rounded text-xs font-semibold">
                          {strategy.timeframe}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="font-medium">Chain:</span>
                        <span className="text-gray-900 dark:text-white text-xs">
                          {strategy.chainId === 101 ? '🌐 Solana' : 
                           strategy.chainId === 1 ? '🔷 Ethereum' :
                           strategy.chainId === 137 ? '🟣 Polygon' :
                           strategy.chainId === 42161 ? '🔵 Arbitrum' : `Chain ${strategy.chainId}`}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="font-medium">Created:</span>
                        <span className="text-gray-900 dark:text-white text-xs">
                          {new Date(strategy.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 px-6 py-3 border-t border-gray-200 dark:border-gray-700">
                    <div className="text-xs font-medium text-blue-600 dark:text-blue-400 group-hover:text-blue-700 dark:group-hover:text-blue-300">
                      View Details →
                    </div>
                  </div>
                </Link>
              );
            })}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

