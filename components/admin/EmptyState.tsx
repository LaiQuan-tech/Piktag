import Link from "next/link";
import type { ComponentType } from "react";

interface EmptyStateProps {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: { label: string; href: string };
}

export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: EmptyStateProps): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {Icon ? (
        <Icon className="mb-4 h-14 w-14 text-slate-400" aria-hidden="true" />
      ) : null}
      <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
      {description ? (
        <p className="mt-2 max-w-md text-sm text-slate-500">{description}</p>
      ) : null}
      {action ? (
        <Link
          href={action.href}
          className="mt-6 inline-flex items-center rounded-md bg-[#aa00ff] px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#9200db] focus:outline-none focus:ring-2 focus:ring-[#aa00ff] focus:ring-offset-2"
        >
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
