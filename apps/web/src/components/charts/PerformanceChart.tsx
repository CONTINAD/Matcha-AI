import { ResponsiveContainer, AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip, ReferenceLine } from 'recharts';

export interface PerformancePoint {
  timestamp: number;
  cumulativePnl: number;
  tradePnl?: number;
}

interface Props {
  data: PerformancePoint[];
  height?: number;
}

export function PerformanceChart({ data, height = 220 }: Props) {
  if (!data || data.length === 0) {
    return <div className="text-sm text-gray-500">No P&L data yet.</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
        <XAxis
          dataKey="timestamp"
          tickFormatter={(ts) => new Date(ts).toLocaleDateString()}
          stroke="#9ca3af"
        />
        <YAxis stroke="#9ca3af" tickFormatter={(v) => `$${v.toFixed(0)}`} />
        <Tooltip
          contentStyle={{ background: '#111827', border: '1px solid #1f2937', color: '#f9fafb' }}
          labelFormatter={(ts) => new Date(Number(ts)).toLocaleString()}
          formatter={(value: any, name: string) => [`$${Number(value).toFixed(2)}`, name]}
        />
        <ReferenceLine y={0} stroke="#6b7280" strokeDasharray="3 3" />
        <Area
          type="monotone"
          dataKey="cumulativePnl"
          name="Cumulative PnL"
          stroke="#38bdf8"
          fill="#38bdf866"
          strokeWidth={2}
        />
        <Area
          type="stepAfter"
          dataKey="tradePnl"
          name="Trade PnL"
          stroke="#fb7185"
          fill="#fb718533"
          strokeWidth={1}
          opacity={0.7}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
