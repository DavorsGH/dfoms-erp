"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { inputClassName } from "../employees/employee-record-utils";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import FilteredListCount from "../filtered-list-count";
import { useStampBusinessUnitId, useBusinessUnitReadScope } from "@/app/dashboard/business-unit-view-context";
import { applyBusinessUnitScope } from "@/utils/business-unit-view";
import {
  formatInventoryMoney,
  formatInventoryQuantity,
  nullableText,
} from "./inventory-utils";
import { allocateBatchNumber } from "./inventory-ids-api";
import {
  calculateBatchPreview,
  normalizeProductionBatch,
  PRODUCTION_BATCH_DETAIL_SELECT,
  type ProductionBatchRecord,
} from "./production-batches-utils";
import {
  normalizeRawMaterial,
  RAW_MATERIAL_SELECT,
  type RawMaterialRecord,
} from "./raw-materials-utils";
import {
  fetchScopedRawMaterialStock,
  mergeScopedStockOntoMaterials,
} from "./raw-material-bu-stock-utils";
import {
  FINISHED_PRODUCT_SELECT,
  normalizeFinishedProduct,
  type FinishedProductRecord,
} from "./finished-products-utils";
import {
  fetchScopedFinishedProductStock,
  mergeScopedStockOntoProducts,
} from "./finished-product-bu-stock-utils";

type ProductionBatchesProps = {
  initialBatches: ProductionBatchRecord[];
  initialProducts: FinishedProductRecord[];
  initialMaterials: RawMaterialRecord[];
  fetchError: string | null;
  readOnly?: boolean;
  /** Create-only stamp; null = All Businesses. */
  activeBusinessUnitId?: string | null;
  /** Workspace id for BU-scoped stock overlays. */
  tenantId?: string | null;
};

type MaterialLine = {
  material_id: string;
  quantity_used: string;
};

const emptyBatchForm = {
  batch_number: "",
  production_date: new Date().toISOString().slice(0, 10),
  finished_product_id: "",
  quantity_produced: "",
  manufacturing_date: "",
  expiration_date: "",
  notes: "",
};

const emptyMaterialLine: MaterialLine = {
  material_id: "",
  quantity_used: "",
};

export default function ProductionBatches({
  initialBatches,
  initialProducts,
  initialMaterials,
  fetchError,
  readOnly = false,
  activeBusinessUnitId = null,
  tenantId = null,
}: ProductionBatchesProps) {
  const supabase = createClient();
  const stampBusinessUnit = useStampBusinessUnitId();
  const buReadScope = useBusinessUnitReadScope();
  const skipFirstStockScopeRefresh = useRef(true);
  const [batches, setBatches] = useState(
    initialBatches.map(normalizeProductionBatch),
  );
  const [products, setProducts] = useState(
    initialProducts.map(normalizeFinishedProduct),
  );
  const [materials, setMaterials] = useState(
    initialMaterials.map(normalizeRawMaterial),
  );
  const [showForm, setShowForm] = useState(false);
  const [batchForm, setBatchForm] = useState(emptyBatchForm);
  const [materialLines, setMaterialLines] = useState<MaterialLine[]>([
    { ...emptyMaterialLine },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmingBatchId, setConfirmingBatchId] = useState<string | null>(
    null,
  );
  const [deletingBatchId, setDeletingBatchId] = useState<string | null>(null);

  useEffect(() => {
    setBatches(initialBatches.map(normalizeProductionBatch));
    setProducts(initialProducts.map(normalizeFinishedProduct));
    setMaterials(initialMaterials.map(normalizeRawMaterial));
  }, [initialBatches, initialProducts, initialMaterials]);

  const preview = useMemo(() => {
    const quantityProduced = Number.parseFloat(batchForm.quantity_produced);
    if (Number.isNaN(quantityProduced) || quantityProduced <= 0) {
      return null;
    }

    const lines: {
      material_id: string;
      quantity_used: number;
      cost_at_time: number;
    }[] = [];

    for (const line of materialLines) {
      if (!line.material_id || !line.quantity_used) {
        continue;
      }

      const quantityUsed = Number.parseFloat(line.quantity_used);
      if (Number.isNaN(quantityUsed) || quantityUsed <= 0) {
        continue;
      }

      const material = materials.find((item) => item.id === line.material_id);
      // Do not coerce null BU-scoped WAC to 0 — that would understate preview cost.
      if (material?.average_cost_per_unit == null) {
        return null;
      }

      lines.push({
        material_id: line.material_id,
        quantity_used: quantityUsed,
        cost_at_time: material.average_cost_per_unit,
      });
    }

    if (lines.length === 0) {
      return null;
    }

    return calculateBatchPreview(lines, quantityProduced);
  }, [batchForm.quantity_produced, materialLines, materials]);

  async function refreshData() {
    if (!tenantId) {
      setError("Unable to resolve your workspace.");
      return;
    }

    const [
      { data: batchRows, error: batchError },
      { data: productRows, error: productError },
      { data: materialRows, error: materialError },
    ] = await Promise.all([
      applyBusinessUnitScope(
        supabase
          .from("production_batches")
          .select(PRODUCTION_BATCH_DETAIL_SELECT),
        buReadScope,
      ).order("production_date", { ascending: false }),
      supabase
        .from("finished_products")
        .select(FINISHED_PRODUCT_SELECT)
        .eq("is_archived", false)
        .order("product_name", { ascending: true }),
      supabase
        .from("raw_materials")
        .select(RAW_MATERIAL_SELECT)
        .order("material_name", { ascending: true }),
    ]);

    if (batchError || productError || materialError) {
      setError(
        batchError?.message ??
          productError?.message ??
          materialError?.message ??
          "Refresh failed.",
      );
      return;
    }

    const [
      { stockMap: productStockMap, error: productStockScopeError },
      { stockMap: materialStockMap, error: materialStockScopeError },
    ] = await Promise.all([
      fetchScopedFinishedProductStock(supabase, tenantId, buReadScope),
      fetchScopedRawMaterialStock(supabase, tenantId, buReadScope),
    ]);
    if (productStockScopeError || materialStockScopeError) {
      setError(productStockScopeError ?? materialStockScopeError);
      return;
    }

    setBatches(
      (((batchRows as unknown) as ProductionBatchRecord[] | null) ?? []).map(
        (row) => normalizeProductionBatch(row),
      ),
    );
    setProducts(
      mergeScopedStockOntoProducts(
        ((productRows as FinishedProductRecord[] | null) ?? []).map((row) =>
          normalizeFinishedProduct(row),
        ),
        productStockMap,
        // Full catalog for first-time production under a named BU.
        "default",
      ),
    );
    setMaterials(
      mergeScopedStockOntoMaterials(
        ((materialRows as RawMaterialRecord[] | null) ?? []).map((row) =>
          normalizeRawMaterial(row),
        ),
        materialStockMap,
        buReadScope.mode,
        { overlayAverageCost: true },
      ),
    );
    setError(null);
  }

  useEffect(() => {
    if (skipFirstStockScopeRefresh.current) {
      skipFirstStockScopeRefresh.current = false;
      return;
    }
    void refreshData();
    // Re-scope stock overlays when the BU switcher changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional scope key
  }, [buReadScope.mode, buReadScope.mode === "unit" ? buReadScope.id : null]);

  function openAddForm() {
    setBatchForm({ ...emptyBatchForm });
    setMaterialLines([{ ...emptyMaterialLine }]);
    setShowForm(true);
  }

  function closeForm() {
    setBatchForm(emptyBatchForm);
    setMaterialLines([{ ...emptyMaterialLine }]);
    setShowForm(false);
  }

  function updateMaterialLine(
    index: number,
    field: keyof MaterialLine,
    value: string,
  ) {
    setMaterialLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index ? { ...line, [field]: value } : line,
      ),
    );
  }

  function addMaterialLine() {
    setMaterialLines((current) => [...current, { ...emptyMaterialLine }]);
  }

  function removeMaterialLine(index: number) {
    setMaterialLines((current) =>
      current.length === 1
        ? current
        : current.filter((_, lineIndex) => lineIndex !== index),
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    if (!stampBusinessUnit.ok) {
      setError(stampBusinessUnit.error);
      setLoading(false);
      return;
    }

    const quantityProduced = Number.parseFloat(batchForm.quantity_produced);
    if (Number.isNaN(quantityProduced) || quantityProduced <= 0) {
      setError("Quantity produced must be greater than zero.");
      setLoading(false);
      return;
    }

    if (!batchForm.finished_product_id) {
      setError("Select a finished product.");
      setLoading(false);
      return;
    }

    const materialPayload: {
      material_id: string;
      quantity_used: number;
      cost_at_time: number;
    }[] = [];

    for (const line of materialLines) {
      if (!line.material_id || !line.quantity_used) {
        continue;
      }

      const quantityUsed = Number.parseFloat(line.quantity_used);
      if (Number.isNaN(quantityUsed) || quantityUsed <= 0) {
        setError("Each material line must have a quantity greater than zero.");
        setLoading(false);
        return;
      }

      const material = materials.find((item) => item.id === line.material_id);
      if (!material) {
        setError("Select a valid raw material for each line.");
        setLoading(false);
        return;
      }

      if (material.current_stock < quantityUsed) {
        setError(
          `Insufficient stock for ${material.material_name}. Available: ${formatInventoryQuantity(material.current_stock)}.`,
        );
        setLoading(false);
        return;
      }

      // Defense in depth: under default BU, no balance ⇒ stock 0 + null WAC.
      // Stock check above should already block qty > 0; never coerce null → 0.
      if (material.average_cost_per_unit == null) {
        setError(
          `No unit cost on file for ${material.material_name} in this business. Record stock (opening balance / purchase) before using it in production.`,
        );
        setLoading(false);
        return;
      }

      materialPayload.push({
        material_id: line.material_id,
        quantity_used: quantityUsed,
        cost_at_time: material.average_cost_per_unit,
      });
    }

    if (materialPayload.length === 0) {
      setError("Add at least one raw material with quantity used.");
      setLoading(false);
      return;
    }

    const allocated = await allocateBatchNumber(supabase);
    if (allocated.error || !allocated.batchNumber) {
      setError(allocated.error ?? "Unable to allocate batch number.");
      setLoading(false);
      return;
    }

    const { error: rpcError } = await supabase.rpc("create_production_batch", {
      p_batch_number: allocated.batchNumber,
      p_production_date: batchForm.production_date,
      p_finished_product_id: batchForm.finished_product_id,
      p_quantity_produced: quantityProduced,
      p_notes: nullableText(batchForm.notes),
      p_materials: materialPayload,
      p_manufacturing_date: nullableText(batchForm.manufacturing_date),
      p_expiration_date: nullableText(batchForm.expiration_date),
      p_business_unit_id: stampBusinessUnit.businessUnitId,
    });

    if (rpcError) {
      setError(rpcError.message);
      setLoading(false);
      return;
    }

    closeForm();
    await refreshData();
    setLoading(false);
  }

  async function handleDeleteBatch(batch: ProductionBatchRecord) {
    setDeletingBatchId(batch.id);
    setConfirmingBatchId(null);
    setError(null);
    setSuccess(null);

    const { error: rpcError } = await supabase.rpc("delete_production_batch", {
      p_batch_id: batch.id,
    });

    if (rpcError) {
      setError(rpcError.message);
      setDeletingBatchId(null);
      return;
    }

    setBatches((current) => current.filter((row) => row.id !== batch.id));
    setSuccess(`Batch ${batch.batch_number} deleted.`);
    await refreshData();
    setDeletingBatchId(null);
  }

  return (
    <div className="space-y-6">
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {success ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {success}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-slate-600">
          Record production batches. Raw material stock decreases, finished
          product stock increases, and a stock movement ledger entry is created.
          Delete reverses a posted batch when enough finished stock remains.
        </p>
        {!readOnly ? (
        <button
          type="button"
          onClick={() => (showForm ? closeForm() : openAddForm())}
          className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
        >
          {showForm ? "Cancel" : "Create Production Batch"}
        </button>
        ) : null}
      </div>

      {showForm && !readOnly ? (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
            New Production Batch
          </h3>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Production Date
                </label>
                <input
                  type="date"
                  required
                  value={batchForm.production_date}
                  onChange={(event) =>
                    setBatchForm((current) => ({
                      ...current,
                      production_date: event.target.value,
                    }))
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Finished Product
                </label>
                <select
                  required
                  value={batchForm.finished_product_id}
                  onChange={(event) =>
                    setBatchForm((current) => ({
                      ...current,
                      finished_product_id: event.target.value,
                    }))
                  }
                  className={inputClassName}
                >
                  <option value="">Select product</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.product_code} — {product.product_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Quantity Produced
                </label>
                <input
                  type="number"
                  min={0.0001}
                  step="0.0001"
                  required
                  value={batchForm.quantity_produced}
                  onChange={(event) =>
                    setBatchForm((current) => ({
                      ...current,
                      quantity_produced: event.target.value,
                    }))
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Manufacturing Date{" "}
                  <span className="font-normal text-slate-500">(optional)</span>
                </label>
                <input
                  type="date"
                  value={batchForm.manufacturing_date}
                  onChange={(event) =>
                    setBatchForm((current) => ({
                      ...current,
                      manufacturing_date: event.target.value,
                    }))
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Expiration Date{" "}
                  <span className="font-normal text-slate-500">(optional)</span>
                </label>
                <input
                  type="date"
                  value={batchForm.expiration_date}
                  onChange={(event) =>
                    setBatchForm((current) => ({
                      ...current,
                      expiration_date: event.target.value,
                    }))
                  }
                  className={inputClassName}
                />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Notes
                </label>
                <textarea
                  rows={2}
                  value={batchForm.notes}
                  onChange={(event) =>
                    setBatchForm((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                  className={inputClassName}
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <h4 className="text-sm font-semibold text-[#0f2744]">
                  Materials Consumed
                </h4>
                <button
                  type="button"
                  onClick={addMaterialLine}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                >
                  Add Material Line
                </button>
              </div>

              {materialLines.map((line, index) => (
                <div
                  key={`material-line-${index}`}
                  className="grid gap-4 rounded-md border border-slate-200 bg-slate-50 p-4 md:grid-cols-[1fr_1fr_auto]"
                >
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      Raw Material
                    </label>
                    <select
                      required
                      value={line.material_id}
                      onChange={(event) =>
                        updateMaterialLine(index, "material_id", event.target.value)
                      }
                      className={inputClassName}
                    >
                      <option value="">Select material</option>
                      {materials.map((material) => (
                        <option key={material.id} value={material.id}>
                          {material.material_code} — {material.material_name} (
                          {formatInventoryQuantity(material.current_stock)}{" "}
                          {material.unit_of_measure} @{" "}
                          {formatInventoryMoney(material.average_cost_per_unit)})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      Quantity Used
                    </label>
                    <input
                      type="number"
                      min={0.0001}
                      step="0.0001"
                      required
                      value={line.quantity_used}
                      onChange={(event) =>
                        updateMaterialLine(
                          index,
                          "quantity_used",
                          event.target.value,
                        )
                      }
                      className={inputClassName}
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() => removeMaterialLine(index)}
                      disabled={materialLines.length === 1}
                      className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {preview ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                <p>
                  Total batch cost:{" "}
                  <span className="font-medium">
                    {formatInventoryMoney(preview.total_batch_cost)}
                  </span>
                </p>
                <p className="mt-1">
                  Cost per unit produced:{" "}
                  <span className="font-medium">
                    {formatInventoryMoney(preview.cost_per_unit_produced)}
                  </span>
                </p>
              </div>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Saving…" : "Save Production Batch"}
            </button>
          </form>
        </section>
      ) : null}

      <FilteredListCount
        filteredCount={batches.length}
        totalCount={batches.length}
        itemSingular="batch"
      />

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Batch</th>
              <th className={scrollableTableThClassName}>Date</th>
              <th className={scrollableTableThClassName}>Product</th>
              <th className={scrollableTableThClassName}>Qty Produced</th>
              <th className={scrollableTableThClassName}>Total Cost</th>
              <th className={scrollableTableThClassName}>Cost / Unit</th>
              <th className={scrollableTableThClassName}>Materials</th>
              {!readOnly ? (
                <th className={scrollableTableThClassName}>Actions</th>
              ) : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {batches.length === 0 ? (
              <tr>
                <td
                  colSpan={readOnly ? 7 : 8}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  No production batches yet.
                </td>
              </tr>
            ) : (
              batches.map((batch, index) => (
                <tr
                  key={batch.id}
                  className={index % 2 === 0 ? "bg-white" : "bg-slate-50"}
                >
                  <td className="px-4 py-3 font-medium text-[#0f2744]">
                    {batch.batch_number}
                  </td>
                  <td className="px-4 py-3">{batch.production_date}</td>
                  <td className="px-4 py-3">
                    {batch.product?.product_name ?? batch.finished_product_id}
                  </td>
                  <td className="px-4 py-3">
                    {formatInventoryQuantity(batch.quantity_produced)}{" "}
                    {batch.product?.unit_of_measure ?? ""}
                  </td>
                  <td className="px-4 py-3">
                    {formatInventoryMoney(batch.total_batch_cost)}
                  </td>
                  <td className="px-4 py-3">
                    {formatInventoryMoney(batch.cost_per_unit_produced)}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {(batch.materials ?? []).map((line) => (
                      <div key={line.id}>
                        {line.material?.material_name ?? line.material_id}:{" "}
                        {formatInventoryQuantity(line.quantity_used)} @{" "}
                        {formatInventoryMoney(line.cost_at_time)}
                      </div>
                    ))}
                  </td>
                  {!readOnly ? (
                    <td className="px-4 py-3">
                      {confirmingBatchId === batch.id ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="whitespace-normal text-sm text-red-700">
                            Delete this batch? This cannot be undone.
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleDeleteBatch(batch)}
                            disabled={deletingBatchId === batch.id}
                            className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {deletingBatchId === batch.id
                              ? "Deleting…"
                              : "Yes, delete"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmingBatchId(null)}
                            disabled={deletingBatchId === batch.id}
                            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setError(null);
                            setSuccess(null);
                            setConfirmingBatchId(batch.id);
                          }}
                          disabled={deletingBatchId === batch.id}
                          className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {deletingBatchId === batch.id
                            ? "Deleting…"
                            : "Delete"}
                        </button>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ScrollableTable>
    </div>
  );
}
