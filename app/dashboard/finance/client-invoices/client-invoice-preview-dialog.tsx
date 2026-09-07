"use client";

import { useCallback } from "react";
import ClientInvoicePrintLayout from "./client-invoice-print-layout";
import { ClientInvoicePrintStyles } from "./client-invoice-print-styles";
import type { ClientInvoiceDisplayProps } from "./client-invoice-display-utils";

export const CLIENT_INVOICE_PREVIEW_PRINT_AREA_ID = "client-invoice-preview-print-area";

type ClientInvoicePreviewDialogProps = {
  open: boolean;
  display: ClientInvoiceDisplayProps | null;
  onClose: () => void;
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]";

const secondaryButtonClassName =
  "rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50";

export default function ClientInvoicePreviewDialog({
  open,
  display,
  onClose,
}: ClientInvoicePreviewDialogProps) {
  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  if (!open || !display) {
    return null;
  }

  return (
    <div className="no-print fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 md:p-8">
      <ClientInvoicePrintStyles printAreaId={CLIENT_INVOICE_PREVIEW_PRINT_AREA_ID} />
      <div className="w-full max-w-5xl space-y-4">
        <div className="flex flex-wrap gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-lg">
          <button type="button" onClick={handlePrint} className={primaryButtonClassName}>
            Print
          </button>
          <button type="button" onClick={onClose} className={secondaryButtonClassName}>
            Close Preview
          </button>
        </div>
        <ClientInvoicePrintLayout
          display={display}
          printAreaId={CLIENT_INVOICE_PREVIEW_PRINT_AREA_ID}
        />
      </div>
    </div>
  );
}
