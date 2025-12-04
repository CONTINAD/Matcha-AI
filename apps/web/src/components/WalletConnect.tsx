'use client';

import { useState } from 'react';
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface WalletConnectProps {
  onConnected?: (wallet: { id: string; address: string; chainType: string }) => void;
}

export function WalletConnect({ onConnected }: WalletConnectProps) {
  const [chainType, setChainType] = useState<'EVM' | 'SOLANA'>('EVM');
  const [address, setAddress] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [maxAmount, setMaxAmount] = useState(1000);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      // First, connect wallet (stores address only, no private key)
      const response = await axios.post(`${API_URL}/wallets/connect`, {
        chainType,
        address: address.trim(),
        chainId: chainType === 'EVM' ? 1 : chainType === 'SOLANA' ? 101 : undefined,
        maxTradingAmount: maxAmount,
      });

      setSuccess(`Wallet connected! Address: ${response.data.address}`);
      if (onConnected) {
        onConnected({
          id: response.data.id,
          address: response.data.address,
          chainType: response.data.chainType,
        });
      }
      
      // Clear form
      setAddress('');
      setPrivateKey('');
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Failed to connect wallet');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <h2 className="text-xl font-semibold mb-4 text-gray-900 dark:text-white">Connect Wallet</h2>
      
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

      <form onSubmit={handleConnect} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Chain Type
          </label>
          <select
            value={chainType}
            onChange={(e) => setChainType(e.target.value as 'EVM' | 'SOLANA')}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
          >
            <option value="EVM">EVM (Ethereum, Polygon, Arbitrum)</option>
            <option value="SOLANA">Solana</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Wallet Address
          </label>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={chainType === 'EVM' ? '0x...' : 'Base58 address...'}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Private Key
            <span className="text-xs text-gray-500 ml-2">
              (For testing only - will be encrypted in production)
            </span>
          </label>
          <input
            type="password"
            value={privateKey}
            onChange={(e) => setPrivateKey(e.target.value)}
            placeholder={chainType === 'EVM' ? '0x...' : 'Base58 or JSON array...'}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Max Trading Amount ($)
            <span className="text-xs text-gray-500 ml-2">
              Safety limit - system won't trade more than this
            </span>
          </label>
          <input
            type="number"
            value={maxAmount}
            onChange={(e) => setMaxAmount(Number(e.target.value))}
            min="1"
            max="100000"
            step="1"
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            required
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Connecting...' : 'Connect Wallet'}
        </button>
      </form>

      <div className="mt-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-md">
        <p className="text-xs text-yellow-800 dark:text-yellow-200">
          ⚠️ <strong>Security Notice:</strong> Private keys are stored for testing purposes only.
          In production, use wallet adapters (MetaMask, Phantom) that never expose private keys.
        </p>
      </div>
    </div>
  );
}


