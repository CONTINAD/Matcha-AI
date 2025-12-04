'use client';

import { useState } from 'react';
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface SolanaWalletActivateProps {
  strategyId: string;
  onActivated?: () => void;
  onCancel?: () => void;
}

export function SolanaWalletActivate({ strategyId, onActivated, onCancel }: SolanaWalletActivateProps) {
  const [privateKey, setPrivateKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      // Encrypt private key on backend (more secure than client-side)
      const encryptResponse = await axios.post(`${API_URL}/wallets/encrypt-key`, {
        privateKey: privateKey.trim(),
        chainType: 'SOLANA',
      });

      // Activate live trading with encrypted key
      const activateResponse = await axios.post(`${API_URL}/strategies/${strategyId}/live/activate`, {
        encryptedKey: encryptResponse.data.encrypted,
        iv: encryptResponse.data.iv,
        tag: encryptResponse.data.tag,
      });

      if (activateResponse.data.success) {
        setSuccess('Solana wallet activated! Live trading will start automatically.');
        setPrivateKey('');
        if (onActivated) {
          setTimeout(() => onActivated(), 2000);
        }
      } else {
        setError(activateResponse.data.message || 'Activation failed');
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.response?.data?.error || 'Failed to activate wallet');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 border-2 border-purple-500">
      <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">🔗 Activate Solana Wallet</h2>
      
      <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
        <p className="text-sm text-blue-800 dark:text-blue-200 font-medium mb-2">
          ⚠️ Security Notice
        </p>
        <p className="text-xs text-blue-600 dark:text-blue-400">
          Your private key will be encrypted before storage and will expire after 1 hour. 
          The system will run a profitability check before activating live trading.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-red-800">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-green-800">
          {success}
        </div>
      )}

      <form onSubmit={handleActivate} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Solana Private Key
            <span className="text-xs text-gray-500 ml-2">(Base58 or JSON array format)</span>
          </label>
          <input
            type="password"
            value={privateKey}
            onChange={(e) => setPrivateKey(e.target.value)}
            placeholder="Enter your Solana private key..."
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white font-mono text-sm"
            required
          />
        </div>

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={loading || !privateKey.trim()}
            className="flex-1 px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 text-white rounded-md hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
          >
            {loading ? 'Activating...' : '🚀 Activate Live Trading'}
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-400 dark:hover:bg-gray-500"
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}


