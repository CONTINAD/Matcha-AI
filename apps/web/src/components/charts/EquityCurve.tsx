import { ResponsiveContainer, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, AreaChart, Area } from 'recharts';

export interface EquityPoint {
  timestamp: number;
  equity: number;
  drawdown?: number;
}

interface Props {
  data: EquityPoint[];
  height?: number;
}

export function EquityCurve({ data, height = 260 }: Props) {
  if (!data || data.length === 0) {
    return <div className="text-sm text-gray-500">No equity data yet.</div>;
  }

  const formatter = (value: any) => {
    if (typeof value === 'number') {
      return `$${value.toFixed(2)}`;
    }
    return value;
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis
          dataKey="timestamp"
          tickFormatter={(ts) => new Date(ts).toLocaleDateString()}
          stroke="#6b7280"
        />
        <YAxis stroke="#6b7280" tickFormatter={formatter} />
        <Tooltip
          contentStyle={{ background: '#111827', border: '1px solid #1f2937', color: '#f9fafb' }}
          labelFormatter={(ts) => new Date(Number(ts)).toLocaleString()}
          formatter={(value: any, name: string) => [formatter(value), name]}
        />
        <Area
          type="monotone"
          dataKey="equity"
          stroke="#22c55e"
          fill="#22c55e33"
          strokeWidth={2}
          name="Equity"
        />
        <Line
          type="monotone"
          dataKey="drawdown"
          stroke="#f59e0b"
          dot={false}
          strokeDasharray="4 4"
          name="Drawdown"
        />
        <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="3 3" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
