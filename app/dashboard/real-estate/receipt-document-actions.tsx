"use client";

import { useState } from "react";
import { pdf, type DocumentProps } from "@react-pdf/renderer";
import type { ReactElement } from "react";

type Props = {
  fileName: string;
  printAreaId: string;
  renderPdfDocument: () => ReactElement<DocumentProps>;
  printLabel?: string;
  downloadLabel?: string;
  secondaryButtonClassName: string;
  primaryButtonClassName: string;
};

function ReceiptPrintStyles({ printAreaId }: { printAreaId: string }) {
  return (
    <style>{`
      @media print {
        body * {
          visibility: hidden;
        }

        #${printAreaId},
        #${printAreaId} * {
          visibility: visible;
        }

        #${printAreaId} {
          position: absolute;
          inset: 0;
          width: 100%;
          padding: 24px;
          background: white;
        }

        .receipt-no-print {
          display: none !important;
        }
      }
    `}</style>
  );
}

export default function ReceiptDocumentActions({
  fileName,
  printAreaId,
  renderPdfDocument,
  printLabel = "Print receipt",
  downloadLabel = "Download PDF",
  secondaryButtonClassName,
  primaryButtonClassName,
}: Props) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownloadPdf() {
    setError(null);
    setDownloading(true);
    try {
      const blob = await pdf(renderPdfDocument()).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Unable to generate PDF.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="receipt-no-print space-y-2">
      <ReceiptPrintStyles printAreaId={printAreaId} />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={secondaryButtonClassName}
          onClick={() => window.print()}
        >
          {printLabel}
        </button>
        <button
          type="button"
          className={primaryButtonClassName}
          disabled={downloading}
          onClick={() => void handleDownloadPdf()}
        >
          {downloading ? "Generating PDF…" : downloadLabel}
        </button>
      </div>
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
