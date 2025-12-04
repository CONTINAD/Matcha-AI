'use client';

import { useEffect, useState } from 'react';
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface ProfitabilityProgressProps {
  strategyId: string;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

interface Requirement {
  target: number;
  current: number;
  passed: boolean;
}

interface ProfitabilityData {
  passed: boolean;
  progress: {
    overall: number;
    requirements: {
      sharpe: Requirement;
      return: Requirement;
      winRate: Requirement;
      drawdown: Requirement;
    };
  };
  metrics: {
    sharpe: number | null;
    avgReturn: number | null;
    winRate: number | null;
    maxDrawdown: number | null;
  };
  testing: {
    daysInTesting: number;
    totalTrades: number;
    recentTrades: number;
  };
  recommendation: 'continue_testing' | 'ready_for_live' | 'needs_improvement';
  message: string;
  lastCheck: string;
}

export function ProfitabilityProgress({ 
  strategyId, 
  autoRefresh = false,
  refreshInterval = 30000 
}: ProfitabilityProgressProps) {
  const [data, setData] = useState<ProfitabilityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await axios.get(`${API_URL}/strategies/${strategyId}/profitability-check`);
      setData(response.data);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to load profitability data');
      console.error('Error fetching profitability:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    
    if (autoRefresh) {
      const interval = setInterval(fetchData, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [strategyId, autoRefresh, refreshInterval]);

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/3"></div>
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-full"></div>
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-2/3"></div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-red-200 dark:border-red-800 p-6">
        <div className="text-red-600 dark:text-red-400">
          <p className="font-semibold">Error loading profitability data</p>
          <p className="text-sm mt-1">{error || 'Unknown error'}</p>
          <button
            onClick={fetchData}
            className="mt-3 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors text-sm"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const { progress, metrics, testing, recommendation, message } = data;

  const getProgressColor = (passed: boolean, current: number, target: number, isDrawdown = false) => {
    if (passed) return 'bg-green-500';
    if (isDrawdown) {
      // For drawdown, lower is better
      const progress = Math.min(100, (current / target) * 100);
      if (progress < 50) return 'bg-green-400';
      if (progress < 75) return 'bg-yellow-400';
      return 'bg-red-400';
    } else {
      // For other metrics, higher is better
      const progress = Math.min(100, (current / target) * 100);
      if (progress >= 100) return 'bg-green-500';
      if (progress >= 75) return 'bg-green-400';
      if (progress >= 50) return 'bg-yellow-400';
      return 'bg-red-400';
    }
  };

  const getRecommendationColor = () => {
    switch (recommendation) {
      case 'ready_for_live':
        return 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 border-green-300 dark:border-green-700';
      case 'needs_improvement':
        return 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 border-red-300 dark:border-red-700';
      default:
        return 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 border-yellow-300 dark:border-yellow-700';
    }
  };

  const getRecommendationText = () => {
    switch (recommendation) {
      case 'ready_for_live':
        return '✅ Ready for Live Trading';
      case 'needs_improvement':
        return '⚠️ Needs Improvement';
      default:
        return '🔄 Continue Testing';
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-xl font-bold text-gray-900 dark:text-white">Profitability Progress</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Testing for {testing.daysInTesting} days • {testing.totalTrades} total trades
          </p>
        </div>
        <div className={`px-4 py-2 rounded-lg border-2 font-semibold ${getRecommendationColor()}`}>
          {getRecommendationText()}
        </div>
      </div>

      {/* Overall Progress */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Overall Progress</span>
          <span className="text-lg font-bold text-gray-900 dark:text-white">
            {progress.overall.toFixed(0)}%
          </span>
        </div>
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
          <div
            className={`h-3 rounded-full transition-all duration-500 ${
              progress.overall >= 100 ? 'bg-green-500' : 
              progress.overall >= 75 ? 'bg-green-400' : 
              progress.overall >= 50 ? 'bg-yellow-400' : 
              'bg-red-400'
            }`}
            style={{ width: `${Math.min(100, progress.overall)}%` }}
          ></div>
        </div>
      </div>

      {/* Individual Requirements */}
      <div className="space-y-4">
        {/* Sharpe Ratio */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Sharpe Ratio</span>
              {progress.requirements.sharpe.passed && (
                <span className="text-green-500">✓</span>
              )}
            </div>
            <span className="text-sm font-semibold text-gray-900 dark:text-white">
              {metrics.sharpe?.toFixed(2) ?? 'N/A'} / {progress.requirements.sharpe.target}
            </span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all duration-500 ${getProgressColor(
                progress.requirements.sharpe.passed,
                progress.requirements.sharpe.current,
                progress.requirements.sharpe.target
              )}`}
              style={{ 
                width: `${Math.min(100, (progress.requirements.sharpe.current / progress.requirements.sharpe.target) * 100)}%` 
              }}
            ></div>
          </div>
        </div>

        {/* Return */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Monthly Return</span>
              {progress.requirements.return.passed && (
                <span className="text-green-500">✓</span>
              )}
            </div>
            <span className="text-sm font-semibold text-gray-900 dark:text-white">
              {metrics.avgReturn?.toFixed(1) ?? 'N/A'}% / {progress.requirements.return.target}%
            </span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all duration-500 ${getProgressColor(
                progress.requirements.return.passed,
                progress.requirements.return.current,
                progress.requirements.return.target
              )}`}
              style={{ 
                width: `${Math.min(100, (progress.requirements.return.current / progress.requirements.return.target) * 100)}%` 
              }}
            ></div>
          </div>
        </div>

        {/* Win Rate */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Win Rate</span>
              {progress.requirements.winRate.passed && (
                <span className="text-green-500">✓</span>
              )}
            </div>
            <span className="text-sm font-semibold text-gray-900 dark:text-white">
              {metrics.winRate ? (metrics.winRate * 100).toFixed(1) : 'N/A'}% / {progress.requirements.winRate.target}%
            </span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all duration-500 ${getProgressColor(
                progress.requirements.winRate.passed,
                progress.requirements.winRate.current,
                progress.requirements.winRate.target
              )}`}
              style={{ 
                width: `${Math.min(100, (progress.requirements.winRate.current / progress.requirements.winRate.target) * 100)}%` 
              }}
            ></div>
          </div>
        </div>

        {/* Max Drawdown */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Max Drawdown</span>
              {progress.requirements.drawdown.passed && (
                <span className="text-green-500">✓</span>
              )}
            </div>
            <span className="text-sm font-semibold text-gray-900 dark:text-white">
              {metrics.maxDrawdown?.toFixed(1) ?? 'N/A'}% / &lt;{progress.requirements.drawdown.target}%
            </span>
          </div>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all duration-500 ${getProgressColor(
                progress.requirements.drawdown.passed,
                progress.requirements.drawdown.current,
                progress.requirements.drawdown.target,
                true
              )}`}
              style={{ 
                width: `${Math.min(100, (progress.requirements.drawdown.current / progress.requirements.drawdown.target) * 100)}%` 
              }}
            ></div>
          </div>
        </div>
      </div>

      {/* Status Message */}
      {message && (
        <div className={`mt-6 p-4 rounded-lg ${
          data.passed 
            ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800' 
            : 'bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800'
        }`}>
          <p className={`text-sm ${
            data.passed 
              ? 'text-green-800 dark:text-green-200' 
              : 'text-yellow-800 dark:text-yellow-200'
          }`}>
            {message}
          </p>
        </div>
      )}

      {/* Last Check Time */}
      <div className="mt-4 text-xs text-gray-500 dark:text-gray-400 text-center">
        Last checked: {new Date(data.lastCheck).toLocaleString()}
      </div>
    </div>
  );
}



