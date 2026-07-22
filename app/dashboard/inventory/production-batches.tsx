"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { inputClassName } from "../employees/employee-record-utils";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
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
  FINISHED_PRODUCT_SELECT,
  normalizeFinishedProduct,
  type FinishedProductRecord,
} from "./finished-products-utils";

type ProductionBatchesProps = {
  initialBatches: ProductionBatchRecord[];
  initialProducts: FinishedProductRecord[];
  initialMaterials: RawMaterialRecord[];
  fetchError: string | null;
  readOnly?: boolean;
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
}: ProductionBatchesProps) {
  const supabase = createClient();
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

    const lines = materialLines
      .filter((line) => line.material_id && line.quantity_used)
      .map((line) => {
        const material = materials.find((item) => item.id === line.material_id);
        const quantityUsed = Number.parseFloat(line.quantity_used);
        return {
          material_id: line.material_id,
          quantity_used: quantityUsed,
          cost_at_time: material?.average_cost_per_unit ?? 0,
        };
      })
      .filter(
        (line) =>
          !Number.isNaN(line.quantity_used) && line.quantity_used > 0,
      );

    if (lines.length === 0) {
      return null;
    }

    return calculateBatchPreview(lines, quantityProduced);
  }, [batchForm.quantity_produced, materialLines, materials]);

  async function refreshData() {
    const [
      { data: batchRows, error: batchError },
      { data: productRows, error: productError },
      { data: materialRows, error: materialError },
    ] = await Promise.all([
      supabase
        .from("production_batches")
        .select(PRODUCTION_BATCH_DETAIL_SELECT)
        .order("production_date", { ascending: false }),
      supabase
        .from("finished_products")
        .select(FINISHED_PRODUCT_SELECT)
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

    setBatches(
      (((batchRows as unknown) as ProductionBatchRecord[] | null) ?? []).map(
        (row) => normalizeProductionBatch(row),
      ),
    );
    setProducts(
      ((productRows as FinishedProductRecord[] | null) ?? []).map((row) =>
        normalizeFinishedProduct(row),
      ),
    );
    setMaterials(
      ((materialRows as RawMaterialRecord[] | null) ?? []).map((row) =>
        normalizeRawMaterial(row),
      ),
    );
    setError(null);
  }

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

    const materialPayload = materialLines
      .filter((line) => line.material_id && line.quantity_used)
      .map((line) => {
        const material = materials.find((item) => item.id === line.material_id);
        const quantityUsed = Number.parseFloat(line.quantity_used);
        return {
          material_id: line.material_id,
          quantity_used: quantityUsed,
          cost_at_time: material?.average_cost_per_unit ?? 0,
        };
      });

    if (materialPayload.length === 0) {
      setError("Add at least one raw material with quantity used.");
      setLoading(false);
      return;
    }

    for (const line of materialPayload) {
      if (Number.isNaN(line.quantity_used) || line.quantity_used <= 0) {
        setError("Each material line must have a quantity greater than zero.");
        setLoading(false);
        return;
      }

      const material = materials.find((item) => item.id === line.material_id);
      if (material && material.current_stock < line.quantity_used) {
        setError(
          `Insufficient stock for ${material.material_name}. Available: ${formatInventoryQuantity(material.current_stock)}.`,
        );
        setLoading(false);
        return;
      }
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

  return (
    <div className="space-y-6">
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-slate-600">
          Record production batches. Raw material stock decreases, finished
          product stock increases, and a stock movement ledger entry is created.
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
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {batches.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
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
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ScrollableTable>
    </div>
  );
}
