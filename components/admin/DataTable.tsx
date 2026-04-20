'use client';

import type { ReactNode } from 'react';

interface DataTableColumn<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Array<DataTableColumn<T>>;
  data: T[];
  emptyMessage?: string;
  loading?: boolean;
  onRowClick?: (row: T) => void;
}

export default function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  emptyMessage = '沒有資料',
  loading = false,
  onRowClick,
}: DataTableProps<T>) {
  const clickable = typeof onRowClick === 'function';

  return (
    <div className="bg-white rounded-xl overflow-hidden border border-slate-200">
      <table className="w-full">
        <thead className="bg-slate-50">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className="px-4 py-3 text-left text-xs uppercase tracking-wider text-slate-500 font-medium"
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: 5 }).map((_, rowIdx) => (
              <tr
                key={`skeleton-${rowIdx}`}
                className={rowIdx % 2 === 1 ? 'bg-slate-50/40' : ''}
              >
                {columns.map((col) => (
                  <td key={col.key} className="px-4 py-4">
                    <div className="h-4 rounded bg-slate-200 animate-pulse" />
                  </td>
                ))}
              </tr>
            ))
          ) : data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-12 text-center text-sm text-slate-500 opacity-70"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row, rowIdx) => (
              <tr
                key={rowIdx}
                onClick={clickable ? () => onRowClick?.(row) : undefined}
                className={[
                  rowIdx % 2 === 1 ? 'bg-slate-50/40' : 'bg-white',
                  'transition-colors hover:bg-[#faf5ff]',
                  clickable ? 'cursor-pointer' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {columns.map((col) => {
                  const cellContent = col.render
                    ? col.render(row)
                    : (row[col.key] as ReactNode);
                  return (
                    <td
                      key={col.key}
                      className={`px-4 py-3 text-sm text-slate-700 ${col.className ?? ''}`}
                    >
                      {cellContent}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
