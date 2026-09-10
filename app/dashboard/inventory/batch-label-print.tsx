"use client";

import { useEffect, useMemo, useState } from "react";
import { inputClassName } from "../employees/employee-record-utils";
import {
  generateBatchLabelPayload,
  resolveProductBarcode,
} from "@/utils/batch-label-utils";
import type { ProductionBatchRecord } from "./production-batches-utils";

type BatchLabelPrintProps = {
  batch: ProductionBatchRecord;
  onClose: () => void;
};

function formatLabelDate(value: string | null | undefined): string {
  if (!value?.trim()) {
    return "—";
  }

  const normalized = value.trim().slice(0, 10);
  const parsed = Date.parse(`${normalized}T00:00:00Z`);
  if (!Number.isFinite(parsed)) {
    return normalized;
  }

  return new Date(parsed).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function defaultPrintQuantity(quantityProduced: number): number {
  const rounded = Math.floor(quantityProduced);
  if (rounded > 0) {
    return rounded;
  }

  return 1;
}

export default function BatchLabelPrint({ batch, onClose }: BatchLabelPrintProps) {
  const productName = batch.product?.product_name?.trim() || "Product";
  const batchNumber = batch.batch_number.trim();
  const expirationDate = batch.expiration_date?.trim()
    ? batch.expiration_date.trim().slice(0, 10)
    : null;

  const [quantityToPrint, setQuantityToPrint] = useState<string>(() =>
    String(defaultPrintQuantity(batch.quantity_produced)),
  );
  const [barcodeDataUrl, setBarcodeDataUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingBarcode, setLoadingBarcode] = useState(true);

  const payload = useMemo(() => {
    if (!batch.product?.product_code && !batch.product?.barcode) {
      return null;
    }

    try {
      const barcode = resolveProductBarcode({
        barcode: batch.product.barcode,
        product_code: batch.product.product_code,
      });
      return generateBatchLabelPayload(barcode, batchNumber, expirationDate);
    } catch (error) {
      return null;
    }
  }, [batch.product, batchNumber, expirationDate]);

  useEffect(() => {
    let cancelled = false;

    async function loadBarcode() {
      if (!payload) {
        setLoadError("This batch is missing a product barcode for label encoding.");
        setBarcodeDataUrl(null);
        setLoadingBarcode(false);
        return;
      }

      setLoadingBarcode(true);
      setLoadError(null);

      const response = await fetch("/api/inventory/batch-label/barcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload }),
      });

      const body = (await response.json().catch(() => null)) as
        | { data_url?: string; error?: string }
        | null;

      if (cancelled) {
        return;
      }

      if (!response.ok) {
        setLoadError(body?.error ?? "Unable to generate barcode image.");
        setBarcodeDataUrl(null);
        setLoadingBarcode(false);
        return;
      }

      setBarcodeDataUrl(body?.data_url ?? null);
      setLoadingBarcode(false);
    }

    void loadBarcode();

    return () => {
      cancelled = true;
    };
  }, [payload]);

  const labelCount = Math.max(
    1,
    Math.min(500, Math.floor(Number(quantityToPrint)) || 0),
  );

  function handlePrint() {
    window.setTimeout(() => window.print(), 150);
  }

  return (
    <>
      <style>{`
        .batch-label-sheet {
          width: 2in;
          height: 1.35in;
          break-inside: avoid;
          page-break-inside: avoid;
        }

        @media print {
          body * {
            visibility: hidden;
          }

          #batch-label-print-area,
          #batch-label-print-area * {
            visibility: visible;
          }

          #batch-label-print-area {
            position: absolute;
            inset: 0;
            width: 100%;
            padding: 0.25in;
            background: white;
          }

          .batch-label-no-print {
            display: none !important;
          }

          .batch-label-grid {
            display: grid;
            grid-template-columns: repeat(3, 2in);
            gap: 0.15in 0.2in;
            justify-content: center;
          }
        }
      `}</style>

      <div className="batch-label-no-print space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-[#0f2744]">
              Print Batch Label — {batchNumber}
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              {productName}. Each label encodes product barcode, batch number,
              and expiration date for scanning at POS or warehouse.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Close
          </button>
        </div>

        <div className="grid max-w-md gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Quantity to print
            </label>
            <input
              type="number"
              min={1}
              max={500}
              step={1}
              value={quantityToPrint}
              onChange={(event) => setQuantityToPrint(event.target.value)}
              className={inputClassName}
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handlePrint}
              disabled={loadingBarcode || !barcodeDataUrl || Boolean(loadError)}
              className="rounded-md bg-[#0f2744] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Print {labelCount} label{labelCount === 1 ? "" : "s"}
            </button>
          </div>

          {loadError ? (
            <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {loadError}
            </p>
          ) : null}

          {loadingBarcode ? (
            <p className="text-sm text-slate-600">Generating barcode…</p>
          ) : null}
        </div>
      </div>

      <div id="batch-label-print-area" className="mt-6">
        <div className="batch-label-grid flex flex-wrap gap-3 print:grid">
          {Array.from({ length: labelCount }, (_, index) => (
            <div
              key={`${batch.id}-label-${index}`}
              className="batch-label-sheet flex flex-col items-center justify-between rounded border border-slate-300 bg-white p-2 text-center print:rounded-none"
            >
              <p className="line-clamp-2 w-full text-[10px] font-semibold leading-tight text-[#0f2744]">
                {productName}
              </p>
              {barcodeDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={barcodeDataUrl}
                  alt={`Barcode for batch ${batchNumber}`}
                  className="my-1 h-10 w-full max-w-[1.75in] object-contain"
                />
              ) : (
                <div className="my-1 h-10 w-full max-w-[1.75in] bg-slate-100" />
              )}
              <div className="w-full text-[9px] leading-tight text-slate-700">
                <p className="font-medium">Batch {batchNumber}</p>
                <p>Exp {formatLabelDate(expirationDate)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
