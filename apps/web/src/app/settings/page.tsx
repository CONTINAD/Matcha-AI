'use client';

import { useState } from 'react';
import Link from 'next/link';
import { DarkModeToggle } from '../../components/DarkModeToggle';

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    // In a real app, this would save to backend
    // For now, just show success message
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
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
              <span className="text-lg font-semibold text-gray-700 dark:text-gray-300">Settings</span>
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

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-2">Settings</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Configure your Matcha AI preferences and API keys
          </p>
        </div>

        <div className="space-y-6">
          {/* API Keys Section */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">API Keys</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2">
                  0x API Key
                </label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Enter your 0x API key (optional - free tier available)"
                    className="flex-1 px-4 py-3 border-2 border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    onClick={handleSave}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold"
                  >
                    {saved ? '✓ Saved' : 'Save'}
                  </button>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  Get free API credits from 0x API. Used for reliable price data on EVM chains (Ethereum, Polygon, Arbitrum).
                </p>
              </div>
            </div>
          </div>

          {/* Display Preferences */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Display Preferences</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-gray-900 dark:text-white">Dark Mode</div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">Toggle dark/light theme</div>
                </div>
                <DarkModeToggle />
              </div>
            </div>
          </div>

          {/* Chain Preferences */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Chain Preferences</h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-700">
                <div>
                  <div className="font-semibold text-gray-900 dark:text-white">EVM Chains (Recommended)</div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    Ethereum, Polygon, Arbitrum - Uses 0x API for reliable price data
                  </div>
                </div>
                <div className="px-3 py-1 bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 rounded-full text-sm font-semibold">
                  Active
                </div>
              </div>
              <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600">
                <div>
                  <div className="font-semibold text-gray-900 dark:text-white">Solana</div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    Currently hidden from new strategy creation. Existing strategies still work.
                  </div>
                </div>
                <div className="px-3 py-1 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-full text-sm font-semibold">
                  Hidden
                </div>
              </div>
            </div>
          </div>

          {/* Data Refresh Settings */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Data Refresh</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-900 dark:text-white mb-2">
                  Auto-refresh Interval
                </label>
                <select className="w-full px-4 py-3 border-2 border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="30">30 seconds</option>
                  <option value="60" selected>1 minute</option>
                  <option value="300">5 minutes</option>
                  <option value="600">10 minutes</option>
                </select>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                  How often to refresh trading data and metrics
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

