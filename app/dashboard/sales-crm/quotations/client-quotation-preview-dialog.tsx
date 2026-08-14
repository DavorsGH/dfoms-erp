"use client";

import { useCallback } from "react";
import ClientQuotationPrintLayout from "./client-quotation-print-layout";
import { ClientQuotationPrintStyles } from "./client-quotation-print-styles";
import type { ClientQuotationDisplayProps } from "./client-quotation-display-utils";

export const CLIENT_QUOTATION_PREVIEW_PRINT_AREA_ID = "client-quotation-preview-print-area";

type ClientQuotationPreviewDialogProps = {
  open: boolean;
  display: ClientQuotationDisplayProps | null;
  onClose: () => void;
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]";

const secondaryButtonClassName =
  "rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50";

export default function ClientQuotationPreviewDialog({
  open,
  display,
  onClose,
}: ClientQuotationPreviewDialogProps) {
  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  if (!open || !display) {
    return null;
  }

  return (
    <div className="no-print fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 md:p-8">
      <ClientQuotationPrintStyles printAreaId={CLIENT_QUOTATION_PREVIEW_PRINT_AREA_ID} />
      <div className="w-full max-w-5xl space-y-4">
        <div className="flex flex-wrap gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-lg">
          <button type="button" onClick={handlePrint} className={primaryButtonClassName}>
            Print
          </button>
          <button type="button" onClick={onClose} className={secondaryButtonClassName}>
            Close Preview
          </button>
        </div>
        <ClientQuotationPrintLayout
          display={display}
          printAreaId={CLIENT_QUOTATION_PREVIEW_PRINT_AREA_ID}
        />
      </div>
    </div>
  );
}
