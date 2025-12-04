'use client';

import Link from 'next/link';

interface StrategyCardProps {
  strategy: {
    id: string;
    name: string;
    status: string;
    mode: string;
    baseAsset: string;
    timeframe: string;
    chainId?: number;
    createdAt: string;
  };
  performance?: {
    totalPnL: number;
    winRate: number;
    totalTrades: number;
  };
}

export function StrategyCard({ strategy, performance }: StrategyCardProps) {
  const pnl = performance?.totalPnL || 0;
  const winRate = performance?.winRate || 0;
  const trades = performance?.totalTrades || 0;
  const isProfitable = pnl > 0;

  const getChainInfo = (chainId?: number) => {
    switch (chainId) {
      case 1:
        return { name: 'Ethereum', icon: '⟠', color: 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200' };
      case 137:
        return { name: 'Polygon', icon: '⬟', color: 'bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200' };
      case 42161:
        return { name: 'Arbitrum', icon: '🔷', color: 'bg-cyan-100 dark:bg-cyan-900 text-cyan-800 dark:text-cyan-200' };
      case 101:
        return { name: 'Solana', icon: '🌐', color: 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200' };
      default:
        return { name: `Chain ${chainId}`, icon: '🔗', color: 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200' };
    }
  };
  
  const chainInfo = getChainInfo(strategy.chainId);

  return (
    <Link
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

        {performance && trades > 0 && (
          <div className="mb-4 p-4 rounded-lg bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-700/50 dark:to-gray-800/50 border border-gray-200 dark:border-gray-600">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-gray-600 dark:text-gray-400 uppercase tracking-wide">Total P&L</span>
              <span
                className={`text-xl font-bold ${
                  isProfitable
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-red-600 dark:text-red-400'
                }`}
              >
                {isProfitable ? '+' : ''}${pnl.toFixed(2)}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white dark:bg-gray-800 rounded-lg p-2 border border-gray-200 dark:border-gray-700">
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Win Rate</div>
                <div className={`text-sm font-bold ${
                  winRate >= 0.5 
                    ? 'text-green-600 dark:text-green-400' 
                    : winRate >= 0.4 
                    ? 'text-yellow-600 dark:text-yellow-400' 
                    : 'text-red-600 dark:text-red-400'
                }`}>
                  {(winRate * 100).toFixed(1)}%
                </div>
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg p-2 border border-gray-200 dark:border-gray-700">
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Trades</div>
                <div className="text-sm font-bold text-gray-900 dark:text-white">{trades}</div>
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
            <span className={`px-2 py-1 rounded text-xs font-semibold ${chainInfo.color}`}>
              {chainInfo.icon} {chainInfo.name}
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
}


