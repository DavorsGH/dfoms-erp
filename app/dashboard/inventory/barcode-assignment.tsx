"use client";

import { useMemo, useRef, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { inputClassName } from "../employees/employee-record-utils";
import FilteredListCount from "../filtered-list-count";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import { getStripedRowClassName } from "../finance/register-row-actions";
import {
  normalizeFinishedProduct,
  type FinishedProductRecord,
} from "./finished-products-utils";
import { formatUnit } from "@/utils/units-of-measure";
import {
  classifyFinishedProductBarcode,
  type FinishedProductBarcodeType,
} from "@/utils/finished-product-barcode-type";
import {
  findFinishedProductIdByBarcode,
  mapFinishedProductBarcodeSaveError,
  parseProductBarcodeText,
} from "@/utils/finished-product-barcode-utils";
import { allocateProductBarcode } from "./inventory-ids-api";
import { BARCODE_WEDGE_INPUT_ATTR } from "@/utils/barcode-scan-utils";
import ProductBarcodeLabelPrint from "./product-barcode-label-print";
import ProductBarcodeLabelsBulkPrint from "./product-barcode-labels-bulk-print";
import { useToast } from "@/components/feedback/feedback-context";

type BarcodeTypeFilter = "all" | FinishedProductBarcodeType;

type BarcodeAssignmentProps = {
  initialProducts: FinishedProductRecord[];
  readOnly: boolean;
  fetchError: string | null;
};

export default function BarcodeAssignment({
  initialProducts,
  readOnly,
  fetchError,
}: BarcodeAssignmentProps) {
  const supabase = useMemo(() => createClient(), []);
  const { toast } = useToast();
  const [products, setProducts] = useState(
    initialProducts.map(normalizeFinishedProduct),
  );
  const [error, setError] = useState<string | null>(fetchError);
  const [typeFilter, setTypeFilter] = useState<BarcodeTypeFilter>("all");
  const [filterCode, setFilterCode] = useState("");
  const [filterName, setFilterName] = useState("");
  const [filterBarcode, setFilterBarcode] = useState("");
  const [draftBarcodes, setDraftBarcodes] = useState<Record<string, string>>(
    {},
  );
  const [savingId, setSavingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [labelProduct, setLabelProduct] =
    useState<FinishedProductRecord | null>(null);
  const [bulkPrintOpen, setBulkPrintOpen] = useState(false);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const activeProducts = useMemo(
    () => products.filter((product) => !product.is_archived),
    [products],
  );

  const displayRows = useMemo(() => {
    const codeQ = filterCode.trim().toLowerCase();
    const nameQ = filterName.trim().toLowerCase();
    const barcodeQ = filterBarcode.trim().toLowerCase();

    return activeProducts.filter((product) => {
      const barcodeType = classifyFinishedProductBarcode(product.barcode);
      if (typeFilter !== "all" && barcodeType !== typeFilter) {
        return false;
      }
      if (codeQ && !product.product_code.toLowerCase().includes(codeQ)) {
        return false;
      }
      if (nameQ && !product.product_name.toLowerCase().includes(nameQ)) {
        return false;
      }
      if (
        barcodeQ &&
        !(product.barcode ?? "").toLowerCase().includes(barcodeQ)
      ) {
        return false;
      }
      return true;
    });
  }, [
    activeProducts,
    filterBarcode,
    filterCode,
    filterName,
    typeFilter,
  ]);

  function barcodeDraft(product: FinishedProductRecord): string {
    return draftBarcodes[product.id] ?? product.barcode ?? "";
  }

  function setBarcodeDraft(productId: string, value: string) {
    setDraftBarcodes((current) => ({ ...current, [productId]: value }));
    const input = inputRefs.current[productId];
    if (input) {
      input.setCustomValidity("");
    }
  }

  async function saveBarcode(product: FinishedProductRecord) {
    if (readOnly) {
      return;
    }
    const parsed = parseProductBarcodeText(barcodeDraft(product));
    const input = inputRefs.current[product.id];
    if (!parsed.ok) {
      if (input) {
        input.setCustomValidity(parsed.error);
        input.reportValidity();
      }
      return;
    }
    const barcode = parsed.barcode;

    setSavingId(product.id);
    setError(null);
    if (barcode) {
      const duplicate = await findFinishedProductIdByBarcode(
        supabase,
        barcode,
        product.id,
      );
      if (duplicate.error) {
        setError(duplicate.error);
        setSavingId(null);
        return;
      }
      if (duplicate.productId) {
        const field = inputRefs.current[product.id];
        if (field) {
          field.setCustomValidity(
            "This barcode is already used by another product.",
          );
          field.reportValidity();
        }
        setSavingId(null);
        return;
      }
    }

    const { error: saveError } = await supabase
      .from("finished_products")
      .update({ barcode, updated_at: new Date().toISOString() })
      .eq("id", product.id);

    setSavingId(null);
    if (saveError) {
      const message = mapFinishedProductBarcodeSaveError(saveError);
      const input = inputRefs.current[product.id];
      if (message && input) {
        input.setCustomValidity(message);
        input.reportValidity();
        return;
      }
      setError(saveError.message);
      return;
    }

    setProducts((current) =>
      current.map((row) =>
        row.id === product.id ? { ...row, barcode: barcode ?? "" } : row,
      ),
    );
    setDraftBarcodes((current) => {
      const next = { ...current };
      delete next[product.id];
      return next;
    });
    toast(barcode ? "Barcode saved." : "Barcode removed.");
  }

  async function useInternalCode(product: FinishedProductRecord) {
    if (readOnly) {
      return;
    }
    setSavingId(product.id);
    setError(null);
    const allocated = await allocateProductBarcode(supabase);
    setSavingId(null);
    if (allocated.error || !allocated.barcode) {
      setError(allocated.error ?? "Unable to allocate internal barcode.");
      return;
    }
    setBarcodeDraft(product.id, allocated.barcode);
    await saveBarcode({ ...product, barcode: allocated.barcode });
  }

  const bulkPrintItems = useMemo(() => {
    return [...selectedIds]
      .map((id) => products.find((product) => product.id === id))
      .filter((product): product is FinishedProductRecord => Boolean(product))
      .map((product) => ({ product, quantity: 1 }));
  }, [products, selectedIds]);

  return (
    <div className="space-y-6">
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-slate-700">Barcode type</span>
        {(
          [
            ["all", "All"],
            ["internal", "Internal only"],
            ["manufacturer", "Manufacturer"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTypeFilter(value)}
            className={`rounded-full px-3 py-1 text-sm font-medium ${
              typeFilter === value
                ? "bg-[#0f2744] text-white"
                : "border border-slate-300 text-slate-700 hover:bg-slate-50"
            }`}
          >
            {label}
          </button>
        ))}
        {!readOnly ? (
          <button
            type="button"
            disabled={selectedIds.size === 0}
            onClick={() => setBulkPrintOpen(true)}
            className="ml-auto rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Print labels for selected ({selectedIds.size})
          </button>
        ) : null}
      </div>

      <FilteredListCount
        totalCount={activeProducts.length}
        filteredCount={displayRows.length}
        itemSingular="product"
        hasActiveFilters={
          typeFilter !== "all" ||
          filterCode.trim() !== "" ||
          filterName.trim() !== "" ||
          filterBarcode.trim() !== ""
        }
      />

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              {!readOnly ? (
                <th className={scrollableTableThClassName}>
                  <input
                    type="checkbox"
                    checked={
                      displayRows.length > 0 &&
                      displayRows.every((row) => selectedIds.has(row.id))
                    }
                    onChange={(event) => {
                      if (!event.target.checked) {
                        setSelectedIds(new Set());
                        return;
                      }
                      setSelectedIds(new Set(displayRows.map((row) => row.id)));
                    }}
                    aria-label="Select all visible products"
                    className="h-4 w-4 rounded border-slate-300"
                  />
                </th>
              ) : null}
              <th className={scrollableTableThClassName}>Code</th>
              <th className={scrollableTableThClassName}>Product</th>
              <th className={scrollableTableThClassName}>Unit</th>
              <th className={scrollableTableThClassName}>Current barcode</th>
              <th className={scrollableTableThClassName}>Type</th>
              {!readOnly ? (
                <th className={scrollableTableThClassName}>Assign barcode</th>
              ) : null}
            </tr>
            <tr>
              {!readOnly ? <th className={scrollableTableThClassName} /> : null}
              <th className={scrollableTableThClassName}>
                <input
                  type="search"
                  value={filterCode}
                  onChange={(event) => setFilterCode(event.target.value)}
                  placeholder="Filter"
                  className="w-full rounded border border-white/30 bg-white/10 px-2 py-1 text-xs text-white placeholder:text-white/60"
                />
              </th>
              <th className={scrollableTableThClassName}>
                <input
                  type="search"
                  value={filterName}
                  onChange={(event) => setFilterName(event.target.value)}
                  placeholder="Filter"
                  className="w-full rounded border border-white/30 bg-white/10 px-2 py-1 text-xs text-white placeholder:text-white/60"
                />
              </th>
              <th className={scrollableTableThClassName} colSpan={2} />
              <th className={scrollableTableThClassName}>
                <input
                  type="search"
                  value={filterBarcode}
                  onChange={(event) => setFilterBarcode(event.target.value)}
                  placeholder="Filter barcode"
                  className="w-full rounded border border-white/30 bg-white/10 px-2 py-1 text-xs text-white placeholder:text-white/60"
                />
              </th>
              {!readOnly ? <th className={scrollableTableThClassName} /> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {displayRows.length === 0 ? (
              <tr>
                <td
                  colSpan={readOnly ? 5 : 7}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  No products match the current filters.
                </td>
              </tr>
            ) : (
              displayRows.map((product, index) => {
                const barcodeType = classifyFinishedProductBarcode(
                  product.barcode,
                );
                return (
                  <tr
                    key={product.id}
                    className={getStripedRowClassName(index)}
                  >
                    {!readOnly ? (
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(product.id)}
                          onChange={(event) => {
                            setSelectedIds((current) => {
                              const next = new Set(current);
                              if (event.target.checked) {
                                next.add(product.id);
                              } else {
                                next.delete(product.id);
                              }
                              return next;
                            });
                          }}
                          aria-label={`Select ${product.product_code}`}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                      </td>
                    ) : null}
                    <td className="px-4 py-3">{product.product_code}</td>
                    <td className="px-4 py-3 font-medium text-[#0f2744]">
                      {product.product_name}
                    </td>
                    <td className="px-4 py-3">
                      {formatUnit(product.unit_of_measure)}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm">
                      {product.barcode || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          barcodeType === "internal"
                            ? "bg-slate-200 text-slate-800"
                            : "bg-blue-100 text-blue-900"
                        }`}
                      >
                        {barcodeType === "internal" ? "Internal" : "Manufacturer"}
                      </span>
                    </td>
                    {!readOnly ? (
                      <td className="px-4 py-3">
                        <div className="flex min-w-[14rem] flex-col gap-2">
                          <div {...{ [BARCODE_WEDGE_INPUT_ATTR]: product.id }}>
                            <input
                              ref={(node) => {
                                inputRefs.current[product.id] = node;
                              }}
                              type="text"
                              value={barcodeDraft(product)}
                              onChange={(event) =>
                                setBarcodeDraft(product.id, event.target.value)
                              }
                              className={inputClassName}
                              placeholder="Scan or type barcode"
                            />
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={savingId === product.id}
                              onClick={() => void saveBarcode(product)}
                              className="rounded-md bg-[#0f2744] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1a3a5c] disabled:opacity-50"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              disabled={savingId === product.id}
                              onClick={() => void useInternalCode(product)}
                              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            >
                              Use internal code
                            </button>
                            <button
                              type="button"
                              onClick={() => setLabelProduct(product)}
                              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              Print labels
                            </button>
                          </div>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </ScrollableTable>

      {labelProduct ? (
        <ProductBarcodeLabelPrint
          product={labelProduct}
          onClose={() => setLabelProduct(null)}
        />
      ) : null}

      {bulkPrintOpen && bulkPrintItems.length > 0 ? (
        <ProductBarcodeLabelsBulkPrint
          items={bulkPrintItems}
          onClose={() => setBulkPrintOpen(false)}
        />
      ) : null}
    </div>
  );
}
