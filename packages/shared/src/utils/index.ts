export function calculatePnL(
  entryPrice: number,
  exitPrice: number,
  size: number,
  side: 'BUY' | 'SELL'
): { pnl: number; pnlPct: number } {
  if (side === 'BUY') {
    const pnl = (exitPrice - entryPrice) * size;
    const pnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;
    return { pnl, pnlPct };
  } else {
    // SELL (short)
    const pnl = (entryPrice - exitPrice) * size;
    const pnlPct = ((entryPrice - exitPrice) / entryPrice) * 100;
    return { pnl, pnlPct };
  }
}

export function calculateSharpe(returns: number[], riskFreeRate = 0): number {
  if (returns.length === 0) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return 0;
  return (mean - riskFreeRate) / stdDev;
}

export function calculateMaxDrawdown(equityCurve: number[]): number {
  if (equityCurve.length === 0) return 0;
  let maxDrawdown = 0;
  let peak = equityCurve[0];

  for (let i = 1; i < equityCurve.length; i++) {
    if (equityCurve[i] > peak) {
      peak = equityCurve[i];
    }
    const drawdown = ((peak - equityCurve[i]) / peak) * 100;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  return maxDrawdown;
}

export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

export function parseTimeframe(timeframe: string): { unit: string; value: number } {
  const match = timeframe.match(/^(\d+)([mhd])$/);
  if (!match) throw new Error(`Invalid timeframe: ${timeframe}`);
  const value = parseInt(match[1], 10);
  const unit = match[2];
  return { value, unit };
}

export function timeframeToMs(timeframe: string): number {
  const { value, unit } = parseTimeframe(timeframe);
  const multipliers: Record<string, number> = {
    m: 60 * 1000, // minutes
    h: 60 * 60 * 1000, // hours
    d: 24 * 60 * 60 * 1000, // days
  };
  return value * multipliers[unit];
}

