'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  typeToConfirm?: string;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}

export default function ConfirmModal({
  open,
  title,
  description,
  confirmText = '確認',
  cancelText = '取消',
  danger = false,
  typeToConfirm,
  onConfirm,
  onClose,
}: ConfirmModalProps) {
  const [typedValue, setTypedValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset local state when opening.
  useEffect(() => {
    if (open) {
      setTypedValue('');
      setSubmitting(false);
    }
  }, [open]);

  // ESC key closes (when not submitting).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, submitting, onClose]);

  // Initial focus: input if typeToConfirm, otherwise confirm button.
  useEffect(() => {
    if (!open) return;
    // Defer to next frame so the element is mounted.
    const id = window.requestAnimationFrame(() => {
      if (typeToConfirm) {
        inputRef.current?.focus();
      } else {
        confirmBtnRef.current?.focus();
      }
    });
    return () => window.cancelAnimationFrame(id);
  }, [open, typeToConfirm]);

  if (!open) return null;

  const typeMatches = !typeToConfirm || typedValue === typeToConfirm;
  const confirmDisabled = submitting || !typeMatches;

  const confirmClass = danger
    ? 'bg-red-600 hover:bg-red-700 text-white border-red-600'
    : 'bg-[#aa00ff] hover:bg-[#8c52ff] text-white border-[#aa00ff]';

  const handleBackdropClick = () => {
    if (!submitting) onClose();
  };

  const handleConfirm = async () => {
    if (confirmDisabled) return;
    try {
      setSubmitting(true);
      await onConfirm();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        aria-describedby="confirm-modal-description"
        className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="confirm-modal-title"
          className="text-lg font-semibold text-slate-900"
        >
          {title}
        </h2>
        <p
          id="confirm-modal-description"
          className="mt-2 text-sm text-slate-600"
        >
          {description}
        </p>

        {typeToConfirm && (
          <div className="mt-4">
            <input
              ref={inputRef}
              type="text"
              value={typedValue}
              onChange={(e) => setTypedValue(e.target.value)}
              placeholder={`請輸入 ${typeToConfirm} 以確認`}
              disabled={submitting}
              className="w-full px-3 py-2 rounded-md border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#aa00ff] focus:border-transparent disabled:opacity-50"
            />
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium rounded-md border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {cancelText}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            onClick={handleConfirm}
            disabled={confirmDisabled}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md border disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${confirmClass}`}
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
