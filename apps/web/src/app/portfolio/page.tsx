'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import axios from 'axios';
import { PortfolioView } from '../../components/PortfolioView';
import { DarkModeToggle } from '../../components/DarkModeToggle';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface Strategy {
  id: string;
  name: string;
  status: string;
  mode: string;
  chainId?: number;
  createdAt: string;
}

interface PerformanceSummary {
  totalPnL: number;
  totalTrades: number;
  winRate: number;
}

export default function PortfolioPage() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [performanceData, setPerformanceData] = useState<Record<string, PerformanceSummary>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPortfolioData();
    const interval = setInterval(fetchPortfolioData, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const fetchPortfolioData = async () => {
    try {
      const response = await axios.get(`${API_URL}/strategies?quality=good`);
      const strategiesData = response.data;
      setStrategies(strategiesData);

      // Fetch performance for each strategy
      const perfPromises = strategiesData.map(async (strategy: Strategy) => {
        try {
          const perfResponse = await axios.get(`${API_URL}/strategies/${strategy.id}/performance`);
          return {
            id: strategy.id,
            performance: perfResponse.data?.summary || { totalPnL: 0, totalTrades: 0, winRate: 0 },
          };
        } catch {
          return {
            id: strategy.id,
            performance: { totalPnL: 0, totalTrades: 0, winRate: 0 },
          };
        }
      });

      const perfResults = await Promise.all(perfPromises);
      const perfMap: Record<string, PerformanceSummary> = {};
      perfResults.forEach(({ id, performance }) => {
        perfMap[id] = performance;
      });
      setPerformanceData(perfMap);
    } catch (error) {
      console.error('Error fetching portfolio:', error);
    } finally {
      setLoading(false);
    }
  };

  const totalPnL = Object.values(performanceData).reduce((sum, p) => sum + (p.totalPnL || 0), 0);
  const totalTrades = Object.values(performanceData).reduce((sum, p) => sum + (p.totalTrades || 0), 0);
  const totalWinRate = totalTrades > 0
    ? Object.values(performanceData).reduce((sum, p) => sum + (p.winRate || 0) * (p.totalTrades || 0), 0) / totalTrades
    : 0;

  // Group strategies by chain
  const strategiesByChain: Record<string, Strategy[]> = {};
  strategies.forEach((strategy) => {
    if (strategy.chainId === 101) return; // Skip Solana
    const chainName = strategy.chainId === 1 ? 'Ethereum' :
                     strategy.chainId === 137 ? 'Polygon' :
                     strategy.chainId === 42161 ? 'Arbitrum' : 'Other';
    if (!strategiesByChain[chainName]) {
      strategiesByChain[chainName] = [];
    }
    strategiesByChain[chainName].push(strategy);
  });

  // Calculate P&L by chain
  const pnlByChain: Record<string, number> = {};
  Object.entries(strategiesByChain).forEach(([chain, chainStrategies]) => {
    pnlByChain[chain] = chainStrategies.reduce((sum, s) => {
      return sum + (performanceData[s.id]?.totalPnL || 0);
    }, 0);
  });

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
              <span className="text-lg font-semibold text-gray-700 dark:text-gray-300">Portfolio</span>
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
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">Portfolio Overview</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Complete view of your trading strategies and performance
          </p>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
            <p className="mt-4 text-gray-500 dark:text-gray-400">Loading portfolio data...</p>
          </div>
        ) : (
          <>
            {/* Portfolio Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
              <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900 dark:to-blue-800 rounded-xl p-6 border border-blue-200 dark:border-blue-700 shadow-lg">
                <div className="text-xs text-blue-600 dark:text-blue-300 font-medium uppercase tracking-wide mb-2">Total P&L</div>
                <div className={`text-4xl font-bold ${
                  totalPnL >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                }`}>
                  {totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(2)}
                </div>
              </div>

              <div className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900 dark:to-purple-800 rounded-xl p-6 border border-purple-200 dark:border-purple-700 shadow-lg">
                <div className="text-xs text-purple-600 dark:text-purple-300 font-medium uppercase tracking-wide mb-2">Total Trades</div>
                <div className="text-4xl font-bold text-purple-900 dark:text-purple-100">{totalTrades}</div>
              </div>

              <div className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900 dark:to-green-800 rounded-xl p-6 border border-green-200 dark:border-green-700 shadow-lg">
                <div className="text-xs text-green-600 dark:text-green-300 font-medium uppercase tracking-wide mb-2">Win Rate</div>
                <div className="text-4xl font-bold text-green-900 dark:text-green-100">
                  {(totalWinRate * 100).toFixed(1)}%
                </div>
              </div>

              <div className="bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-900 dark:to-amber-800 rounded-xl p-6 border border-amber-200 dark:border-amber-700 shadow-lg">
                <div className="text-xs text-amber-600 dark:text-amber-300 font-medium uppercase tracking-wide mb-2">Active Strategies</div>
                <div className="text-4xl font-bold text-amber-900 dark:text-amber-100">
                  {strategies.filter(s => s.status === 'ACTIVE').length}
                </div>
              </div>
            </div>

            {/* Portfolio View Component */}
            <PortfolioView />

            {/* Strategies by Chain */}
            <div className="mt-8 grid gap-6 md:grid-cols-3">
              {Object.entries(strategiesByChain).map(([chain, chainStrategies]) => (
                <div key={chain} className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white">{chain}</h3>
                    <div className={`px-3 py-1 rounded-full text-sm font-semibold ${
                      pnlByChain[chain] >= 0
                        ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                        : 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200'
                    }`}>
                      {pnlByChain[chain] >= 0 ? '+' : ''}${pnlByChain[chain].toFixed(2)}
                    </div>
                  </div>
                  <div className="space-y-2">
                    {chainStrategies.map((strategy) => {
                      const perf = performanceData[strategy.id];
                      return (
                        <Link
                          key={strategy.id}
                          href={`/strategies/${strategy.id}`}
                          className="block p-3 bg-gray-50 dark:bg-gray-700 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="font-semibold text-gray-900 dark:text-white">{strategy.name}</div>
                              <div className="text-xs text-gray-500 dark:text-gray-400">
                                {perf?.totalTrades || 0} trades • {strategy.status}
                              </div>
                            </div>
                            <div className={`text-sm font-bold ${
                              (perf?.totalPnL || 0) >= 0
                                ? 'text-green-600 dark:text-green-400'
                                : 'text-red-600 dark:text-red-400'
                            }`}>
                              {perf?.totalPnL ? (perf.totalPnL >= 0 ? '+' : '') + '$' + perf.totalPnL.toFixed(2) : '$0.00'}
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

