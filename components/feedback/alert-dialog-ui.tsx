"use client";

import { useId, useRef } from "react";
import { useDialogKeyboard } from "./use-dialog-keyboard";
import { useFocusTrap } from "./use-focus-trap";

export type AlertVariant = "error" | "warning" | "info";

const TITLE_BY_VARIANT: Record<AlertVariant, string> = {
  error: "Could not complete action",
  warning: "Please review",
  info: "Notice",
};

const TITLE_CLASS_BY_VARIANT: Record<AlertVariant, string> = {
  error: "text-[#0f2744]",
  warning: "text-amber-900",
  info: "text-[#0f2744]",
};

export type AlertDialogUiProps = {
  variant: AlertVariant;
  title?: string;
  message: string;
  onClose: () => void;
};

export function AlertDialogUi({
  variant,
  title,
  message,
  onClose,
}: AlertDialogUiProps) {
  const titleId = useId();
  const bodyId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useFocusTrap(true, panelRef);
  useDialogKeyboard(true, { onPrimary: onClose, onDismiss: onClose });

  const resolvedTitle = title?.trim() || TITLE_BY_VARIANT[variant];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl"
      >
        <h3
          id={titleId}
          className={`text-lg font-semibold ${TITLE_CLASS_BY_VARIANT[variant]}`}
        >
          {resolvedTitle}
        </h3>
        <p
          id={bodyId}
          className="mt-3 whitespace-pre-wrap text-sm text-slate-700"
        >
          {message}
        </p>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c]"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
