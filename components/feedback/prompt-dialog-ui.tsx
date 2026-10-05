"use client";

import { useId, useRef, useState } from "react";
import { useDialogKeyboard } from "./use-dialog-keyboard";
import { useFocusTrap } from "./use-focus-trap";

export type PromptDialogUiProps = {
  title: string;
  message: string;
  defaultValue?: string;
  inputLabel?: string;
  confirmLabel: string;
  cancelLabel: string;
  required?: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
};

export function PromptDialogUi({
  title,
  message,
  defaultValue = "",
  inputLabel,
  confirmLabel,
  cancelLabel,
  required = false,
  onConfirm,
  onCancel,
}: PromptDialogUiProps) {
  const titleId = useId();
  const bodyId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [value, setValue] = useState(defaultValue);

  useFocusTrap(true, panelRef);
  useDialogKeyboard(true, {
    onPrimary: () => {
      const trimmed = value.trim();
      if (required && !trimmed) {
        return;
      }
      onConfirm(trimmed);
    },
    onDismiss: onCancel,
    primaryButtonRef: confirmRef,
  });

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
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
        <div className="mt-4">
          {inputLabel ? (
            <label className="mb-1 block text-sm font-medium text-slate-700">
              {inputLabel}
            </label>
          ) : null}
          <input
            type="text"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]"
            autoFocus
          />
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => {
              const trimmed = value.trim();
              if (required && !trimmed) {
                return;
              }
              onConfirm(trimmed);
            }}
            className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c]"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
