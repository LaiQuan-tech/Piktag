"use client";

import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

type ToastVariant = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
  visible: boolean;
}

interface ToastContextValue {
  showToast: (message: string, variant?: ToastVariant) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const variantStyles: Record<
  ToastVariant,
  { container: string; iconClass: string; Icon: typeof CheckCircle2 }
> = {
  success: {
    container: "bg-green-50 border-green-500 text-green-900",
    iconClass: "text-green-500",
    Icon: CheckCircle2,
  },
  error: {
    container: "bg-red-50 border-red-500 text-red-900",
    iconClass: "text-red-500",
    Icon: AlertCircle,
  },
  info: {
    container: "bg-blue-50 border-blue-500 text-blue-900",
    iconClass: "text-blue-500",
    Icon: Info,
  },
};

const AUTO_DISMISS_MS = 4000;
const FADE_OUT_MS = 200;

export function ToastProvider({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, visible: false } : t)),
    );
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, FADE_OUT_MS);
  }, []);

  const showToast = useCallback(
    (message: string, variant: ToastVariant = "info") => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [
        ...prev,
        { id, message, variant, visible: false },
      ]);
      window.setTimeout(() => {
        setToasts((prev) =>
          prev.map((t) => (t.id === id ? { ...t, visible: true } : t)),
        );
      }, 10);
      window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"
      >
        {toasts.map((toast) => {
          const { container, iconClass, Icon } = variantStyles[toast.variant];
          return (
            <div
              key={toast.id}
              role="status"
              className={`pointer-events-auto flex min-w-72 items-start gap-3 rounded-lg border-l-4 p-4 shadow-lg transition-all duration-200 ease-out ${container} ${
                toast.visible
                  ? "translate-y-0 opacity-100"
                  : "translate-y-2 opacity-0"
              }`}
            >
              <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${iconClass}`} />
              <p className="text-sm font-medium leading-5">{toast.message}</p>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}
