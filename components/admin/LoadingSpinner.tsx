interface LoadingSpinnerProps {
  size?: "sm" | "md" | "lg";
}

const sizeMap: Record<NonNullable<LoadingSpinnerProps["size"]>, string> = {
  sm: "h-4 w-4",
  md: "h-6 w-6",
  lg: "h-10 w-10",
};

export default function LoadingSpinner({
  size = "md",
}: LoadingSpinnerProps): JSX.Element {
  return (
    <span
      role="status"
      aria-label="載入中"
      className={`inline-block animate-spin rounded-full border-2 border-t-transparent border-[#aa00ff] ${sizeMap[size]}`}
    />
  );
}

export function InlineLoader(): JSX.Element {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-slate-600">
      <LoadingSpinner size="sm" />
      <span>載入中…</span>
    </span>
  );
}
