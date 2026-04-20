'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

export default function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: PaginationProps) {
  const prevDisabled = page <= 1;
  const nextDisabled = page * pageSize >= total;

  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  const buttonClass =
    'inline-flex items-center gap-1 px-3 py-2 rounded-md border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors';

  return (
    <div className="flex items-center justify-between">
      <p className="text-sm text-slate-600">
        第 {start}-{end} 筆，共 {total} 筆
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={prevDisabled}
          aria-label="上一頁"
          className={buttonClass}
        >
          <ChevronLeft className="w-4 h-4" />
          <span>上一頁</span>
        </button>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={nextDisabled}
          aria-label="下一頁"
          className={buttonClass}
        >
          <span>下一頁</span>
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
