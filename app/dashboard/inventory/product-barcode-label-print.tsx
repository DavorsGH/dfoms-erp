"use client";

import { useEffect, useMemo, useState } from "react";
import { inputClassName } from "../employees/employee-record-utils";
import { resolveProductBarcode } from "@/utils/batch-label-utils";
import type { FinishedProductRecord } from "./finished-products-utils";
import { useTenantDeviceSettings } from "@/hooks/use-tenant-device-settings";
import { labelDimensions, labelPrintCss } from "@/utils/device-print-layout";

type ProductBarcodeLabelPrintProps = {
  product: FinishedProductRecord;
  onClose: () => void;
};

export default function ProductBarcodeLabelPrint({
  product,
  onClose,
}: ProductBarcodeLabelPrintProps) {
  const productName = product.product_name.trim() || "Product";
  const { label_size: labelSize } = useTenantDeviceSettings();
  const labelBox = labelDimensions(labelSize);
  const [quantityToPrint, setQuantityToPrint] = useState("1");
  const [barcodeDataUrl, setBarcodeDataUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingBarcode, setLoadingBarcode] = useState(true);

  const payload = useMemo(() => {
    try {
      return resolveProductBarcode({
        barcode: product.barcode,
        product_code: product.product_code,
      });
    } catch {
      return null;
    }
  }, [product.barcode, product.product_code]);

  useEffect(() => {
    let cancelled = false;

    async function loadBarcode() {
      if (!payload) {
        setLoadError("This product needs a barcode or product code before labels can print.");
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

      if (!response.ok || !body?.data_url) {
        setLoadError(body?.error ?? "Unable to generate barcode image.");
        setBarcodeDataUrl(null);
        setLoadingBarcode(false);
        return;
      }

      setBarcodeDataUrl(body.data_url);
      setLoadingBarcode(false);
    }

    void loadBarcode();

    return () => {
      cancelled = true;
    };
  }, [payload]);

  const printCount = Math.max(
    1,
    Math.min(500, Math.floor(Number.parseFloat(quantityToPrint) || 0)),
  );

  function handlePrint() {
    window.print();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 print:static print:bg-transparent print:p-0">
      <style>{labelPrintCss(labelSize, "product-barcode-label-print-area")}</style>
      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #product-barcode-label-print-area,
          #product-barcode-label-print-area * {
            visibility: visible;
          }
          #product-barcode-label-print-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            height: auto !important;
            overflow: visible !important;
          }
          .product-barcode-label-no-print {
            display: none !important;
          }
          .product-barcode-label-grid {
            display: grid !important;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
          }
        }
      `}</style>

      <div className="product-barcode-label-no-print w-full max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-lg">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[#0f2744]">Print product labels</h2>
            <p className="mt-1 text-sm text-slate-600">
              Code128 labels for {productName}. Each label encodes the product barcode only
              (no batch number).
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Quantity to print
            </label>
            <input
              type="number"
              min={1}
              max={500}
              value={quantityToPrint}
              onChange={(event) => setQuantityToPrint(event.target.value)}
              className={inputClassName}
            />
          </div>

          <div className="overflow-hidden rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="mb-2 text-xs font-medium text-slate-500">Label preview</p>
            <div className="flex justify-center">
              <div
                className="device-label-sheet flex max-w-full flex-col items-center justify-between rounded border border-slate-300 bg-white p-2 text-center"
                style={{
                  width: `min(100%, ${labelBox.width})`,
                  aspectRatio: `${Number.parseFloat(labelBox.width) || 50} / ${
                    Number.parseFloat(labelBox.height) || 25
                  }`,
                }}
              >
                <p className="line-clamp-2 w-full text-[10px] font-medium leading-tight text-slate-800">
                  {productName}
                </p>
                {barcodeDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={barcodeDataUrl}
                    alt={`Barcode for ${productName}`}
                    className="my-1 h-12 w-full object-contain"
                  />
                ) : (
                  <p className="my-2 text-xs text-slate-500">
                    {loadingBarcode ? "Generating barcode…" : "Preview unavailable"}
                  </p>
                )}
                <p className="w-full truncate text-[9px] text-slate-600">{payload ?? ""}</p>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handlePrint}
            disabled={loadingBarcode || !barcodeDataUrl || Boolean(loadError)}
            className="w-full rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Print {printCount} label{printCount === 1 ? "" : "s"}
          </button>

          {loadingBarcode ? (
            <p className="text-sm text-slate-600">Generating barcode…</p>
          ) : null}
          {loadError ? (
            <p className="text-sm text-red-700">{loadError}</p>
          ) : null}
        </div>
      </div>

      <div
        id="product-barcode-label-print-area"
        className="h-0 overflow-hidden"
        aria-hidden="true"
      >
        <div className="product-barcode-label-grid flex flex-wrap gap-3 print:grid">
          {Array.from({ length: printCount }, (_, index) => (
            <div
              key={index}
              className="device-label-sheet flex flex-col items-center justify-between rounded border border-slate-300 bg-white p-2 text-center print:rounded-none"
              style={{ width: labelBox.width, minHeight: labelBox.height }}
            >
              <p className="line-clamp-2 w-full text-[10px] font-medium leading-tight text-slate-800">
                {productName}
              </p>
              {barcodeDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={barcodeDataUrl}
                  alt={`Barcode for ${productName}`}
                  className="my-1 h-12 w-full object-contain"
                />
              ) : null}
              <p className="w-full truncate text-[9px] text-slate-600">{payload ?? ""}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
