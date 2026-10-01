"use client";

import { useId, useRef } from "react";
import { useDialogKeyboard } from "./use-dialog-keyboard";
import { useFocusTrap } from "./use-focus-trap";

export type ConfirmDialogUiProps = {
  title: string;
  message: string;
  detail?: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialogUi({
  title,
  message,
  detail,
  confirmLabel,
  cancelLabel,
  destructive,
  onConfirm,
  onCancel,
}: ConfirmDialogUiProps) {
  const titleId = useId();
  const bodyId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useFocusTrap(true, panelRef);
  useDialogKeyboard(true, { onPrimary: onConfirm, onDismiss: onCancel });

  const confirmClassName = destructive
    ? "rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800"
    : "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c]";

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <div
        ref={panelRef}
        className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl"
      >
        <h3 id={titleId} className="text-lg font-semibold text-[#0f2744]">
          {title}
        </h3>
        <p id={bodyId} className="mt-3 whitespace-pre-wrap text-sm text-slate-700">
          {message}
        </p>
        {detail?.trim() ? (
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{detail}</p>
        ) : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {cancelLabel}
          </button>
          <button type="button" autoFocus onClick={onConfirm} className={confirmClassName}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
