"use client";

import { useMemo, useState } from "react";
import { inputClassName } from "../employees/employee-record-utils";
import type { FinishedProductRecord } from "../inventory/finished-products-utils";
import { isNonInternalBarcode } from "@/utils/finished-product-barcode-type";
import { useConfirm } from "@/components/feedback/feedback-context";
import { createClient } from "@/utils/supabase/client";
import {
  findFinishedProductIdByBarcode,
  mapFinishedProductBarcodeSaveError,
  normalizeProductBarcodeInput,
} from "@/utils/finished-product-barcode-utils";

type PosUnknownBarcodeModalProps = {
  scannedCode: string;
  products: FinishedProductRecord[];
  onClose: () => void;
  onAssigned: (product: FinishedProductRecord) => void;
  onCreateNew: (code: string) => void;
};

export default function PosUnknownBarcodeModal({
  scannedCode,
  products,
  onClose,
  onAssigned,
  onCreateNew,
}: PosUnknownBarcodeModalProps) {
  const supabase = useMemo(() => createClient(), []);
  const confirm = useConfirm();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [saving, setSaving] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const activeProducts = useMemo(
    () =>
      products.filter((product) => !product.is_archived).sort((a, b) =>
        a.product_name.localeCompare(b.product_name),
      ),
    [products],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return activeProducts;
    }
    return activeProducts.filter(
      (product) =>
        product.product_code.toLowerCase().includes(q) ||
        product.product_name.toLowerCase().includes(q) ||
        product.barcode.toLowerCase().includes(q),
    );
  }, [activeProducts, query]);

  const selected = activeProducts.find((p) => p.id === selectedId) ?? null;

  async function handleAssign() {
    if (!selected) {
      setFieldError("Select a product.");
      return;
    }

    if (isNonInternalBarcode(selected.barcode)) {
      const ok = await confirm({
        title: "Replace existing barcode?",
        message: `${selected.product_code} already has barcode ${selected.barcode}. Replace it with ${scannedCode}?`,
        confirmLabel: "Replace barcode",
        cancelLabel: "Cancel",
        destructive: true,
      });
      if (!ok) {
        return;
      }
    }

    setSaving(true);
    setFieldError(null);
    const barcode = normalizeProductBarcodeInput(scannedCode);
    const duplicate = await findFinishedProductIdByBarcode(
      supabase,
      barcode,
      selected.id,
    );
    if (duplicate.error) {
      setFieldError(duplicate.error);
      setSaving(false);
      return;
    }
    if (duplicate.productId) {
      setFieldError("This barcode is already used by another product.");
      setSaving(false);
      return;
    }

    const { error } = await supabase
      .from("finished_products")
      .update({ barcode, updated_at: new Date().toISOString() })
      .eq("id", selected.id);

    setSaving(false);
    if (error) {
      setFieldError(
        mapFinishedProductBarcodeSaveError(error) ?? error.message,
      );
      return;
    }

    onAssigned({ ...selected, barcode });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pos-unknown-barcode-title"
      >
        <h2
          id="pos-unknown-barcode-title"
          className="text-lg font-semibold text-[#0f2744]"
        >
          Barcode not found
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          No product matches <span className="font-mono font-medium">{scannedCode}</span>.
          Assign it to an existing product or create a new one.
        </p>

        <div className="mt-4 space-y-3">
          <label className="block text-sm font-medium text-slate-700">
            Search products
          </label>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className={inputClassName}
            placeholder="Code, name, or barcode"
          />
          <select
            value={selectedId}
            onChange={(event) => {
              setSelectedId(event.target.value);
              setFieldError(null);
            }}
            className={inputClassName}
            size={6}
          >
            <option value="">Select a product…</option>
            {filtered.map((product) => (
              <option key={product.id} value={product.id}>
                {product.product_code} — {product.product_name} (barcode:{" "}
                {product.barcode || "—"})
              </option>
            ))}
          </select>
          {fieldError ? (
            <p className="text-sm text-red-700">{fieldError}</p>
          ) : null}
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onCreateNew(scannedCode)}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Create new product
          </button>
          <button
            type="button"
            disabled={saving || !selectedId}
            onClick={() => void handleAssign()}
            className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c] disabled:opacity-50"
          >
            {saving ? "Saving…" : "Assign to selected product"}
          </button>
        </div>
      </div>
    </div>
  );
}
