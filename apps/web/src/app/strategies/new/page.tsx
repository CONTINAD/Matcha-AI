'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import axios from 'axios';
import { StrategyTemplates, STRATEGY_TEMPLATES, type StrategyTemplate } from '../../../components/StrategyTemplates';
import { DarkModeToggle } from '../../../components/DarkModeToggle';
import { ToastContainer } from '../../../components/Toast';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const STORAGE_KEY = 'matcha:new-strategy-draft';

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];

// EVM chains only (exclude Solana - chainId 101)
const SUPPORTED_CHAINS = [
  { id: 1, name: 'Ethereum', icon: '⟠' },
  { id: 137, name: 'Polygon', icon: '⬟' },
  { id: 42161, name: 'Arbitrum', icon: '🔷' },
];

// Chain-specific tokens (all supported by 0x API)
const TOKENS_BY_CHAIN: Record<number, string[]> = {
  1: ['USDC', 'USDT', 'WETH', 'DAI'], // Ethereum
  137: ['USDC', 'USDT', 'WETH'], // Polygon
  42161: ['USDC', 'USDT', 'WETH'], // Arbitrum
};

const getTokensForChain = (chainId: number): string[] => {
  return TOKENS_BY_CHAIN[chainId] || TOKENS_BY_CHAIN[1]; // Default to Ethereum
};

export default function NewStrategy() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [autoSaveState, setAutoSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    mode: 'SIMULATION' as 'SIMULATION' | 'PAPER' | 'LIVE',
    baseAsset: 'USDC',
    universe: [] as string[],
    timeframe: '1h',
    chainId: 1,
    maxPositionPct: 10,
    maxDailyLossPct: 5,
    stopLossPct: 0,
    takeProfitPct: 0,
    trailingStopPct: 0,
  });

  // Hydrate from local storage
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (saved) {
      try {
        setFormData(JSON.parse(saved));
        setSuccess('Draft loaded from previous session');
      } catch {
        // ignore
      }
    }
  }, []);

  // Auto-save draft with debounce
  useEffect(() => {
    setAutoSaveState('saving');
    const handle = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(formData));
        setAutoSaveState('saved');
        setLastSavedAt(Date.now());
      } catch {
        setAutoSaveState('idle');
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [formData]);

  const savedText = useMemo(() => {
    if (autoSaveState === 'saving') return 'Saving draft...';
    if (lastSavedAt) return `Saved ${new Date(lastSavedAt).toLocaleTimeString()}`;
    return 'Draft not saved yet';
  }, [autoSaveState, lastSavedAt]);

  const handleTemplateSelect = (template: StrategyTemplate) => {
    const config = template.config;
    setFormData({
      ...formData,
      name: template.name,
      baseAsset: config.baseAsset || 'USDC',
      universe: config.universe || [],
      timeframe: config.timeframe || '1h',
      maxPositionPct: config.riskLimits?.maxPositionPct || 10,
      maxDailyLossPct: config.riskLimits?.maxDailyLossPct || 5,
      stopLossPct: config.riskLimits?.stopLossPct || 0,
      takeProfitPct: config.riskLimits?.takeProfitPct || 0,
      trailingStopPct: config.riskLimits?.trailingStopPct || 0,
    });
    if ((window as any).showToast) {
      (window as any).showToast(`Loaded ${template.name} template`, 'success');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      // Build payload matching API expectations
      const payload: any = {
        name: formData.name,
        description: formData.description || undefined,
        mode: formData.mode,
        baseAsset: formData.baseAsset,
        universe: formData.universe.length > 0 ? formData.universe : [formData.baseAsset],
        timeframe: formData.timeframe,
        chainId: formData.chainId,
        maxPositionPct: formData.maxPositionPct,
        maxDailyLossPct: formData.maxDailyLossPct,
      };
      
      // Add optional risk limits if set
      if (formData.stopLossPct > 0) {
        payload.stopLossPct = formData.stopLossPct;
      }
      if (formData.takeProfitPct > 0) {
        payload.takeProfitPct = formData.takeProfitPct;
      }
      if (formData.trailingStopPct > 0) {
        payload.trailingStopPct = formData.trailingStopPct;
      }

      const response = await axios.post(
        `${API_URL}/strategies`,
        payload,
        { 
          validateStatus: (status) => status >= 200 && status < 500,
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (response.status >= 400) {
        const errMsg =
          (response.data && (response.data.message || response.data.error)) ||
          `Request failed with status ${response.status}`;
        setError(errMsg);
        return;
      }

      const strategyId = response.data?.id;
      setSuccess('Strategy created successfully!');
      localStorage.removeItem(STORAGE_KEY);

      if (strategyId) {
        setTimeout(() => router.push(`/strategies/${strategyId}`), 400);
      }
    } catch (err: any) {
      console.error('Error creating strategy:', err);
      let errorMessage = 'Failed to create strategy';
      
      if (err.code === 'ECONNREFUSED' || err.message?.includes('Network Error')) {
        errorMessage = 'Cannot connect to API server. Make sure it\'s running on http://localhost:4000';
      } else if (err.response?.data) {
        errorMessage = err.response.data.message || err.response.data.error || `Server error: ${err.response.status}`;
      } else if (err.message) {
        errorMessage = err.message;
      }
      
      setError(errorMessage);
      
      // Show toast if available
      if ((window as any).showToast) {
        (window as any).showToast(errorMessage, 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  const toggleToken = (token: string) => {
    setFormData((prev) => ({
      ...prev,
      universe: prev.universe.includes(token)
        ? prev.universe.filter((t) => t !== token)
        : [...prev.universe, token],
    }));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50 to-purple-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-900">
      <ToastContainer />
      <nav className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm shadow-sm border-b border-gray-200 dark:border-gray-700 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <Link href="/" className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                Matcha AI
              </Link>
            </div>
            <div className="flex items-center space-x-4">
              <DarkModeToggle />
              <Link
                href="/"
                className="px-4 py-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
              >
                ← Back to Dashboard
              </Link>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">Create New Strategy</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Set up an AI-powered trading strategy. Start with a template or customize your own.
          </p>
        </div>

        <StrategyTemplates onSelect={handleTemplateSelect} />

        <div className="flex items-center justify-between mb-4 text-sm text-gray-600 dark:text-gray-400">
          <span>{savedText}</span>
          {autoSaveState === 'saving' && <span className="text-blue-600">Saving…</span>}
          {autoSaveState === 'saved' && <span className="text-green-600">Draft saved</span>}
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-red-800 dark:text-red-200">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 rounded-md border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 px-4 py-3 text-green-800 dark:text-green-200">
            {success}
          </div>
        )}

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-8 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Quick Start Templates</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">Choose a pre-configured strategy to get started quickly</p>
            </div>
          </div>
          <StrategyTemplates onSelect={handleTemplateSelect} />
        </div>

        <div className="flex items-center justify-between mb-4 text-sm">
          <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
            {autoSaveState === 'saving' && (
              <>
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                <span>Saving draft...</span>
              </>
            )}
            {autoSaveState === 'saved' && lastSavedAt && (
              <>
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                <span className="text-green-600 dark:text-green-400">Draft saved at {new Date(lastSavedAt).toLocaleTimeString()}</span>
              </>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border-2 border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/30 px-6 py-4">
            <div className="flex items-center gap-2">
              <span className="text-red-600 dark:text-red-400 font-semibold">⚠️ Error:</span>
              <span className="text-red-800 dark:text-red-200">{error}</span>
            </div>
          </div>
        )}
        {success && (
          <div className="mb-6 rounded-lg border-2 border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/30 px-6 py-4">
            <div className="flex items-center gap-2">
              <span className="text-green-600 dark:text-green-400 font-semibold">✅ Success:</span>
              <span className="text-green-800 dark:text-green-200">{success}</span>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-8 space-y-8">
          <div className="border-b border-gray-200 dark:border-gray-700 pb-4">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Strategy Details</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Basic information about your trading strategy</p>
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2">
              Strategy Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., My Profitable Strategy"
              className="w-full px-4 py-3 border-2 border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Give your strategy a memorable name</p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Describe your strategy's approach and goals..."
              className="w-full px-4 py-3 border-2 border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              rows={3}
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Optional: Add notes about your strategy</p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2">
              Trading Mode <span className="text-red-500">*</span>
            </label>
            <select
              value={formData.mode}
              onChange={(e) =>
                setFormData({ ...formData, mode: e.target.value as 'SIMULATION' | 'PAPER' | 'LIVE' })
              }
              className="w-full px-4 py-3 border-2 border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
            >
              <option value="SIMULATION">🔄 Simulation - Backtest only (no trading)</option>
              <option value="PAPER">📊 Paper Trading - Simulated trading with real market data</option>
              <option value="LIVE">💰 Live Trading - Real trades with your wallet (requires connection)</option>
            </select>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {formData.mode === 'SIMULATION' && 'Perfect for testing strategies without any risk'}
              {formData.mode === 'PAPER' && 'Practice with real market conditions using virtual funds'}
              {formData.mode === 'LIVE' && '⚠️ Real money trading - connect wallet to enable'}
            </p>
          </div>

          <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Trading Configuration</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">Configure what and how your strategy will trade</p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2">
              Blockchain Network <span className="text-red-500">*</span>
            </label>
            <select
              value={formData.chainId}
              onChange={(e) => {
                const newChainId = parseInt(e.target.value, 10);
                const tokensForChain = getTokensForChain(newChainId);
                // Reset base asset and universe if current tokens aren't available on new chain
                const newBaseAsset = tokensForChain.includes(formData.baseAsset) 
                  ? formData.baseAsset 
                  : tokensForChain[0];
                const newUniverse = formData.universe.filter(t => tokensForChain.includes(t));
                setFormData({ 
                  ...formData, 
                  chainId: newChainId,
                  baseAsset: newBaseAsset,
                  universe: newUniverse,
                });
              }}
              className="w-full px-4 py-3 border-2 border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
            >
              {SUPPORTED_CHAINS.map((chain) => (
                <option key={chain.id} value={chain.id}>
                  {chain.icon} {chain.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Select the blockchain network for your strategy. All EVM networks use 0x API for reliable, real-time price data with free API credits.
            </p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2">
              Base Asset <span className="text-red-500">*</span>
            </label>
            <select
              value={formData.baseAsset}
              onChange={(e) => setFormData({ ...formData, baseAsset: e.target.value })}
              className="w-full px-4 py-3 border-2 border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
            >
              {getTokensForChain(formData.chainId).map((token) => (
                <option key={token} value={token}>
                  {token}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              The base currency for your trades (usually USDC or USDT). All prices powered by 0x API for reliable data.
            </p>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2">
              Trading Universe <span className="text-red-500">*</span>
            </label>
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-3">
              Select which tokens your strategy can trade. All tokens use 0x API for real-time price data.
            </p>
            <div className="flex flex-wrap gap-3">
              {getTokensForChain(formData.chainId).map((token) => (
                <button
                  key={token}
                  type="button"
                  onClick={() => toggleToken(token)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    formData.universe.includes(token)
                      ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg scale-105'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                  }`}
                >
                  {token}
                  {formData.universe.includes(token) && ' ✓'}
                </button>
              ))}
            </div>
            {formData.universe.length === 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                ⚠️ Select at least one token. If none selected, base asset will be used.
              </p>
            )}
            <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-700">
              <p className="text-xs text-blue-800 dark:text-blue-200">
                💡 <strong>Powered by 0x API:</strong> All price data comes from 0x API, providing reliable, real-time quotes for EVM chains. Free tier available forever.
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2">
              Timeframe <span className="text-red-500">*</span>
            </label>
            <select
              value={formData.timeframe}
              onChange={(e) => setFormData({ ...formData, timeframe: e.target.value })}
              className="w-full px-4 py-3 border-2 border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
            >
              {TIMEFRAMES.map((tf) => (
                <option key={tf} value={tf}>
                  {tf} {tf === '1m' ? '(Very Active)' : tf === '1h' ? '(Recommended)' : tf === '1d' ? '(Conservative)' : ''}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              How often the strategy analyzes the market and makes decisions
            </p>
          </div>

          <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Risk Management</h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
              Set limits to protect your capital. These are critical for safe trading.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
              <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2">
                Max Position Size (%) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min="1"
                max="100"
                value={formData.maxPositionPct}
                onChange={(e) =>
                  setFormData({ ...formData, maxPositionPct: parseInt(e.target.value, 10) })
                }
                className="w-full px-4 py-3 border-2 border-blue-300 dark:border-blue-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
              />
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
                Maximum % of capital per trade. Recommended: 5-25%
              </p>
            </div>

            <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-lg border border-red-200 dark:border-red-800">
              <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2">
                Max Daily Loss (%) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min="1"
                max="100"
                value={formData.maxDailyLossPct}
                onChange={(e) =>
                  setFormData({ ...formData, maxDailyLossPct: parseInt(e.target.value, 10) })
                }
                className="w-full px-4 py-3 border-2 border-red-300 dark:border-red-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-all"
              />
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
                Stop trading if daily loss exceeds this %. Recommended: 2-10%
              </p>
            </div>
          </div>

          <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              Advanced Risk Management (Optional)
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
              Set automatic stop loss and take profit levels. Leave at 0 to disable.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-amber-50 dark:bg-amber-900/20 p-4 rounded-lg border border-amber-200 dark:border-amber-800">
                <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2">
                  Stop Loss (%) 
                  <span className="text-xs font-normal text-gray-500 ml-1">(0 = disabled)</span>
                </label>
                <input
                  type="number"
                  min="0"
                  max="50"
                  step="0.1"
                  value={formData.stopLossPct}
                  onChange={(e) =>
                    setFormData({ ...formData, stopLossPct: parseFloat(e.target.value) || 0 })
                  }
                  className="w-full px-4 py-3 border-2 border-amber-300 dark:border-amber-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-all"
                  placeholder="e.g., 5"
                />
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
                  🛡️ Auto-close if loss exceeds this %
                </p>
              </div>

              <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg border border-green-200 dark:border-green-800">
                <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2">
                  Take Profit (%) 
                  <span className="text-xs font-normal text-gray-500 ml-1">(0 = disabled)</span>
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={formData.takeProfitPct}
                  onChange={(e) =>
                    setFormData({ ...formData, takeProfitPct: parseFloat(e.target.value) || 0 })
                  }
                  className="w-full px-4 py-3 border-2 border-green-300 dark:border-green-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all"
                  placeholder="e.g., 10"
                />
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
                  💰 Auto-close if profit reaches this %
                </p>
              </div>

              <div className="bg-purple-50 dark:bg-purple-900/20 p-4 rounded-lg border border-purple-200 dark:border-purple-800">
                <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2">
                  Trailing Stop (%) 
                  <span className="text-xs font-normal text-gray-500 ml-1">(0 = disabled)</span>
                </label>
                <input
                  type="number"
                  min="0"
                  max="20"
                  step="0.1"
                  value={formData.trailingStopPct}
                  onChange={(e) =>
                    setFormData({ ...formData, trailingStopPct: parseFloat(e.target.value) || 0 })
                  }
                  className="w-full px-4 py-3 border-2 border-purple-300 dark:border-purple-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all"
                  placeholder="e.g., 3"
                />
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
                  📈 Follows price upward to lock in profits
                </p>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-200 dark:border-gray-700 pt-6 flex justify-between items-center">
            <button
              type="button"
              onClick={() => router.back()}
              className="px-6 py-3 border-2 border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-all font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !formData.name.trim()}
              className="px-8 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-xl font-semibold text-lg"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  Creating...
                </span>
              ) : (
                '✨ Create Strategy'
              )}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
