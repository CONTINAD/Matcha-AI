'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface SystemStatus {
  api: 'online' | 'offline';
  strategies: number;
  activeStrategies: number;
  totalTrades: number;
  lastUpdate: Date;
}

export function SystemStatus() {
  const [status, setStatus] = useState<SystemStatus>({
    api: 'offline',
    strategies: 0,
    activeStrategies: 0,
    totalTrades: 0,
    lastUpdate: new Date(),
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const [healthRes, strategiesRes] = await Promise.all([
          axios.get(`${API_URL}/health`).catch(() => null),
          axios.get(`${API_URL}/strategies?quality=good`).catch(() => null),
        ]);

        const strategies = strategiesRes?.data || [];
        const activeStrategies = strategies.filter((s: any) => s.status === 'ACTIVE');

        // Get total trades
        let totalTrades = 0;
        for (const strategy of activeStrategies.slice(0, 5)) {
          try {
            const tradesRes = await axios.get(`${API_URL}/strategies/${strategy.id}/trades?limit=1`);
            if (Array.isArray(tradesRes.data)) {
              totalTrades += tradesRes.data.length;
            }
          } catch {
            // Skip
          }
        }

        setStatus({
          api: healthRes ? 'online' : 'offline',
          strategies: strategies.length,
          activeStrategies: activeStrategies.length,
          totalTrades,
          lastUpdate: new Date(),
        });
      } catch (error) {
        setStatus((prev) => ({ ...prev, api: 'offline' }));
      } finally {
        setLoading(false);
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 30000); // Check every 30 seconds

    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return null;
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${
            status.api === 'online' ? 'bg-green-500 animate-pulse' : 'bg-red-500'
          }`}></div>
          <div>
            <div className="text-sm font-semibold text-gray-900 dark:text-white">
              System Status
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {status.api === 'online' ? 'All systems operational' : 'API connection issue'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
            <div className="text-right">
              <div className="font-semibold text-gray-900 dark:text-white">{status.activeStrategies}</div>
              <div>Active</div>
            </div>
            <div className="text-right">
              <div className="font-semibold text-gray-900 dark:text-white">{status.strategies}</div>
              <div>Total</div>
            </div>
            <div className="text-right">
              <div className="font-semibold text-gray-900 dark:text-white">{status.totalTrades}</div>
              <div>Trades</div>
            </div>
          </div>
          <Link
            href="/testing"
            className="px-3 py-1.5 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors text-xs font-semibold"
            title="Extended Testing Dashboard"
          >
            Testing →
          </Link>
        </div>
      </div>
    </div>
  );
}


