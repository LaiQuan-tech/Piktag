'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  type TooltipProps,
  XAxis,
  YAxis,
} from 'recharts';

interface SignupsChartProps {
  data: Array<{ date: string; count: number }>;
}

function formatShort(value: string): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}`;
}

function formatLong(value: string): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

function ChartTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;
  const raw = payload[0]?.value;
  const count = typeof raw === 'number' ? raw : Number(raw ?? 0);
  return (
    <div
      className="rounded-lg border border-[#8c52ff] bg-white px-3 py-2 shadow-sm"
      style={{ borderColor: '#8c52ff' }}
    >
      <p className="text-xs text-slate-700">
        {formatLong(String(label ?? ''))} · 新用戶 {count.toLocaleString('zh-TW')} 人
      </p>
    </div>
  );
}

export default function SignupsChart({ data }: SignupsChartProps) {
  return (
    <div style={{ width: '100%', height: 300 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 8, right: 24, bottom: 32, left: 0 }}
        >
          <CartesianGrid
            stroke="#e2e8f0"
            strokeDasharray="4 4"
            vertical={false}
          />
          <XAxis
            dataKey="date"
            tickFormatter={formatShort}
            tick={{ fontSize: 12, fill: '#64748b' }}
            axisLine={{ stroke: '#e2e8f0' }}
            tickLine={false}
            minTickGap={16}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 12, fill: '#64748b' }}
            axisLine={{ stroke: '#e2e8f0' }}
            tickLine={false}
            width={40}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#8c52ff', strokeOpacity: 0.2 }} />
          <Line
            type="monotone"
            dataKey="count"
            stroke="#8c52ff"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5, fill: '#8c52ff', stroke: '#ffffff', strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
