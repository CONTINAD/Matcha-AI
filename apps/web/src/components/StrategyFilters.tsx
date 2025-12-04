'use client';

import { useState } from 'react';

export interface FilterOptions {
  status: 'all' | 'ACTIVE' | 'PAUSED';
  mode: 'all' | 'PAPER' | 'LIVE' | 'SIMULATION' | 'BACKTEST';
  chainId: 'all' | '1' | '137' | '42161' | 'evm-only'; // 'evm-only' filters out Solana (101)
  timeframe: 'all' | '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
  sortBy: 'name' | 'created' | 'trades' | 'pnl' | 'winRate';
  sortOrder: 'asc' | 'desc';
  search: string;
}

interface StrategyFiltersProps {
  filters: FilterOptions;
  onFiltersChange: (filters: FilterOptions) => void;
  totalStrategies: number;
}

export function StrategyFilters({ filters, onFiltersChange, totalStrategies }: StrategyFiltersProps) {
  const [showFilters, setShowFilters] = useState(false);

  const updateFilter = (key: keyof FilterOptions, value: any) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const clearFilters = () => {
    onFiltersChange({
      status: 'all',
      mode: 'all',
      chainId: 'evm-only', // Default to EVM only (exclude Solana)
      timeframe: 'all',
      sortBy: 'created',
      sortOrder: 'desc',
      search: '',
    });
  };

  const activeFilterCount = [
    filters.status !== 'all',
    filters.mode !== 'all',
    filters.chainId !== 'all',
    filters.timeframe !== 'all',
    filters.search !== '',
  ].filter(Boolean).length;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <input
            type="text"
            placeholder="Search strategies..."
            value={filters.search}
            onChange={(e) => updateFilter('search', e.target.value)}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent w-64"
          />
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors flex items-center gap-2"
          >
            <span>🔍 Filters</span>
            {activeFilterCount > 0 && (
              <span className="px-2 py-0.5 bg-blue-500 text-white text-xs rounded-full">
                {activeFilterCount}
              </span>
            )}
          </button>
          {activeFilterCount > 0 && (
            <button
              onClick={clearFilters}
              className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors text-sm"
            >
              Clear all
            </button>
          )}
        </div>
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {totalStrategies} strateg{totalStrategies !== 1 ? 'ies' : 'y'}
        </div>
      </div>

      {showFilters && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Status
            </label>
            <select
              value={filters.status}
              onChange={(e) => updateFilter('status', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="all">All</option>
              <option value="ACTIVE">Active</option>
              <option value="PAUSED">Paused</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Mode
            </label>
            <select
              value={filters.mode}
              onChange={(e) => updateFilter('mode', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="all">All</option>
              <option value="PAPER">Paper</option>
              <option value="LIVE">Live</option>
              <option value="SIMULATION">Simulation</option>
              <option value="BACKTEST">Backtest</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Chain
            </label>
            <select
              value={filters.chainId}
              onChange={(e) => updateFilter('chainId', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="evm-only">EVM Chains Only</option>
              <option value="all">All Chains</option>
              <option value="1">⟠ Ethereum</option>
              <option value="137">⬟ Polygon</option>
              <option value="42161">🔷 Arbitrum</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Timeframe
            </label>
            <select
              value={filters.timeframe}
              onChange={(e) => updateFilter('timeframe', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="all">All</option>
              <option value="1m">1m</option>
              <option value="5m">5m</option>
              <option value="15m">15m</option>
              <option value="1h">1h</option>
              <option value="4h">4h</option>
              <option value="1d">1d</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              Sort By
            </label>
            <select
              value={filters.sortBy}
              onChange={(e) => updateFilter('sortBy', e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="created">Created</option>
              <option value="name">Name</option>
              <option value="trades">Trades</option>
              <option value="pnl">P&L</option>
              <option value="winRate">Win Rate</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}


