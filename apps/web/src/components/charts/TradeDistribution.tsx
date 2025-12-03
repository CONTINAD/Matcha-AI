import { useMemo } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ScatterChart, Scatter } from 'recharts';

export interface TradePoint {
  timestamp: number;
  pnl: number;
  pnlPct?: number;
}

interface Props {
  trades: TradePoint[];
  height?: number;
}

export function TradeDistribution({ trades, height = 240 }: Props) {
  const histogram = useMemo(() => {
    if (!trades || trades.length === 0) return [];
    const binSize = 50; // dollars
    const buckets: Record<string, number> = {};
    trades.forEach((t) => {
      const bin = Math.floor(t.pnl / binSize) * binSize;
      const key = `${bin}`;
      buckets[key] = (buckets[key] || 0) + 1;
    });
    return Object.entries(buckets)
      .map(([bin, count]) => ({ bin: Number(bin), count }))
      .sort((a, b) => a.bin - b.bin);
  }, [trades]);

  const scatterData = useMemo(() => {
    if (!trades) return [];
    return trades.map((t, idx) => ({
      x: t.timestamp,
      y: t.pnl,
      idx,
    }));
  }, [trades]);

  if (!trades || trades.length === 0) {
    return <div className="text-sm text-gray-500">No trades yet.</div>;
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={histogram}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis dataKey="bin" stroke="#9ca3af" tickFormatter={(v) => `$${v}`} />
          <YAxis stroke="#9ca3af" />
          <Tooltip
            contentStyle={{ background: '#111827', border: '1px solid #1f2937', color: '#f9fafb' }}
            formatter={(value: any) => value}
            labelFormatter={(v) => `$${v} to $${Number(v) + 50}`}
          />
          <Bar dataKey="count" fill="#a78bfa" name="Trades" />
        </BarChart>
      </ResponsiveContainer>

      <ResponsiveContainer width="100%" height={height}>
        <ScatterChart>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
          <XAxis
            dataKey="x"
            stroke="#9ca3af"
            tickFormatter={(ts) => new Date(ts).toLocaleDateString()}
            name="Time"
          />
          <YAxis
            dataKey="y"
            stroke="#9ca3af"
            tickFormatter={(v) => `$${v}`}
            name="PnL"
          />
          <Tooltip
            cursor={{ strokeDasharray: '3 3' }}
            contentStyle={{ background: '#111827', border: '1px solid #1f2937', color: '#f9fafb' }}
            labelFormatter={(ts) => new Date(Number(ts)).toLocaleString()}
            formatter={(v: any) => [`$${Number(v).toFixed(2)}`, 'PnL']}
          />
          <Scatter data={scatterData} fill="#22c55e" name="Trades" />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
