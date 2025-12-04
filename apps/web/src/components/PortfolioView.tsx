'use client';

import { useEffect, useState } from 'react';
import axios from 'axios';
import Link from 'next/link';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface PortfolioStats {
  totalStrategies: number;
  activeStrategies: number;
  totalTrades: number;
  totalPnL: number;
  totalReturn: number;
  winRate: number;
  bestStrategy: { id: string; name: string; pnl: number } | null;
  worstStrategy: { id: string; name: string; pnl: number } | null;
  byChain: Record<string, { count: number; pnl: number }>;
  byMode: Record<string, { count: number; pnl: number }>;
}

export function PortfolioView() {
  const [stats, setStats] = useState<PortfolioStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPortfolio = async () => {
      try {
        const strategiesRes = await axios.get(`${API_URL}/strategies?quality=good`);
        const strategies = strategiesRes.data;

        const portfolioStats: PortfolioStats = {
          totalStrategies: strategies.length,
          activeStrategies: strategies.filter((s: any) => s.status === 'ACTIVE').length,
          totalTrades: 0,
          totalPnL: 0,
          totalReturn: 0,
          winRate: 0,
          bestStrategy: null,
          worstStrategy: null,
          byChain: {},
          byMode: {},
        };

        let totalWins = 0;
        let totalClosedTrades = 0;
        const strategyPnLs: Array<{ id: string; name: string; pnl: number }> = [];

        for (const strategy of strategies) {
          try {
            const perfRes = await axios.get(`${API_URL}/strategies/${strategy.id}/performance`);
            const perf = perfRes.data?.summary || {};
            
            portfolioStats.totalTrades += perf.totalTrades || 0;
            portfolioStats.totalPnL += perf.totalPnL || 0;
            
            if (perf.totalTrades > 0) {
              totalClosedTrades += perf.totalTrades;
              totalWins += (perf.winRate || 0) * perf.totalTrades;
            }

            strategyPnLs.push({
              id: strategy.id,
              name: strategy.name,
              pnl: perf.totalPnL || 0,
            });

            // By chain (only EVM chains, exclude Solana)
            if (strategy.chainId === 101) {
              // Skip Solana strategies in portfolio breakdown
              continue;
            }
            const chainKey = strategy.chainId === 1 ? 'Ethereum' :
                           strategy.chainId === 137 ? 'Polygon' :
                           strategy.chainId === 42161 ? 'Arbitrum' : 'Other';
            if (!portfolioStats.byChain[chainKey]) {
              portfolioStats.byChain[chainKey] = { count: 0, pnl: 0 };
            }
            portfolioStats.byChain[chainKey].count++;
            portfolioStats.byChain[chainKey].pnl += perf.totalPnL || 0;

            // By mode
            const mode = strategy.mode || 'UNKNOWN';
            if (!portfolioStats.byMode[mode]) {
              portfolioStats.byMode[mode] = { count: 0, pnl: 0 };
            }
            portfolioStats.byMode[mode].count++;
            portfolioStats.byMode[mode].pnl += perf.totalPnL || 0;
          } catch {
            // Skip if error
          }
        }

        if (totalClosedTrades > 0) {
          portfolioStats.winRate = totalWins / totalClosedTrades;
        }

        // Calculate total return (assuming 10k starting per strategy)
        const startingEquity = portfolioStats.totalStrategies * 10000;
        portfolioStats.totalReturn = startingEquity > 0 
          ? (portfolioStats.totalPnL / startingEquity) * 100 
          : 0;

        // Find best/worst
        if (strategyPnLs.length > 0) {
          const sorted = [...strategyPnLs].sort((a, b) => b.pnl - a.pnl);
          portfolioStats.bestStrategy = sorted[0].pnl > 0 ? sorted[0] : null;
          portfolioStats.worstStrategy = sorted[sorted.length - 1].pnl < 0 ? sorted[sorted.length - 1] : null;
        }

        setStats(portfolioStats);
      } catch (error) {
        console.error('Error fetching portfolio:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchPortfolio();
    const interval = setInterval(fetchPortfolio, 30000); // Update every 30 seconds

    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-8">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            💼 Portfolio Overview
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Combined performance across all strategies
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900 dark:to-blue-800 p-4 rounded-lg border border-blue-200 dark:border-blue-700">
          <div className="text-xs text-blue-600 dark:text-blue-300 font-medium mb-1">Total P&L</div>
          <div className={`text-2xl font-bold ${
            stats.totalPnL >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
          }`}>
            {stats.totalPnL >= 0 ? '+' : ''}${stats.totalPnL.toFixed(2)}
          </div>
        </div>

        <div className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900 dark:to-purple-800 p-4 rounded-lg border border-purple-200 dark:border-purple-700">
          <div className="text-xs text-purple-600 dark:text-purple-300 font-medium mb-1">Total Return</div>
          <div className={`text-2xl font-bold ${
            stats.totalReturn >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
          }`}>
            {stats.totalReturn >= 0 ? '+' : ''}{stats.totalReturn.toFixed(2)}%
          </div>
        </div>

        <div className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900 dark:to-green-800 p-4 rounded-lg border border-green-200 dark:border-green-700">
          <div className="text-xs text-green-600 dark:text-green-300 font-medium mb-1">Win Rate</div>
          <div className="text-2xl font-bold text-green-900 dark:text-green-100">
            {(stats.winRate * 100).toFixed(1)}%
          </div>
        </div>

        <div className="bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-900 dark:to-amber-800 p-4 rounded-lg border border-amber-200 dark:border-amber-700">
          <div className="text-xs text-amber-600 dark:text-amber-300 font-medium mb-1">Total Trades</div>
          <div className="text-2xl font-bold text-amber-900 dark:text-amber-100">
            {stats.totalTrades}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">By Chain</h3>
          <div className="space-y-2">
            {Object.entries(stats.byChain).map(([chain, data]) => (
              <div key={chain} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-700 rounded">
                <span className="text-sm text-gray-700 dark:text-gray-300">{chain}</span>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-gray-500 dark:text-gray-400">{data.count} strategies</span>
                  <span className={`font-semibold ${
                    data.pnl >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                  }`}>
                    {data.pnl >= 0 ? '+' : ''}${data.pnl.toFixed(2)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Top Performers</h3>
          <div className="space-y-2">
            {stats.bestStrategy && (
              <Link
                href={`/strategies/${stats.bestStrategy.id}`}
                className="block p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-700 hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">
                      🏆 {stats.bestStrategy.name}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Best Performer</div>
                  </div>
                  <div className="text-lg font-bold text-green-600 dark:text-green-400">
                    +${stats.bestStrategy.pnl.toFixed(2)}
                  </div>
                </div>
              </Link>
            )}
            {stats.worstStrategy && (
              <Link
                href={`/strategies/${stats.worstStrategy.id}`}
                className="block p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-700 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">
                      ⚠️ {stats.worstStrategy.name}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">Needs Attention</div>
                  </div>
                  <div className="text-lg font-bold text-red-600 dark:text-red-400">
                    ${stats.worstStrategy.pnl.toFixed(2)}
                  </div>
                </div>
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


