"use client";

import { useEffect, useMemo, useState } from "react";
import { inputClassName } from "../employees/employee-record-utils";
import { resolveProductBarcode } from "@/utils/batch-label-utils";
import type { FinishedProductRecord } from "./finished-products-utils";
import { useTenantDeviceSettings } from "@/hooks/use-tenant-device-settings";
import { labelDimensions, labelPrintCss } from "@/utils/device-print-layout";

type BulkPrintItem = {
  product: FinishedProductRecord;
  quantity: number;
};

type ProductBarcodeLabelsBulkPrintProps = {
  items: BulkPrintItem[];
  onClose: () => void;
};

type LabelSlot = {
  key: string;
  productName: string;
  payload: string;
  dataUrl: string | null;
};

export default function ProductBarcodeLabelsBulkPrint({
  items,
  onClose,
}: ProductBarcodeLabelsBulkPrintProps) {
  const [quantities, setQuantities] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const item of items) {
      initial[item.product.id] = String(Math.max(1, item.quantity));
    }
    return initial;
  });
  const [slots, setSlots] = useState<LabelSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { label_size: labelSize } = useTenantDeviceSettings();
  const labelBox = labelDimensions(labelSize);

  const resolvedItems = useMemo(() => {
    return items.map((item) => {
      let payload: string | null = null;
      try {
        payload = resolveProductBarcode({
          barcode: item.product.barcode,
          product_code: item.product.product_code,
        });
      } catch {
        payload = null;
      }
      return {
        product: item.product,
        payload,
      };
    });
  }, [items]);

  useEffect(() => {
    let cancelled = false;

    async function loadAll() {
      setLoading(true);
      setLoadError(null);
      const nextSlots: LabelSlot[] = [];

      for (const entry of resolvedItems) {
        const quantity = Math.max(
          1,
          Math.min(
            500,
            Math.floor(Number.parseFloat(quantities[entry.product.id] ?? "1") || 1),
          ),
        );
        if (!entry.payload) {
          continue;
        }

        const response = await fetch("/api/inventory/batch-label/barcode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payload: entry.payload }),
        });
        const body = (await response.json().catch(() => null)) as
          | { data_url?: string; error?: string }
          | null;

        if (!response.ok || !body?.data_url) {
          if (!cancelled) {
            setLoadError(body?.error ?? "Unable to generate barcode images.");
            setLoading(false);
          }
          return;
        }

        for (let index = 0; index < quantity; index += 1) {
          nextSlots.push({
            key: `${entry.product.id}-${index}`,
            productName: entry.product.product_name.trim() || "Product",
            payload: entry.payload,
            dataUrl: body.data_url,
          });
        }
      }

      if (!cancelled) {
        setSlots(nextSlots);
        setLoading(false);
      }
    }

    void loadAll();

    return () => {
      cancelled = true;
    };
  }, [quantities, resolvedItems]);

  function handlePrint() {
    window.print();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 print:static print:bg-transparent print:p-0">
      <style>{labelPrintCss(labelSize, "product-barcode-bulk-print-area")}</style>
      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #product-barcode-bulk-print-area,
          #product-barcode-bulk-print-area * {
            visibility: visible;
          }
          #product-barcode-bulk-print-area {
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
        <h2 className="text-lg font-semibold text-[#0f2744]">Bulk label print</h2>
        <p className="mt-1 text-sm text-slate-600">
          One print job for all selected products. Adjust quantity per product,
          then print.
        </p>

        <ul className="mt-4 max-h-48 space-y-2 overflow-y-auto text-sm">
          {items.map((item) => (
            <li
              key={item.product.id}
              className="flex items-center justify-between gap-2"
            >
              <span className="truncate">
                {item.product.product_code} — {item.product.product_name}
              </span>
              <input
                type="number"
                min={1}
                max={500}
                value={quantities[item.product.id] ?? "1"}
                onChange={(event) =>
                  setQuantities((current) => ({
                    ...current,
                    [item.product.id]: event.target.value,
                  }))
                }
                className={`${inputClassName} w-20`}
                aria-label={`Quantity for ${item.product.product_code}`}
              />
            </li>
          ))}
        </ul>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
          <button
            type="button"
            onClick={handlePrint}
            disabled={loading || Boolean(loadError) || slots.length === 0}
            className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c] disabled:opacity-50"
          >
            Print {slots.length} label{slots.length === 1 ? "" : "s"}
          </button>
        </div>

        {loading ? (
          <p className="mt-3 text-sm text-slate-600">Preparing labels…</p>
        ) : null}
        {loadError ? (
          <p className="mt-3 text-sm text-red-700">{loadError}</p>
        ) : null}
      </div>

      <div
        id="product-barcode-bulk-print-area"
        className="h-0 overflow-hidden"
        aria-hidden="true"
      >
        <div className="product-barcode-label-grid flex flex-wrap gap-3 print:grid">
          {slots.map((slot) => (
            <div
              key={slot.key}
              className="device-label-sheet flex flex-col items-center justify-between rounded border border-slate-300 bg-white p-2 text-center print:rounded-none"
              style={{ width: labelBox.width, minHeight: labelBox.height }}
            >
              <p className="line-clamp-2 w-full text-[10px] font-medium leading-tight text-slate-800">
                {slot.productName}
              </p>
              {slot.dataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={slot.dataUrl}
                  alt={`Barcode for ${slot.productName}`}
                  className="my-1 h-12 w-full object-contain"
                />
              ) : null}
              <p className="w-full truncate text-[9px] text-slate-600">
                {slot.payload}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
