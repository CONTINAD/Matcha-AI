'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import axios from 'axios';
import { EquityCurve } from '../../../components/charts/EquityCurve';
import { PerformanceChart } from '../../../components/charts/PerformanceChart';
import { TradeDistribution } from '../../../components/charts/TradeDistribution';
import { useWebSocket } from '../../../hooks/useWebSocket';
import { ToastContainer } from '../../../components/Toast';
import { WalletConnect } from '../../../components/WalletConnect';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:4001';

interface Strategy {
  id: string;
  name: string;
  description?: string;
  mode: string;
  status: string;
  baseAsset: string;
  timeframe: string;
}

interface PerformanceSnapshot {
  timestamp: string;
  equityCurvePoint: number;
  maxDrawdown: number;
  sharpe?: number;
  winRate: number;
  totalTrades: number;
}

interface PerformanceResponse {
  snapshots: PerformanceSnapshot[];
  summary: {
    totalTrades: number;
    totalPnL: number;
    winRate: number;
    latestSnapshot?: PerformanceSnapshot;
  };
}

interface Trade {
  id: string;
  timestamp: string;
  pnl: number;
  pnlPct: number;
  side: string;
  symbol: string;
}

export default function StrategyDetail() {
  const params = useParams();
  const strategyId = params.id as string;
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [performance, setPerformance] = useState<PerformanceResponse | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [perfLoading, setPerfLoading] = useState(false);
  const [wallet, setWallet] = useState<{ id: string; address: string; chainType: string } | null>(null);
  const [showWalletConnect, setShowWalletConnect] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [trainingMetrics, setTrainingMetrics] = useState<any>(null);
  const [trainingLoading, setTrainingLoading] = useState(false);
  const [tradeFilter, setTradeFilter] = useState<'all' | 'BUY' | 'SELL' | 'profitable' | 'loss'>('all');
  const [searchSymbol, setSearchSymbol] = useState('');
  
  // WebSocket for real-time updates
  const { isConnected, lastMessage } = useWebSocket(WS_URL);

  // Define functions before useEffects that use them
  const fetchStrategy = async () => {
    try {
      const response = await axios.get(`${API_URL}/strategies/${strategyId}`);
      setStrategy(response.data);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Error fetching strategy');
    } finally {
      setLoading(false);
    }
  };

  const fetchPerformance = async () => {
    setPerfLoading(true);
    setError(null);
    try {
      const response = await axios.get<PerformanceResponse>(`${API_URL}/strategies/${strategyId}/performance`);
      setPerformance(response.data);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to load performance');
    } finally {
      setPerfLoading(false);
    }
  };

  const fetchTrades = async () => {
    try {
      const response = await axios.get<Trade[]>(`${API_URL}/strategies/${strategyId}/trades`);
      setTrades(response.data || []);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to load trades');
    }
  };

  const fetchTrainingMetrics = async () => {
    setTrainingLoading(true);
    try {
      const response = await axios.get(`${API_URL}/strategies/${strategyId}/training`);
      setTrainingMetrics(response.data);
    } catch (err: any) {
      // Training metrics are optional, don't show error
      console.log('Training metrics not available yet');
    } finally {
      setTrainingLoading(false);
    }
  };

  useEffect(() => {
    fetchStrategy();
    fetchPerformance();
    fetchTrades();
    fetchTrainingMetrics();
    
    // Subscribe to WebSocket updates for this strategy
    if (isConnected && (window as any).wsSendMessage) {
      (window as any).wsSendMessage({
        type: 'subscribe',
        strategyId: strategyId,
      });
    }
  }, [strategyId, isConnected]);
  
  // Handle WebSocket messages
  useEffect(() => {
    if (!lastMessage) return;
    
    switch (lastMessage.type) {
      case 'trade':
        if (lastMessage.data.strategyId === strategyId) {
          const trade = lastMessage.data.trade || lastMessage.data;
          // Add new trade to list (avoid duplicates)
          setTrades((prev) => {
            const exists = prev.some(t => t.id === trade.id);
            if (exists) return prev;
            return [trade, ...prev];
          });
          // Show toast notification
          if ((window as any).showToast) {
            const pnl = trade.pnl || 0;
            const message = `Trade ${trade.side} ${trade.symbol}: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`;
            (window as any).showToast(message, pnl >= 0 ? 'success' : 'error');
          }
          // Refresh performance
          fetchPerformance();
        }
        break;
      case 'performance':
        if (lastMessage.data.strategyId === strategyId) {
          const perf = lastMessage.data.performance;
          // Update performance data
          setPerformance((prev) => ({
            ...prev,
            snapshots: prev?.snapshots || [],
            summary: {
              totalTrades: perf.totalTrades || 0,
              totalPnL: perf.equity - 10000, // Assuming 10k starting
              winRate: perf.winRate || 0,
              latestSnapshot: prev?.summary?.latestSnapshot,
            },
          }));
          // Refresh to get updated snapshots
          fetchPerformance();
        }
        break;
      case 'status':
        if (lastMessage.data.strategyId === strategyId) {
          // Update strategy status
          setStrategy((prev) => prev ? { ...prev, status: lastMessage.data.status } : null);
        }
        break;
    }
  }, [lastMessage, strategyId]);

  const handleBacktest = async () => {
    try {
      setError(null);
      const response = await axios.post(`${API_URL}/strategies/${strategyId}/backtest`);
      alert(`Backtest completed! Total return: ${response.data.totalReturnPct.toFixed(2)}%`);
      fetchPerformance();
      fetchTrades();
    } catch (err) {
      console.error('Error running backtest:', err);
      setError('Failed to run backtest');
    }
  };

  const handlePaperStart = async () => {
    try {
      await axios.post(`${API_URL}/strategies/${strategyId}/paper/start`);
      alert('Paper trading started');
      fetchStrategy();
    } catch (err) {
      console.error('Error starting paper trading:', err);
      setError('Failed to start paper trading');
    }
  };

  const handlePaperStop = async () => {
    try {
      await axios.post(`${API_URL}/strategies/${strategyId}/paper/stop`);
      alert('Paper trading stopped');
      fetchStrategy();
    } catch (err) {
      console.error('Error stopping paper trading:', err);
      setError('Failed to stop paper trading');
    }
  };

  const handleLiveStart = async () => {
    if (!wallet) {
      setError('Please connect wallet first');
      setShowWalletConnect(true);
      return;
    }
    try {
      await axios.post(`${API_URL}/strategies/${strategyId}/live/start`, {
        walletId: wallet.id,
      });
      alert('Live trading started! Trades will require your approval.');
      fetchStrategy();
    } catch (err: any) {
      console.error('Error starting live trading:', err);
      setError(err?.response?.data?.message || 'Failed to start live trading');
    }
  };

  const handleLiveStop = async () => {
    try {
      await axios.post(`${API_URL}/strategies/${strategyId}/live/stop`);
      alert('Live trading stopped');
      fetchStrategy();
    } catch (err) {
      console.error('Error stopping live trading:', err);
      setError('Failed to stop live trading');
    }
  };

  const equityData = useMemo(() => {
    if (!performance?.snapshots) return [];
    return performance.snapshots
      .slice()
      .reverse()
      .map((snap) => ({
        timestamp: new Date(snap.timestamp).getTime(),
        equity: snap.equityCurvePoint,
        drawdown: snap.maxDrawdown ? -snap.maxDrawdown : 0,
      }));
  }, [performance]);

  const pnlSeries = useMemo(() => {
    const ordered = trades
      .slice()
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    let cumulative = 0;
    return ordered.map((t) => {
      cumulative += t.pnl;
      return {
        timestamp: new Date(t.timestamp).getTime(),
        cumulativePnl: cumulative,
        tradePnl: t.pnl,
      };
    });
  }, [trades]);

  const tradePoints = useMemo(
    () =>
      trades.map((t) => ({
        timestamp: new Date(t.timestamp).getTime(),
        pnl: t.pnl,
        pnlPct: t.pnlPct,
      })),
    [trades]
  );

  if (loading) {
    return <div className="p-8">Loading...</div>;
  }

  if (!strategy) {
    return <div className="p-8">Strategy not found</div>;
  }

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
            <div className="flex items-center gap-4">
              {isConnected ? (
                <span className="text-xs text-green-600 dark:text-green-400">● Live</span>
              ) : (
                <span className="text-xs text-gray-400">○ Offline</span>
              )}
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">{strategy.name}</h1>
              <div className="flex items-center gap-4 text-sm">
                <span className={`px-3 py-1 rounded-full font-semibold ${
                  strategy.mode === 'LIVE'
                    ? 'bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200'
                    : strategy.mode === 'PAPER'
                    ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'
                }`}>
                  {strategy.mode}
                </span>
                <span className={`px-3 py-1 rounded-full font-semibold ${
                  strategy.status === 'ACTIVE'
                    ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200'
                }`}>
                  {strategy.status}
                </span>
                {isConnected && (
                  <span className="px-3 py-1 rounded-full bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 font-semibold flex items-center gap-2">
                    <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
                    Live Connection
                  </span>
                )}
              </div>
            </div>
            <Link
              href="/"
              className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              ← Dashboard
            </Link>
          </div>
          {strategy.description && (
            <p className="text-gray-600 dark:text-gray-400 mt-2">{strategy.description}</p>
          )}
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-red-800">
            {error}
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="text-2xl font-bold mb-6 text-gray-900 dark:text-white">Quick Actions</h2>
            <div className="space-y-3">
              <button
                onClick={handleBacktest}
                className="w-full px-6 py-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all shadow-lg hover:shadow-xl font-semibold text-lg"
              >
                🚀 Run Backtest
              </button>
              <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
                Test your strategy against historical data
              </p>

              {strategy.mode === 'PAPER' && (
                <>
                  {strategy.status === 'ACTIVE' ? (
                    <button
                      onClick={handlePaperStop}
                      className="w-full px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
                    >
                      Stop Paper Trading
                    </button>
                  ) : (
                    <button
                      onClick={handlePaperStart}
                      className="w-full px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
                    >
                      Start Paper Trading
                    </button>
                  )}
                </>
              )}

              {strategy.mode === 'LIVE' && (
                <div className="space-y-3">
                  {!wallet ? (
                    <>
                      <button
                        onClick={() => setShowWalletConnect(true)}
                        className="w-full px-6 py-4 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-lg hover:from-purple-700 hover:to-pink-700 transition-all shadow-lg hover:shadow-xl font-semibold"
                      >
                        🔗 Connect Wallet
                      </button>
                      <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
                        <p className="text-sm text-amber-800 dark:text-amber-200 font-medium mb-1">
                          ⚠️ Wallet Required
                        </p>
                        <p className="text-xs text-amber-600 dark:text-amber-400">
                          Connect your EVM or Solana wallet to enable live trading with real funds
                        </p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border-2 border-green-300 dark:border-green-700">
                        <p className="text-sm text-green-800 dark:text-green-200 font-semibold mb-2">
                          ✅ Wallet Connected
                        </p>
                        <p className="text-xs text-green-600 dark:text-green-400 font-mono">
                          {wallet.address.slice(0, 8)}...{wallet.address.slice(-6)}
                        </p>
                        <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                          Chain: {wallet.chainType}
                        </p>
                      </div>
                      {strategy.status === 'ACTIVE' ? (
                        <>
                          <button
                            onClick={handleLiveStop}
                            className="w-full px-6 py-4 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-all shadow-lg hover:shadow-xl font-semibold"
                          >
                            ⏹️ Stop Live Trading
                          </button>
                          <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
                            ⚠️ This will stop all live trades immediately
                          </p>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={handleLiveStart}
                            className="w-full px-6 py-4 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-lg hover:from-green-700 hover:to-emerald-700 transition-all shadow-lg hover:shadow-xl font-semibold"
                          >
                            ▶️ Start Live Trading
                          </button>
                          <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
                            ⚠️ Real money trading - trades require your approval
                          </p>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
            <h2 className="text-2xl font-bold mb-6 text-gray-900 dark:text-white">Performance Metrics</h2>
            {perfLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                <span className="ml-3 text-gray-600 dark:text-gray-400">Loading performance...</span>
              </div>
            ) : performance?.summary ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900 dark:to-blue-800 p-4 rounded-lg border border-blue-200 dark:border-blue-700">
                    <div className="text-xs text-blue-600 dark:text-blue-300 font-medium mb-1">Total P&L</div>
                    <div className={`text-2xl font-bold ${
                      (performance.summary.totalPnL || 0) > 0
                        ? 'text-green-600 dark:text-green-400'
                        : (performance.summary.totalPnL || 0) < 0
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-gray-900 dark:text-white'
                    }`}>
                      ${(performance.summary.totalPnL || 0).toFixed(2)}
                    </div>
                  </div>
                  <div className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900 dark:to-purple-800 p-4 rounded-lg border border-purple-200 dark:border-purple-700">
                    <div className="text-xs text-purple-600 dark:text-purple-300 font-medium mb-1">Win Rate</div>
                    <div className="text-2xl font-bold text-purple-900 dark:text-purple-100">
                      {performance.summary.winRate
                        ? `${(performance.summary.winRate * 100).toFixed(1)}%`
                        : '0%'}
                    </div>
                  </div>
                </div>
                <div className="bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-700 p-4 rounded-lg border border-gray-200 dark:border-gray-600">
                  <div className="text-xs text-gray-600 dark:text-gray-400 font-medium mb-1">Total Trades</div>
                  <div className="text-xl font-bold text-gray-900 dark:text-white">
                    {performance.summary.totalTrades || 0}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                <p>No performance data yet</p>
                <p className="text-xs mt-2">Run a backtest to see results</p>
              </div>
            )}
          </div>
        </div>

        {/* Training Metrics & Buy/Sell Stats */}
        {trainingMetrics && (
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-2xl font-bold mb-6 text-gray-900 dark:text-white">🧠 AI Training Progress</h2>
              {trainingLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900 dark:to-green-800 p-4 rounded-lg border border-green-200 dark:border-green-700">
                      <div className="text-xs text-green-600 dark:text-green-300 font-medium mb-1">Prediction Accuracy</div>
                      <div className="text-2xl font-bold text-green-900 dark:text-green-100">
                        {trainingMetrics.accuracy ? `${(trainingMetrics.accuracy * 100).toFixed(1)}%` : 'N/A'}
                      </div>
                      <div className="text-xs text-green-600 dark:text-green-400 mt-1">
                        {trainingMetrics.evaluatedPredictions || 0} predictions evaluated
                      </div>
                    </div>
                    <div className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900 dark:to-blue-800 p-4 rounded-lg border border-blue-200 dark:border-blue-700">
                      <div className="text-xs text-blue-600 dark:text-blue-300 font-medium mb-1">Improvement</div>
                      <div className="text-2xl font-bold text-blue-900 dark:text-blue-100">
                        {trainingMetrics.improvement || 'N/A'}
                      </div>
                      <div className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                        Recent: {trainingMetrics.recentAccuracy || 'N/A'} | Older: {trainingMetrics.olderAccuracy || 'N/A'}
                      </div>
                    </div>
                  </div>
                  {trainingMetrics.recommendations && trainingMetrics.recommendations.length > 0 && (
                    <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg">
                      <div className="text-sm font-semibold text-gray-900 dark:text-white mb-2">💡 AI Recommendations:</div>
                      <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
                        {trainingMetrics.recommendations.slice(0, 3).map((rec: string, i: number) => (
                          <li key={i}>• {rec}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
              <h2 className="text-2xl font-bold mb-6 text-gray-900 dark:text-white">📊 Buy/Sell Statistics</h2>
              {trainingMetrics.buySellStats ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900 dark:to-green-800 p-4 rounded-lg border border-green-200 dark:border-green-700">
                      <div className="text-xs text-green-600 dark:text-green-300 font-medium mb-1">🟢 BUY Trades</div>
                      <div className="text-xl font-bold text-green-900 dark:text-green-100">
                        {trainingMetrics.buySellStats.totalBuys || 0}
                      </div>
                      <div className="text-xs text-green-600 dark:text-green-400 mt-1">
                        Win Rate: {trainingMetrics.buySellStats.buyWinRate || '0%'}
                      </div>
                      <div className="text-xs text-green-600 dark:text-green-400">
                        Avg P&L: ${(trainingMetrics.buySellStats.avgBuyPnl || 0).toFixed(2)}
                      </div>
                    </div>
                    <div className="bg-gradient-to-br from-red-50 to-red-100 dark:from-red-900 dark:to-red-800 p-4 rounded-lg border border-red-200 dark:border-red-700">
                      <div className="text-xs text-red-600 dark:text-red-300 font-medium mb-1">🔴 SELL Trades</div>
                      <div className="text-xl font-bold text-red-900 dark:text-red-100">
                        {trainingMetrics.buySellStats.totalSells || 0}
                      </div>
                      <div className="text-xs text-red-600 dark:text-red-400 mt-1">
                        Win Rate: {trainingMetrics.buySellStats.sellWinRate || '0%'}
                      </div>
                      <div className="text-xs text-red-600 dark:text-red-400">
                        Avg P&L: ${(trainingMetrics.buySellStats.avgSellPnl || 0).toFixed(2)}
                      </div>
                    </div>
                  </div>
                  <div className="bg-gray-50 dark:bg-gray-700 p-3 rounded-lg">
                    <div className="text-xs text-gray-600 dark:text-gray-400">
                      <strong>Total:</strong> {trainingMetrics.buySellStats.totalBuys + trainingMetrics.buySellStats.totalSells} trades
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  <p>No buy/sell statistics yet</p>
                  <p className="text-xs mt-2">Start trading to see statistics</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Easy Go Live Section */}
        {strategy && strategy.mode === 'PAPER' && performance && performance.summary && performance.summary.totalTrades >= 20 && (
          <div className="mt-8 bg-gradient-to-r from-purple-600 to-pink-600 rounded-xl shadow-lg border border-purple-500 p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-2xl font-bold text-white mb-2">🚀 Ready for Live Trading?</h3>
                <p className="text-purple-100 text-sm">
                  This strategy has {performance.summary.totalTrades} trades with {((performance.summary.winRate || 0) * 100).toFixed(1)}% win rate.
                  {strategy.chainId === 101 ? (
                    <span className="block mt-1">Perfect for Solana! Connect your Solana wallet to start.</span>
                  ) : (
                    <span className="block mt-1">Connect your wallet to start live trading with real funds.</span>
                  )}
                </p>
              </div>
              <div className="flex flex-col gap-2">
                {!wallet ? (
                  <button
                    onClick={() => setShowWalletConnect(true)}
                    className="px-6 py-3 bg-white text-purple-600 rounded-lg hover:bg-purple-50 transition-all shadow-lg hover:shadow-xl font-semibold"
                  >
                    {strategy.chainId === 101 ? '🔗 Connect Solana Wallet' : '🔗 Connect Wallet'}
                  </button>
                ) : (
                  <button
                    onClick={async () => {
                      try {
                        // Update strategy to LIVE mode
                        await axios.put(`${API_URL}/strategies/${strategyId}`, { mode: 'LIVE' });
                        setSuccess('Strategy updated to LIVE mode!');
                        fetchStrategy();
                        setShowWalletConnect(false);
                      } catch (err: any) {
                        setError(err?.response?.data?.error || 'Failed to update strategy');
                      }
                    }}
                    className="px-6 py-3 bg-white text-purple-600 rounded-lg hover:bg-purple-50 transition-all shadow-lg hover:shadow-xl font-semibold"
                  >
                    ✅ Go Live Now
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {equityData.length > 0 && (
          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-2xl font-bold text-gray-900 dark:text-white">Equity Curve</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Portfolio value over time</p>
                </div>
                <span className="px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full text-xs font-semibold">
                  {equityData.length} points
                </span>
              </div>
              <EquityCurve data={equityData} />
            </div>

            {pnlSeries.length > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className="text-2xl font-bold text-gray-900 dark:text-white">P&L Over Time</h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Profit and loss progression</p>
                  </div>
                  <span className="px-3 py-1 bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 rounded-full text-xs font-semibold">
                    {trades.length} trades
                  </span>
                </div>
                <PerformanceChart data={pnlSeries} />
              </div>
            )}
          </div>
        )}

        {tradePoints.length > 0 && (
          <div className="mt-6 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-2xl font-bold text-gray-900 dark:text-white">Trade Distribution</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Win vs loss breakdown</p>
              </div>
              <span className="px-3 py-1 bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 rounded-full text-xs font-semibold">
                {tradePoints.length} trades
              </span>
            </div>
            <TradeDistribution trades={tradePoints} />
          </div>
        )}

        {equityData.length === 0 && tradePoints.length === 0 && (
          <div className="mt-8 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-8 text-center">
            <p className="text-gray-600 dark:text-gray-400 mb-4">No performance data yet</p>
            <p className="text-sm text-gray-500 dark:text-gray-500 mb-6">
              Run a backtest or start paper trading to see charts and metrics
            </p>
            <button
              onClick={handleBacktest}
              className="px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all shadow-lg hover:shadow-xl font-semibold"
            >
              🚀 Run Backtest to Get Started
            </button>
          </div>
        )}

        {/* Recent Trades Table */}
        {trades.length > 0 && (
          <div className="mt-8 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-2xl font-bold text-gray-900 dark:text-white">Recent Trades</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  {strategy?.mode === 'PAPER' ? 'Paper trading trades' : strategy?.mode === 'LIVE' ? 'Live trading trades' : 'Backtest trades'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Search symbol..."
                  value={searchSymbol}
                  onChange={(e) => setSearchSymbol(e.target.value)}
                  className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white w-32"
                />
                <select
                  value={tradeFilter}
                  onChange={(e) => setTradeFilter(e.target.value as any)}
                  className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="all">All Trades</option>
                  <option value="BUY">🟢 BUY Only</option>
                  <option value="SELL">🔴 SELL Only</option>
                  <option value="profitable">💰 Profitable</option>
                  <option value="loss">📉 Losses</option>
                </select>
                <span className="px-3 py-1 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full text-xs font-semibold">
                  {trades.filter((t) => {
                    if (tradeFilter === 'BUY' && t.side !== 'BUY') return false;
                    if (tradeFilter === 'SELL' && t.side !== 'SELL') return false;
                    if (tradeFilter === 'profitable' && t.pnl <= 0) return false;
                    if (tradeFilter === 'loss' && t.pnl >= 0) return false;
                    if (searchSymbol && !t.symbol.toLowerCase().includes(searchSymbol.toLowerCase())) return false;
                    return true;
                  }).length} shown
                </span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">Time</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">Side</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">Symbol</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">Size</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">Entry</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">Exit</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">P&L</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">Fees</th>
                  </tr>
                </thead>
                <tbody>
                  {trades
                    .filter((trade) => {
                      if (tradeFilter === 'BUY' && trade.side !== 'BUY') return false;
                      if (tradeFilter === 'SELL' && trade.side !== 'SELL') return false;
                      if (tradeFilter === 'profitable' && trade.pnl <= 0) return false;
                      if (tradeFilter === 'loss' && trade.pnl >= 0) return false;
                      if (searchSymbol && !trade.symbol.toLowerCase().includes(searchSymbol.toLowerCase())) return false;
                      return true;
                    })
                    .slice(0, 50)
                    .map((trade) => {
                    const isBuy = trade.side === 'BUY';
                    const isProfitable = trade.pnl > 0;
                    return (
                      <tr key={trade.id || trade.timestamp} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td className="py-3 px-4 text-sm text-gray-600 dark:text-gray-400">
                          {new Date(trade.timestamp).toLocaleString()}
                        </td>
                        <td className="py-3 px-4">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                            isBuy 
                              ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' 
                              : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                          }`}>
                            {isBuy ? '🟢 BUY' : '🔴 SELL'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-sm font-medium text-gray-900 dark:text-white">{trade.symbol}</td>
                        <td className="py-3 px-4 text-sm text-right text-gray-600 dark:text-gray-400">
                          {typeof trade.size === 'number' ? trade.size.toFixed(4) : trade.size}
                        </td>
                        <td className="py-3 px-4 text-sm text-right text-gray-600 dark:text-gray-400">
                          ${typeof (trade as any).entryPrice === 'number' ? (trade as any).entryPrice.toFixed(2) : 'N/A'}
                        </td>
                        <td className="py-3 px-4 text-sm text-right text-gray-600 dark:text-gray-400">
                          ${typeof (trade as any).exitPrice === 'number' ? (trade as any).exitPrice.toFixed(2) : 'N/A'}
                        </td>
                        <td className={`py-3 px-4 text-sm text-right font-semibold ${
                          isProfitable 
                            ? 'text-green-600 dark:text-green-400' 
                            : 'text-red-600 dark:text-red-400'
                        }`}>
                          {isProfitable ? '+' : ''}${trade.pnl.toFixed(2)}
                        </td>
                        <td className="py-3 px-4 text-sm text-right text-gray-500 dark:text-gray-500">
                          ${typeof (trade as any).fees === 'number' ? (trade as any).fees.toFixed(2) : '0.00'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {trades.length > 50 && (
                <div className="mt-4 text-center text-sm text-gray-500 dark:text-gray-400">
                  Showing 50 of {trades.length} trades
                </div>
              )}
            </div>
          </div>
        )}

        {showWalletConnect && (
          <div className="mt-6">
            <WalletConnect
              onConnected={(connectedWallet) => {
                setWallet(connectedWallet);
                setShowWalletConnect(false);
                setSuccess('Wallet connected successfully!');
              }}
            />
          </div>
        )}
      </main>
    </div>
  );
}
