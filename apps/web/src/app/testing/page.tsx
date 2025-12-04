'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import axios from 'axios';
import { ProfitabilityProgress } from '../../components/ProfitabilityProgress';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface StrategyProgress {
  id: string;
  name: string;
  status: 'ready' | 'testing' | 'needs_improvement';
  daysTesting: number;
  totalTrades: number;
  latestCheck: {
    timestamp: string;
    passed: boolean;
    sharpe: number | null;
    avgReturn: number | null;
    winRate: number | null;
    maxDrawdown: number | null;
  } | null;
}

interface TestingStatus {
  totalStrategies: number;
  readyForLive: number;
  inTesting: number;
  needsImprovement: number;
  totalTrades: number;
  totalDaysTesting: number;
  strategies: StrategyProgress[];
}

export default function TestingDashboard() {
  const [status, setStatus] = useState<TestingStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedStrategy, setSelectedStrategy] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await axios.get(`${API_URL}/testing/status`);
      setStatus(response.data);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to load testing status');
      console.error('Error fetching testing status:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const handleRunCheck = async (strategyId: string) => {
    try {
      await axios.post(`${API_URL}/testing/strategies/${strategyId}/check`);
      fetchStatus(); // Refresh after check
    } catch (err: any) {
      console.error('Error running check:', err);
      alert('Failed to run profitability check');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="mt-4 text-gray-500 dark:text-gray-400">Loading testing dashboard...</p>
        </div>
      </div>
    );
  }

  if (error || !status) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 dark:text-red-400 font-semibold mb-4">Error loading dashboard</p>
          <p className="text-gray-500 dark:text-gray-400 mb-4">{error || 'Unknown error'}</p>
          <button
            onClick={fetchStatus}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <nav className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <Link href="/" className="text-2xl font-bold text-gray-900 dark:text-white">
                Matcha AI
              </Link>
            </div>
            <div className="flex items-center gap-4">
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
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">
            Extended Testing Dashboard
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Monitor profitability progress for Solana strategies before live trading
          </p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900 dark:to-blue-800 rounded-lg p-6 border border-blue-200 dark:border-blue-700">
            <div className="text-xs text-blue-600 dark:text-blue-300 font-medium mb-1">Total Strategies</div>
            <div className="text-3xl font-bold text-blue-900 dark:text-blue-100">{status.totalStrategies}</div>
          </div>
          <div className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900 dark:to-green-800 rounded-lg p-6 border border-green-200 dark:border-green-700">
            <div className="text-xs text-green-600 dark:text-green-300 font-medium mb-1">Ready for Live</div>
            <div className="text-3xl font-bold text-green-900 dark:text-green-100">{status.readyForLive}</div>
          </div>
          <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 dark:from-yellow-900 dark:to-yellow-800 rounded-lg p-6 border border-yellow-200 dark:border-yellow-700">
            <div className="text-xs text-yellow-600 dark:text-yellow-300 font-medium mb-1">In Testing</div>
            <div className="text-3xl font-bold text-yellow-900 dark:text-yellow-100">{status.inTesting}</div>
          </div>
          <div className="bg-gradient-to-br from-red-50 to-red-100 dark:from-red-900 dark:to-red-800 rounded-lg p-6 border border-red-200 dark:border-red-700">
            <div className="text-xs text-red-600 dark:text-red-300 font-medium mb-1">Needs Improvement</div>
            <div className="text-3xl font-bold text-red-900 dark:text-red-100">{status.needsImprovement}</div>
          </div>
        </div>

        {/* Strategy List */}
        {status.strategies.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-12 text-center">
            <p className="text-gray-500 dark:text-gray-400 mb-4">No Solana strategies in testing</p>
            <Link
              href="/strategies/new"
              className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Create Strategy
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            {status.strategies.map((strategy) => (
              <div
                key={strategy.id}
                className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden"
              >
                <div className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-xl font-bold text-gray-900 dark:text-white">{strategy.name}</h3>
                      <div className="flex items-center gap-4 mt-2 text-sm text-gray-500 dark:text-gray-400">
                        <span>Testing for {strategy.daysTesting} days</span>
                        <span>•</span>
                        <span>{strategy.totalTrades} trades</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className={`px-4 py-2 rounded-lg font-semibold ${
                          strategy.status === 'ready'
                            ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                            : strategy.status === 'needs_improvement'
                            ? 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200'
                            : 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200'
                        }`}
                      >
                        {strategy.status === 'ready'
                          ? '✅ Ready for Live'
                          : strategy.status === 'needs_improvement'
                          ? '⚠️ Needs Improvement'
                          : '🔄 In Testing'}
                      </span>
                      <button
                        onClick={() => handleRunCheck(strategy.id)}
                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors text-sm"
                      >
                        Run Check
                      </button>
                      <button
                        onClick={() => setSelectedStrategy(selectedStrategy === strategy.id ? null : strategy.id)}
                        className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors text-sm"
                      >
                        {selectedStrategy === strategy.id ? 'Hide' : 'Show'} Details
                      </button>
                      <Link
                        href={`/strategies/${strategy.id}`}
                        className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors text-sm"
                      >
                        View Strategy
                      </Link>
                    </div>
                  </div>

                  {selectedStrategy === strategy.id && (
                    <div className="mt-6">
                      <ProfitabilityProgress strategyId={strategy.id} autoRefresh={true} />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}



