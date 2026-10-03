"use client";

import { useId, useRef, type ReactNode } from "react";
import { useDialogKeyboard } from "@/components/feedback/use-dialog-keyboard";
import { useFocusTrap } from "@/components/feedback/use-focus-trap";

type BulkImportWizardDialogProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
};

export default function BulkImportWizardDialog({
  title,
  onClose,
  children,
  footer,
  wide = false,
}: BulkImportWizardDialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useFocusTrap(true, panelRef);
  useDialogKeyboard(true, { onPrimary: onClose, onDismiss: onClose });

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        className={`flex max-h-[min(90vh,720px)] w-full flex-col rounded-t-lg border border-slate-200 bg-white shadow-xl sm:rounded-lg ${
          wide ? "max-w-3xl" : "max-w-lg"
        }`}
      >
        <div className="border-b border-slate-200 px-4 py-4 sm:px-6">
          <h3 id={titleId} className="text-lg font-semibold text-[#0f2744]">
            {title}
          </h3>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {children}
        </div>
        {footer ? (
          <div className="border-t border-slate-200 px-4 py-3 sm:px-6">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}
