'use client';

import { StrategyConfig } from '@matcha-ai/shared';

export interface StrategyTemplate {
  id: string;
  name: string;
  description: string;
  config: Partial<StrategyConfig>;
  icon: string;
}

export const STRATEGY_TEMPLATES: StrategyTemplate[] = [
  {
    id: 'conservative',
    name: 'Conservative',
    description: 'Low risk, steady returns',
    icon: '🛡️',
    config: {
      baseAsset: 'USDC',
      universe: ['WETH'],
      timeframe: '1h',
      riskLimits: {
        maxPositionPct: 10,
        maxDailyLossPct: 2,
        stopLossPct: 3,
        takeProfitPct: 5,
      },
    },
  },
  {
    id: 'moderate',
    name: 'Moderate',
    description: 'Balanced risk and reward',
    icon: '⚖️',
    config: {
      baseAsset: 'USDC',
      universe: ['WETH'],
      timeframe: '1h',
      riskLimits: {
        maxPositionPct: 20,
        maxDailyLossPct: 5,
        stopLossPct: 5,
        takeProfitPct: 10,
      },
    },
  },
  {
    id: 'aggressive',
    name: 'Aggressive',
    description: 'High risk, high reward',
    icon: '🚀',
    config: {
      baseAsset: 'USDC',
      universe: ['WETH'],
      timeframe: '15m',
      riskLimits: {
        maxPositionPct: 30,
        maxDailyLossPct: 10,
        stopLossPct: 8,
        takeProfitPct: 15,
        trailingStopPct: 3,
      },
    },
  },
  {
    id: 'scalping',
    name: 'Scalping',
    description: 'Quick trades, small profits',
    icon: '⚡',
    config: {
      baseAsset: 'USDC',
      universe: ['WETH'],
      timeframe: '5m',
      riskLimits: {
        maxPositionPct: 15,
        maxDailyLossPct: 3,
        stopLossPct: 1,
        takeProfitPct: 2,
      },
    },
  },
  {
    id: 'swing',
    name: 'Swing Trading',
    description: 'Hold positions for days',
    icon: '📈',
    config: {
      baseAsset: 'USDC',
      universe: ['WETH'],
      timeframe: '4h',
      riskLimits: {
        maxPositionPct: 25,
        maxDailyLossPct: 7,
        stopLossPct: 10,
        takeProfitPct: 20,
        trailingStopPct: 5,
      },
    },
  },
];

interface StrategyTemplatesProps {
  onSelect: (template: StrategyTemplate) => void;
}

export function StrategyTemplates({ onSelect }: StrategyTemplatesProps) {
  return (
    <div className="mb-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
        Quick Start Templates
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {STRATEGY_TEMPLATES.map((template) => (
          <button
            key={template.id}
            onClick={() => onSelect(template)}
            className="p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-blue-500 dark:hover:border-blue-400 transition-all text-left"
          >
            <div className="text-2xl mb-2">{template.icon}</div>
            <div className="font-semibold text-sm text-gray-900 dark:text-white">
              {template.name}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {template.description}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}




