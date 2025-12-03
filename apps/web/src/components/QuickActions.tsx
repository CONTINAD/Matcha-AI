'use client';

import { useState } from 'react';
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface QuickActionsProps {
  selectedStrategies: string[];
  onActionComplete: () => void;
}

export function QuickActions({ selectedStrategies, onActionComplete }: QuickActionsProps) {
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<string | null>(null);

  const handleBulkAction = async (actionType: 'start' | 'stop' | 'delete') => {
    if (selectedStrategies.length === 0) return;

    setLoading(true);
    setAction(actionType);

    try {
      const promises = selectedStrategies.map(async (strategyId) => {
        try {
          if (actionType === 'start') {
            await axios.post(`${API_URL}/strategies/${strategyId}/paper/start`);
          } else if (actionType === 'stop') {
            await axios.post(`${API_URL}/strategies/${strategyId}/paper/stop`);
          } else if (actionType === 'delete') {
            await axios.delete(`${API_URL}/strategies/${strategyId}`);
          }
        } catch (error) {
          console.error(`Error ${actionType}ing strategy ${strategyId}:`, error);
        }
      });

      await Promise.all(promises);
      
      if ((window as any).showToast) {
        (window as any).showToast(
          `${actionType === 'delete' ? 'Deleted' : actionType === 'start' ? 'Started' : 'Stopped'} ${selectedStrategies.length} strateg${selectedStrategies.length !== 1 ? 'ies' : 'y'}`,
          'success'
        );
      }

      onActionComplete();
    } catch (error) {
      if ((window as any).showToast) {
        (window as any).showToast('Error performing bulk action', 'error');
      }
    } finally {
      setLoading(false);
      setAction(null);
    }
  };

  if (selectedStrategies.length === 0) return null;

  return (
    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-4 mb-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-blue-900 dark:text-blue-100">
            {selectedStrategies.length} strateg{selectedStrategies.length !== 1 ? 'ies' : 'y'} selected
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleBulkAction('start')}
            disabled={loading}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 text-sm font-medium"
          >
            {loading && action === 'start' ? 'Starting...' : '▶️ Start All'}
          </button>
          <button
            onClick={() => handleBulkAction('stop')}
            disabled={loading}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 text-sm font-medium"
          >
            {loading && action === 'stop' ? 'Stopping...' : '⏹️ Stop All'}
          </button>
          <button
            onClick={() => {
              if (confirm(`Delete ${selectedStrategies.length} strateg${selectedStrategies.length !== 1 ? 'ies' : 'y'}? This cannot be undone.`)) {
                handleBulkAction('delete');
              }
            }}
            disabled={loading}
            className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50 text-sm font-medium"
          >
            {loading && action === 'delete' ? 'Deleting...' : '🗑️ Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}


