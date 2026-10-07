"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { inputClassName } from "../employees/employee-record-utils";
import {
  confirmProductionBatchDelete,
  registerTableActionsInnerClassName,
} from "../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableActionsTdClassName,
  scrollableTableActionsThClassName,
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import FilteredListCount from "../filtered-list-count";
import { useStampBusinessUnitId, useBusinessUnitReadScope } from "@/app/dashboard/business-unit-view-context";
import { applyBusinessUnitScope } from "@/utils/business-unit-view";
import {
  assertCanModifyBusinessUnitRow,
  formatBusinessUnitAccessError,
  loadWriteBusinessUnitContext,
  resolveWriteBusinessUnitIdForCreate,
} from "@/utils/business-unit-access";
import {
  formatInventoryMoney,
  formatInventoryMoneyDisplay2dp,
  formatInventoryQuantity,
  nullableText,
} from "./inventory-utils";
import { formatProductionBatchEditBlockReason } from "@/lib/inventory/production-batch-edit-message";
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
  scopedFinishedProductsQuery,
} from "./finished-product-bu-stock-utils";
import BatchLabelPrint from "./batch-label-print";
import {
  BarcodeManualEntry,
  BarcodeScanStatus,
} from "@/components/barcode-scan-field";
import { useBarcodeScannerWedge } from "@/hooks/use-barcode-scanner-wedge";
import {
  findMaterialByScanCode,
  findProductByScanCode,
} from "@/utils/barcode-scan-utils";
import { alertDialog } from "@/components/feedback/app-dialogs";
import Tooltip from "@/components/ui/tooltip";
import {
  validateProductionBatchMaterialLines,
  type ProductionBatchMaterialLineErrors,
} from "@/lib/inventory/production-batch-form-validation";
import { mapProductionBatchSaveErrorMessage } from "@/lib/inventory/production-batch-save-error";

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
  const router = useRouter();
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
  const [editingBatchId, setEditingBatchId] = useState<string | null>(null);
  const [editEligibility, setEditEligibility] = useState<
    Record<
      string,
      {
        can_edit: boolean;
        block_reason: string | null;
        consumed_quantity: number | null;
        sale_count: number | null;
      }
    >
  >({});
  const [batchForm, setBatchForm] = useState(emptyBatchForm);
  const [materialLines, setMaterialLines] = useState<MaterialLine[]>([
    { ...emptyMaterialLine },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);
  const [success, setSuccess] = useState<string | null>(null);
  const [deletingBatchId, setDeletingBatchId] = useState<string | null>(null);
  const [labelPrintBatch, setLabelPrintBatch] =
    useState<ProductionBatchRecord | null>(null);
  const [productScanError, setProductScanError] = useState<string | null>(null);
  const [productScanSuccess, setProductScanSuccess] = useState<string | null>(
    null,
  );
  const [materialScanError, setMaterialScanError] = useState<string | null>(
    null,
  );
  const [materialScanSuccess, setMaterialScanSuccess] = useState<string | null>(
    null,
  );
  const [materialLineErrors, setMaterialLineErrors] = useState<
    Record<number, ProductionBatchMaterialLineErrors>
  >({});
  const [materialFormError, setMaterialFormError] = useState<string | null>(
    null,
  );
  const [activeMaterialLineIndex, setActiveMaterialLineIndex] = useState(0);
  const scanTargetRef = useRef<"product" | "material">("product");
  const activeMaterialLineIndexRef = useRef(0);
  const materialSelectRefs = useRef<(HTMLSelectElement | null)[]>([]);

  useEffect(() => {
    activeMaterialLineIndexRef.current = activeMaterialLineIndex;
  }, [activeMaterialLineIndex]);

  useEffect(() => {
    if (readOnly) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(
          "/api/inventory/production-batches/edit-eligibility",
        );
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as {
          eligibility?: typeof editEligibility;
        };
        if (!cancelled && payload.eligibility) {
          setEditEligibility(payload.eligibility);
        }
      } catch {
        /* eligibility is optional for display */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [readOnly, initialBatches.length]);

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
          .select(PRODUCTION_BATCH_DETAIL_SELECT)
          .eq("tenant_id", tenantId),
        buReadScope,
      ).order("production_date", { ascending: false }),
      scopedFinishedProductsQuery(supabase, buReadScope, FINISHED_PRODUCT_SELECT)
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
        buReadScope.mode,
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

  const refreshLiveInventoryData = useCallback(async () => {
    await refreshData();
    router.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshData closes over live scope
  }, [router]);

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
    setEditingBatchId(null);
    setBatchForm({ ...emptyBatchForm });
    setMaterialLines([{ ...emptyMaterialLine }]);
    setMaterialLineErrors({});
    setMaterialFormError(null);
    setShowForm(true);
  }

  function openEditForm(batch: ProductionBatchRecord) {
    setEditingBatchId(batch.id);
    setBatchForm({
      batch_number: batch.batch_number,
      production_date: batch.production_date.slice(0, 10),
      finished_product_id: batch.finished_product_id,
      quantity_produced: String(batch.quantity_produced),
      manufacturing_date: batch.manufacturing_date ?? "",
      expiration_date: batch.expiration_date ?? "",
      notes: batch.notes ?? "",
    });
    setMaterialLines(
      (batch.materials ?? []).length > 0
        ? (batch.materials ?? []).map((line) => ({
            material_id: line.material_id,
            quantity_used: String(line.quantity_used),
          }))
        : [{ ...emptyMaterialLine }],
    );
    setMaterialLineErrors({});
    setMaterialFormError(null);
    setShowForm(true);
  }

  function closeForm() {
    setEditingBatchId(null);
    setBatchForm(emptyBatchForm);
    setMaterialLines([{ ...emptyMaterialLine }]);
    setMaterialLineErrors({});
    setMaterialFormError(null);
    setShowForm(false);
  }

  function updateMaterialLine(
    index: number,
    field: keyof MaterialLine,
    value: string,
  ) {
    setMaterialLineErrors((current) => {
      if (!current[index]) {
        return current;
      }
      const next = { ...current };
      delete next[index];
      return next;
    });
    setMaterialFormError(null);
    setMaterialLines((current) =>
      current.map((line, lineIndex) =>
        lineIndex === index ? { ...line, [field]: value } : line,
      ),
    );
  }

  function materialUsedOnOtherLine(materialId: string, lineIndex: number): boolean {
    if (!materialId) {
      return false;
    }
    return materialLines.some(
      (line, index) => index !== lineIndex && line.material_id === materialId,
    );
  }

  function addMaterialLine() {
    setMaterialLines((current) => {
      const nextIndex = current.length;
      const next = [...current, { ...emptyMaterialLine }];
      window.setTimeout(() => {
        materialSelectRefs.current[nextIndex]?.focus();
        setActiveMaterialLineIndex(nextIndex);
        scanTargetRef.current = "material";
      }, 0);
      return next;
    });
  }

  function removeMaterialLine(index: number) {
    setMaterialLines((current) =>
      current.length === 1
        ? current
        : current.filter((_, lineIndex) => lineIndex !== index),
    );
  }

  function handleProductBarcodeScan(rawPayload: string) {
    const product = findProductByScanCode(products, rawPayload);
    if (!product) {
      setProductScanSuccess(null);
      setProductScanError("Product not found for scanned code.");
      return;
    }

    setProductScanError(null);
    setMaterialScanError(null);
    setProductScanSuccess(
      `Selected ${product.product_code} — ${product.product_name}`,
    );
    setBatchForm((current) => ({
      ...current,
      finished_product_id: product.id,
    }));
  }

  function handleMaterialBarcodeScan(rawPayload: string) {
    const material = findMaterialByScanCode(materials, rawPayload);
    if (!material) {
      setMaterialScanSuccess(null);
      setMaterialScanError("Material not found.");
      return;
    }

    const lineIndex = activeMaterialLineIndexRef.current;
    if (materialUsedOnOtherLine(material.id, lineIndex)) {
      setMaterialScanSuccess(null);
      setMaterialScanError(
        `${material.material_name} is already on another line. Combine the quantities into one line.`,
      );
      return;
    }

    setMaterialScanError(null);
    setProductScanError(null);
    setMaterialScanSuccess(
      `Line ${lineIndex + 1}: ${material.material_code} — ${material.material_name}`,
    );
    updateMaterialLine(lineIndex, "material_id", material.id);
  }

  const batchScanEnabled = showForm && !readOnly;
  const batchScanPaused = Boolean(labelPrintBatch);

  useBarcodeScannerWedge({
    enabled: batchScanEnabled,
    paused: batchScanPaused,
    onScan: (rawPayload) => {
      if (scanTargetRef.current === "product") {
        handleProductBarcodeScan(rawPayload);
        return;
      }
      handleMaterialBarcodeScan(rawPayload);
    },
  });

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMaterialFormError(null);

    const buContext = await loadWriteBusinessUnitContext(supabase);
    if (!buContext.ok) {
      setMaterialFormError(buContext.error);
      setLoading(false);
      return;
    }

    const stampResult = resolveWriteBusinessUnitIdForCreate({
      allowedUnits: buContext.allowedUnits,
      stamp: stampBusinessUnit,
    });
    if (!stampResult.ok) {
      setMaterialFormError(stampResult.error);
      setLoading(false);
      return;
    }

    const quantityProduced = Number.parseFloat(batchForm.quantity_produced);
    if (Number.isNaN(quantityProduced) || quantityProduced <= 0) {
      setLoading(false);
      void alertDialog({
        title: "Quantity required",
        message: "Enter a quantity produced greater than zero.",
      });
      return;
    }

    if (!batchForm.finished_product_id) {
      setLoading(false);
      void alertDialog({
        title: "Finished product required",
        message: "Select a finished product before saving.",
      });
      return;
    }

    const materialValidation = validateProductionBatchMaterialLines({
      lines: materialLines,
      materials,
      resolveCost: (material) => material.average_cost_per_unit,
    });

    if (!materialValidation.ok) {
      setMaterialLineErrors(materialValidation.lineErrors);
      setMaterialFormError(materialValidation.formError ?? null);
      setLoading(false);
      return;
    }

    const materialPayload = materialValidation.payload;

    if (editingBatchId) {
      const editingBatch = batches.find((row) => row.id === editingBatchId);
      if (editingBatch) {
        try {
          assertCanModifyBusinessUnitRow(
            buContext.allowedUnits,
            editingBatch.business_unit_id,
          );
        } catch (accessError) {
          setMaterialFormError(formatBusinessUnitAccessError(accessError));
          setLoading(false);
          return;
        }
      }

      const response = await fetch(
        `/api/inventory/production-batches/${editingBatchId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            production_date: batchForm.production_date,
            finished_product_id: batchForm.finished_product_id,
            quantity_produced: quantityProduced,
            notes: nullableText(batchForm.notes),
            materials: materialPayload,
            manufacturing_date: nullableText(batchForm.manufacturing_date),
            expiration_date: nullableText(batchForm.expiration_date),
          }),
        },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setLoading(false);
        void alertDialog({
          title: "Couldn't save batch",
          message:
            payload.error ??
            "Couldn't save the production batch. Please try again.",
        });
        return;
      }

      closeForm();
      await refreshLiveInventoryData();
      const eligibilityResponse = await fetch(
        "/api/inventory/production-batches/edit-eligibility",
      );
      if (eligibilityResponse.ok) {
        const eligibilityPayload = (await eligibilityResponse.json()) as {
          eligibility?: typeof editEligibility;
        };
        if (eligibilityPayload.eligibility) {
          setEditEligibility(eligibilityPayload.eligibility);
        }
      }
      setLoading(false);
      return;
    }

    const allocated = await allocateBatchNumber(supabase);
    if (allocated.error || !allocated.batchNumber) {
      setMaterialFormError(allocated.error ?? "Unable to allocate batch number.");
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
      p_business_unit_id: stampResult.businessUnitId,
    });

    if (rpcError) {
      console.error("create_production_batch failed", rpcError);
      setLoading(false);
      void alertDialog({
        title: "Couldn't save batch",
        message: mapProductionBatchSaveErrorMessage(rpcError),
      });
      return;
    }

    closeForm();
    await refreshLiveInventoryData();
    setLoading(false);
  }

  async function handleDeleteBatch(batch: ProductionBatchRecord) {
    setDeletingBatchId(batch.id);
    setError(null);
    setSuccess(null);

    const buContext = await loadWriteBusinessUnitContext(supabase);
    if (!buContext.ok) {
      setError(buContext.error);
      setDeletingBatchId(null);
      return;
    }

    try {
      assertCanModifyBusinessUnitRow(
        buContext.allowedUnits,
        batch.business_unit_id,
      );
    } catch (accessError) {
      setError(formatBusinessUnitAccessError(accessError));
      setDeletingBatchId(null);
      return;
    }

    const { error: rpcError } = await supabase.rpc("delete_production_batch", {
      p_batch_id: batch.id,
    });

    if (rpcError) {
      console.error("delete_production_batch failed", rpcError);
      setDeletingBatchId(null);
      void alertDialog({
        title: "Couldn't delete batch",
        message: mapProductionBatchSaveErrorMessage(rpcError),
      });
      return;
    }

    setBatches((current) => current.filter((row) => row.id !== batch.id));
    setSuccess(`Batch ${batch.batch_number} deleted.`);
    await refreshLiveInventoryData();
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
            {editingBatchId ? "Edit Production Batch" : "New Production Batch"}
          </h3>
          {materialFormError ? (
            <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {materialFormError}
            </p>
          ) : null}
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
              <div className="md:col-span-2">
                <BarcodeScanStatus
                  label="Scan finished product"
                  hint="Focus the finished product field below, then scan."
                  errorMessage={productScanError}
                  successMessage={productScanSuccess}
                />
                <BarcodeManualEntry
                  enabled={batchScanEnabled}
                  paused={batchScanPaused}
                  onScan={(_parsed, rawPayload) => {
                    handleProductBarcodeScan(rawPayload);
                  }}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Finished Product
                </label>
                <select
                  required
                  value={batchForm.finished_product_id}
                  onFocus={() => {
                    scanTargetRef.current = "product";
                  }}
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
              <BarcodeScanStatus
                label="Scan raw material"
                hint="Focus a material line below, then scan to fill that line."
                errorMessage={materialScanError}
                successMessage={materialScanSuccess}
              />
              <BarcodeManualEntry
                enabled={batchScanEnabled}
                paused={batchScanPaused}
                onScan={(_parsed, rawPayload) => {
                  handleMaterialBarcodeScan(rawPayload);
                }}
              />
              <h4 className="text-sm font-semibold text-[#0f2744]">
                Materials Consumed
              </h4>

              {materialFormError ? (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {materialFormError}
                </p>
              ) : null}

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
                      ref={(element) => {
                        materialSelectRefs.current[index] = element;
                      }}
                      value={line.material_id}
                      onFocus={() => {
                        scanTargetRef.current = "material";
                        setActiveMaterialLineIndex(index);
                      }}
                      onChange={(event) =>
                        updateMaterialLine(index, "material_id", event.target.value)
                      }
                      className={inputClassName}
                    >
                      <option value="">Select raw material</option>
                      {materials.map((material) => {
                        const usedElsewhere = materialUsedOnOtherLine(
                          material.id,
                          index,
                        );
                        return (
                          <option
                            key={material.id}
                            value={material.id}
                            disabled={usedElsewhere}
                          >
                            {usedElsewhere
                              ? `${material.material_code} — ${material.material_name} (already added)`
                              : `${material.material_code} — ${material.material_name} (${formatInventoryQuantity(material.current_stock)} ${material.unit_of_measure} @ ${formatInventoryMoney(material.average_cost_per_unit)})`}
                          </option>
                        );
                      })}
                    </select>
                    {materialLineErrors[index]?.material ? (
                      <p className="mt-1 text-sm text-red-700">
                        {materialLineErrors[index]?.material}
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      Quantity Used
                    </label>
                    <input
                      type="number"
                      min={0.0001}
                      step="0.0001"
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
                    {materialLineErrors[index]?.quantity ? (
                      <p className="mt-1 text-sm text-red-700">
                        {materialLineErrors[index]?.quantity}
                      </p>
                    ) : null}
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
                    {formatInventoryMoneyDisplay2dp(preview.total_batch_cost)}
                  </span>
                </p>
                <p className="mt-1">
                  Cost per unit produced:{" "}
                  <span className="font-medium">
                    {formatInventoryMoneyDisplay2dp(
                      preview.cost_per_unit_produced,
                    )}
                  </span>
                </p>
              </div>
            ) : null}

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={addMaterialLine}
                className="inline-flex w-full items-center justify-center gap-1 rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 sm:w-auto"
              >
                <span aria-hidden>+</span> Add Material Line
              </button>
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                {loading
                  ? "Saving…"
                  : editingBatchId
                    ? "Save Production Batch"
                    : "Save Production Batch"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {labelPrintBatch ? (
        <BatchLabelPrint
          batch={labelPrintBatch}
          onClose={() => setLabelPrintBatch(null)}
        />
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
              <th className={scrollableTableActionsThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {batches.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
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
                    {formatInventoryMoneyDisplay2dp(batch.total_batch_cost)}
                  </td>
                  <td className="px-4 py-3">
                    {formatInventoryMoneyDisplay2dp(batch.cost_per_unit_produced)}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {(batch.materials ?? []).map((line) => (
                      <div key={line.id}>
                        {line.material?.material_name ?? line.material_id}:{" "}
                        {formatInventoryQuantity(line.quantity_used)} @{" "}
                        {formatInventoryMoneyDisplay2dp(line.cost_at_time)}
                      </div>
                    ))}
                  </td>
                  <td className={scrollableTableActionsTdClassName}>
                    <div className={registerTableActionsInnerClassName}>
                      <button
                        type="button"
                        onClick={() => {
                          setError(null);
                          setSuccess(null);
                          setLabelPrintBatch(batch);
                        }}
                        className="rounded-md border border-[#0f2744] px-3 py-1.5 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50"
                      >
                        Print Batch Label
                      </button>
                      {!readOnly ? (
                        (() => {
                          const preview = editEligibility[batch.id];
                          const canEdit = preview?.can_edit ?? true;
                          const editBlockReason = formatProductionBatchEditBlockReason(
                            {
                              can_edit: canEdit,
                              block_reason: preview?.block_reason ?? null,
                              consumed_quantity: preview?.consumed_quantity ?? null,
                              sale_count: preview?.sale_count ?? null,
                              unit_of_measure:
                                batch.product?.unit_of_measure ?? null,
                            },
                          );
                          const editButton = (
                            <button
                              type="button"
                              aria-disabled={!canEdit}
                              onClick={() => {
                                setError(null);
                                setSuccess(null);
                                if (!canEdit) {
                                  void alertDialog({
                                    title: "Can't edit batch",
                                    message: editBlockReason,
                                  });
                                  return;
                                }
                                openEditForm(batch);
                              }}
                              className={`rounded-md border border-[#0f2744] px-3 py-1.5 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 ${
                                !canEdit
                                  ? "cursor-not-allowed opacity-50"
                                  : ""
                              }`}
                            >
                              Edit
                            </button>
                          );
                          return !canEdit ? (
                            <Tooltip content={editBlockReason} variant="blocked">
                              {editButton}
                            </Tooltip>
                          ) : (
                            editButton
                          );
                        })()
                      ) : null}
                      {!readOnly ? (
                        <button
                          type="button"
                          onClick={() => {
                            void (async () => {
                              setError(null);
                              setSuccess(null);
                              if (
                                !(await confirmProductionBatchDelete(
                                  batch.batch_number,
                                ))
                              ) {
                                return;
                              }
                              await handleDeleteBatch(batch);
                            })();
                          }}
                          disabled={deletingBatchId === batch.id}
                          className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {deletingBatchId === batch.id
                            ? "Deleting…"
                            : "Delete"}
                        </button>
                      ) : null}
                    </div>
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
