import type { ComponentType } from 'react';

interface StatCardProps {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  trend?: { text: string; positive: boolean };
  alert?: boolean;
}

export default function StatCard({
  icon: Icon,
  label,
  value,
  trend,
  alert = false,
}: StatCardProps) {
  const iconWrapClass = alert
    ? 'bg-red-50 text-red-600'
    : 'bg-[#faf5ff] text-[#aa00ff]';
  const valueClass = alert ? 'text-red-600' : 'text-[#360066]';
  const trendClass = trend?.positive ? 'text-emerald-600' : 'text-red-600';

  return (
    <div className="bg-white rounded-xl p-6 shadow-sm">
      <div
        className={`w-10 h-10 rounded-md flex items-center justify-center ${iconWrapClass}`}
      >
        <Icon className="w-5 h-5" />
      </div>
      <div className={`mt-4 text-4xl font-bold ${valueClass}`}>{value}</div>
      <div className="mt-1 text-sm text-slate-500">{label}</div>
      {trend && (
        <div className={`mt-2 text-xs ${trendClass}`}>
          <span aria-hidden="true">{trend.positive ? '↑' : '↓'}</span>{' '}
          {trend.text}
        </div>
      )}
    </div>
  );
}
