"use client";

import { useEffect, useRef, useState } from "react";
import ImageFileUploadButton from "@/components/image-file-upload-button";
import FinishedProductPhoto from "@/components/finished-product-photo";
import { createClient } from "@/utils/supabase/client";
import { inputClassName } from "../employees/employee-record-utils";
import RegisterRowActions, {
  confirmArchiveEntry,
  confirmReactivateEntry,
  getStripedRowClassName,
} from "../finance/register-row-actions";
import {
  buildFinishedProductDeleteMessage,
  confirmCascadeDelete,
  finishedProductHasBlockingPurchaseHistory,
  normalizeFinishedProductDeletePreview,
} from "./inventory-delete-utils";
import FilteredListCount from "../filtered-list-count";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import {
  formatInventoryMoney,
  formatInventoryQuantity,
} from "./inventory-utils";
import { allocateProductCode } from "./inventory-ids-api";
import {
  buildFinishedProductSavePayload,
  DEFAULT_FINISHED_PRODUCT_SOURCING_TYPE,
  fetchFinishedProductLotDateSources,
  fetchFinishedProductPurchaseCounts,
  FINISHED_PRODUCT_ADJUSTMENT_TYPE_LABELS,
  FINISHED_PRODUCT_ADJUSTMENT_TYPES,
  FINISHED_PRODUCT_SELECT,
  FINISHED_PRODUCT_SOURCING_OPTIONS,
  FINISHED_PRODUCT_STOCK_ADJUSTMENT_SELECT,
  finishedProductToForm,
  formatFinishedProductAdjustmentType,
  getFinishedProductExpirationStatus,
  mergeFinishedProductsWithLotDates,
  normalizeFinishedProduct,
  normalizeFinishedProductStockAdjustment,
  type FinishedProductAdjustmentType,
  type FinishedProductRecord,
  type FinishedProductSourcingType,
  type FinishedProductStockAdjustmentRecord,
} from "./finished-products-utils";
import type { SupplierRow } from "@/utils/suppliers-types";
import { getFinishedProductDeleteErrorMessage, FINISHED_PRODUCT_DELETE_BLOCKED_MESSAGE } from "@/utils/finished-product-delete-errors";
import {
  useBusinessUnitReadScope,
  useBusinessUnitView,
  useStampBusinessUnitId,
} from "@/app/dashboard/business-unit-view-context";
import { applyBusinessUnitScope } from "@/utils/business-unit-view";
import {
  fetchScopedFinishedProductStock,
  mergeScopedStockOntoProducts,
} from "./finished-product-bu-stock-utils";

type FinishedProductsProps = {
  initialProducts: FinishedProductRecord[];
  initialCatalogProducts: FinishedProductRecord[];
  initialAdjustments: FinishedProductStockAdjustmentRecord[];
  initialSuppliers: SupplierRow[];
  fetchError: string | null;
  readOnly?: boolean;
  tenantId?: string | null;
};

const emptyForm = {
  product_code: "",
  product_name: "",
  unit_of_measure: "",
  standard_selling_price: "",
  sourcing_type: DEFAULT_FINISHED_PRODUCT_SOURCING_TYPE,
  supplier_id: "",
};

const emptyAdjustmentForm = {
  product_id: "",
  adjustment_type: "" as "" | FinishedProductAdjustmentType,
  quantity: "",
  correction_direction: "increase" as "increase" | "decrease",
  cost_per_unit: "",
  reason: "",
  notes: "",
};

function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export default function FinishedProducts({
  initialProducts,
  initialCatalogProducts,
  initialAdjustments,
  initialSuppliers,
  fetchError,
  readOnly = false,
  tenantId = null,
}: FinishedProductsProps) {
  const supabase = createClient();
  const stampBusinessUnit = useStampBusinessUnitId();
  const buReadScope = useBusinessUnitReadScope();
  const { viewAllBusinessUnits } = useBusinessUnitView();
  const [products, setProducts] = useState(
    initialProducts.map(normalizeFinishedProduct),
  );
  const [catalogProducts, setCatalogProducts] = useState(
    initialCatalogProducts.map(normalizeFinishedProduct),
  );
  const [adjustments, setAdjustments] = useState(
    initialAdjustments.map(normalizeFinishedProductStockAdjustment),
  );
  const [showForm, setShowForm] = useState(false);
  const [showAdjustmentForm, setShowAdjustmentForm] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [deletingProductId, setDeletingProductId] = useState<string | null>(null);
  const [archivingProductId, setArchivingProductId] = useState<string | null>(null);
  const [reactivatingProductId, setReactivatingProductId] = useState<string | null>(null);
  const [purchaseCountByProductId, setPurchaseCountByProductId] = useState<
    Record<string, number>
  >({});
  const [form, setForm] = useState(emptyForm);
  const [adjustmentForm, setAdjustmentForm] = useState(emptyAdjustmentForm);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [pendingPhotoFile, setPendingPhotoFile] = useState<File | null>(null);
  const [pendingPhotoPreviewUrl, setPendingPhotoPreviewUrl] = useState<string | null>(
    null,
  );
  const [photoUploading, setPhotoUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [photoWarning, setPhotoWarning] = useState<string | null>(null);
  const skipFirstStockScopeRefresh = useRef(true);

  useEffect(() => {
    return () => {
      if (pendingPhotoPreviewUrl) {
        URL.revokeObjectURL(pendingPhotoPreviewUrl);
      }
    };
  }, [pendingPhotoPreviewUrl]);

  useEffect(() => {
    setProducts(initialProducts.map(normalizeFinishedProduct));
    setCatalogProducts(initialCatalogProducts.map(normalizeFinishedProduct));
    setAdjustments(
      initialAdjustments.map(normalizeFinishedProductStockAdjustment),
    );
  }, [initialProducts, initialCatalogProducts, initialAdjustments]);

  useEffect(() => {
    void fetchFinishedProductPurchaseCounts(supabase, buReadScope).then(
      (result) => {
        if (result.error) {
          setError(result.error);
          return;
        }
        setPurchaseCountByProductId(
          Object.fromEntries(result.countsByProductId.entries()),
        );
      },
    );
  }, [supabase, buReadScope]);

  async function refreshData() {
    if (!tenantId) {
      setError("Unable to resolve your workspace.");
      return;
    }

    const [
      { data, error: refreshError },
      { data: adjustmentRows, error: adjustmentError },
      lotDatesResult,
      purchaseCountsResult,
      { stockMap, error: stockScopeError },
    ] = await Promise.all([
      supabase
        .from("finished_products")
        .select(FINISHED_PRODUCT_SELECT)
        .order("product_name", { ascending: true }),
      applyBusinessUnitScope(
        supabase
          .from("finished_product_stock_adjustments")
          .select(FINISHED_PRODUCT_STOCK_ADJUSTMENT_SELECT)
          .eq("tenant_id", tenantId),
        buReadScope,
      ).order("created_at", { ascending: false }),
      fetchFinishedProductLotDateSources(supabase, buReadScope),
      fetchFinishedProductPurchaseCounts(supabase, buReadScope),
      fetchScopedFinishedProductStock(supabase, tenantId, buReadScope),
    ]);

    if (refreshError) {
      setError(refreshError.message);
      return;
    }
    if (adjustmentError) {
      setError(adjustmentError.message);
      return;
    }
    if (lotDatesResult.error) {
      setError(lotDatesResult.error);
      return;
    }
    if (purchaseCountsResult.error) {
      setError(purchaseCountsResult.error);
      return;
    }
    if (stockScopeError) {
      setError(stockScopeError);
      return;
    }

    const catalog = mergeFinishedProductsWithLotDates(
      ((data as FinishedProductRecord[] | null) ?? []).map((row) =>
        normalizeFinishedProduct(row),
      ),
      lotDatesResult.lots,
    );
    setCatalogProducts(catalog);
    setProducts(
      mergeScopedStockOntoProducts(catalog, stockMap, buReadScope.mode),
    );
    setAdjustments(
      (
        ((adjustmentRows as unknown) as FinishedProductStockAdjustmentRecord[] | null) ??
        []
      ).map((row) => normalizeFinishedProductStockAdjustment(row)),
    );
    setPurchaseCountByProductId(
      Object.fromEntries(purchaseCountsResult.countsByProductId.entries()),
    );
    setError(null);
  }

  useEffect(() => {
    if (skipFirstStockScopeRefresh.current) {
      skipFirstStockScopeRefresh.current = false;
      return;
    }
    void refreshData();
    // Re-scope stock list when the BU switcher changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional scope key
  }, [buReadScope.mode, buReadScope.mode === "unit" ? buReadScope.id : null]);

  function clearPendingPhoto() {
    if (pendingPhotoPreviewUrl) {
      URL.revokeObjectURL(pendingPhotoPreviewUrl);
    }
    setPendingPhotoFile(null);
    setPendingPhotoPreviewUrl(null);
  }

  function setPendingPhoto(file: File | null) {
    if (pendingPhotoPreviewUrl) {
      URL.revokeObjectURL(pendingPhotoPreviewUrl);
    }
    if (!file) {
      setPendingPhotoFile(null);
      setPendingPhotoPreviewUrl(null);
      return;
    }
    setPendingPhotoFile(file);
    setPendingPhotoPreviewUrl(URL.createObjectURL(file));
  }

  function openAddForm() {
    setEditingProductId(null);
    setForm({ ...emptyForm });
    setPhotoUrl(null);
    clearPendingPhoto();
    setSuccessMessage(null);
    setPhotoWarning(null);
    setShowForm(true);
  }

  function openEditForm(product: FinishedProductRecord) {
    setEditingProductId(product.id);
    setForm(finishedProductToForm(product));
    setPhotoUrl(product.photo_url);
    clearPendingPhoto();
    setSuccessMessage(null);
    setPhotoWarning(null);
    setShowForm(true);
  }

  function closeForm() {
    setEditingProductId(null);
    setForm(emptyForm);
    setPhotoUrl(null);
    clearPendingPhoto();
    setShowForm(false);
  }

  async function uploadProductPhoto(
    productId: string,
    file: File,
  ): Promise<{ ok: true; photo_url: string } | { ok: false; error: string }> {
    const formData = new FormData();
    formData.append("product_id", productId);
    formData.append("file", file);

    const response = await fetch("/api/inventory/finished-products/upload-photo", {
      method: "POST",
      body: formData,
    });
    const payload = (await response.json()) as {
      error?: string;
      photo_url?: string;
    };

    if (!response.ok) {
      return {
        ok: false,
        error: payload.error ?? "Photo upload failed.",
      };
    }

    return {
      ok: true,
      photo_url: payload.photo_url ?? "",
    };
  }

  async function handlePhotoUpload(file: File) {
    if (!editingProductId) {
      return;
    }

    setPhotoUploading(true);
    setError(null);

    try {
      const result = await uploadProductPhoto(editingProductId, file);
      if (!result.ok) {
        throw new Error(result.error);
      }

      setPhotoUrl(result.photo_url || null);
      await refreshData();
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : "Photo upload failed.",
      );
    } finally {
      setPhotoUploading(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccessMessage(null);
    setPhotoWarning(null);

    if (editingProductId) {
      const payload = buildFinishedProductSavePayload(form);
      const { error: saveError } = await supabase
        .from("finished_products")
        .update({
          product_name: payload.product_name,
          unit_of_measure: payload.unit_of_measure,
          standard_selling_price: payload.standard_selling_price,
          sourcing_type: payload.sourcing_type,
          supplier_id: payload.supplier_id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", editingProductId);

      if (saveError) {
        setError(saveError.message);
        setLoading(false);
        return;
      }
    } else {
      const allocated = await allocateProductCode(supabase);
      if (allocated.error || !allocated.productCode) {
        setError(allocated.error ?? "Unable to allocate product code.");
        setLoading(false);
        return;
      }

      const payload = buildFinishedProductSavePayload({
        ...form,
        product_code: allocated.productCode,
      });

      const { data: inserted, error: saveError } = await supabase
        .from("finished_products")
        .insert(payload)
        .select("id")
        .single();

      if (saveError) {
        setError(saveError.message);
        setLoading(false);
        return;
      }

      const newProductId = inserted?.id;
      const photoToUpload = pendingPhotoFile;

      closeForm();
      await refreshData();
      setLoading(false);
      setSuccessMessage("Product added successfully.");

      if (newProductId && photoToUpload) {
        try {
          const uploadResult = await uploadProductPhoto(newProductId, photoToUpload);
          if (!uploadResult.ok) {
            setPhotoWarning(
              `The product was saved, but the photo could not be uploaded (${uploadResult.error}). You can add a photo from Edit.`,
            );
          } else {
            await refreshData();
          }
        } catch (uploadError) {
          setPhotoWarning(
            `The product was saved, but the photo could not be uploaded (${
              uploadError instanceof Error ? uploadError.message : "upload failed"
            }). You can add a photo from Edit.`,
          );
        }
      }

      return;
    }

    closeForm();
    await refreshData();
    setLoading(false);
  }

  async function handleArchive(productId: string) {
    if (!confirmArchiveEntry("finished product")) {
      return;
    }

    setArchivingProductId(productId);
    setError(null);

    const { error: archiveError } = await supabase
      .from("finished_products")
      .update({
        is_archived: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", productId);

    if (archiveError) {
      setError(archiveError.message);
      setArchivingProductId(null);
      return;
    }

    if (editingProductId === productId) {
      closeForm();
    }

    await refreshData();
    setArchivingProductId(null);
  }

  async function handleReactivate(productId: string) {
    if (!confirmReactivateEntry("finished product")) {
      return;
    }

    setReactivatingProductId(productId);
    setError(null);

    const { error: reactivateError } = await supabase
      .from("finished_products")
      .update({
        is_archived: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", productId);

    if (reactivateError) {
      setError(reactivateError.message);
      setReactivatingProductId(null);
      return;
    }

    await refreshData();
    setReactivatingProductId(null);
  }

  async function handleDelete(productId: string) {
    setDeletingProductId(productId);
    setError(null);

    const purchaseCount = purchaseCountByProductId[productId] ?? 0;

    const { data: previewData, error: previewError } = await supabase.rpc(
      "preview_finished_product_delete",
      { p_product_id: productId },
    );

    if (previewError) {
      setError(previewError.message);
      setDeletingProductId(null);
      return;
    }

    const preview = normalizeFinishedProductDeletePreview(previewData, purchaseCount);

    if (finishedProductHasBlockingPurchaseHistory(preview)) {
      setError(FINISHED_PRODUCT_DELETE_BLOCKED_MESSAGE);
      setDeletingProductId(null);
      return;
    }

    if (!confirmCascadeDelete(buildFinishedProductDeleteMessage(preview))) {
      setDeletingProductId(null);
      return;
    }

    const { error: deleteError } = await supabase.rpc(
      "delete_finished_product_cascade",
      { p_product_id: productId },
    );

    if (deleteError) {
      setError(getFinishedProductDeleteErrorMessage(deleteError));
      setDeletingProductId(null);
      return;
    }

    if (editingProductId === productId) {
      closeForm();
    }

    await refreshData();
    setDeletingProductId(null);
  }

  async function handleAdjustmentSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    if (viewAllBusinessUnits) {
      setError("Switch to a specific business to record a stock adjustment.");
      setLoading(false);
      return;
    }

    if (!stampBusinessUnit.ok) {
      setError(stampBusinessUnit.error);
      setLoading(false);
      return;
    }

    const adjustmentType = adjustmentForm.adjustment_type;
    if (!adjustmentType) {
      setError("Select an adjustment type.");
      setLoading(false);
      return;
    }

    if (!adjustmentForm.product_id) {
      setError("Select a finished product for this adjustment.");
      setLoading(false);
      return;
    }

    const quantityAbs = Number.parseFloat(adjustmentForm.quantity);
    if (Number.isNaN(quantityAbs) || quantityAbs <= 0) {
      setError("Quantity must be greater than zero.");
      setLoading(false);
      return;
    }

    let quantityDelta = quantityAbs;
    if (adjustmentType === "write_off") {
      quantityDelta = -quantityAbs;
    } else if (adjustmentType === "correction") {
      quantityDelta =
        adjustmentForm.correction_direction === "decrease"
          ? -quantityAbs
          : quantityAbs;
    }

    const needsCost =
      adjustmentType === "opening_balance" ||
      adjustmentType === "found_stock";
    let costPerUnit: number | undefined;
    if (needsCost) {
      costPerUnit = Number.parseFloat(adjustmentForm.cost_per_unit);
      if (Number.isNaN(costPerUnit) || costPerUnit < 0) {
        setError("Cost per unit must be zero or greater.");
        setLoading(false);
        return;
      }
    }

    if (!adjustmentForm.reason.trim()) {
      setError("Reason is required.");
      setLoading(false);
      return;
    }

    // Omit cost_per_unit for correction/write_off — RPC rejects non-null cost.
    const requestBody: Record<string, unknown> = {
      product_id: adjustmentForm.product_id,
      adjustment_type: adjustmentType,
      quantity_delta: quantityDelta,
      reason: adjustmentForm.reason.trim(),
      notes: nullableText(adjustmentForm.notes),
    };
    if (needsCost) {
      requestBody.cost_per_unit = costPerUnit;
    }

    const response = await fetch("/api/inventory/finished-product-adjustments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to record stock adjustment.");
      setLoading(false);
      return;
    }

    setAdjustmentForm(emptyAdjustmentForm);
    setShowAdjustmentForm(false);
    await refreshData();
    setLoading(false);
  }

  const adjustmentNeedsCost =
    adjustmentForm.adjustment_type === "opening_balance" ||
    adjustmentForm.adjustment_type === "found_stock";
  const adjustmentQuantityLabel =
    adjustmentForm.adjustment_type === "write_off"
      ? "Quantity to remove"
      : adjustmentForm.adjustment_type === "opening_balance" ||
          adjustmentForm.adjustment_type === "found_stock"
        ? "Quantity to add"
        : "Quantity";

  return (
    <div className="space-y-6">
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {successMessage ? (
        <p className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {successMessage}
        </p>
      ) : null}
      {photoWarning ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {photoWarning}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-slate-600">
          Finished product master data. Unit cost is derived per production batch,
          not stored here.
        </p>
        {!readOnly ? (
        <button
          type="button"
          onClick={() => (showForm ? closeForm() : openAddForm())}
          className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
        >
          {showForm ? "Cancel" : "Add Finished Product"}
        </button>
        ) : null}
      </div>

      {showForm && !readOnly ? (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
            {editingProductId ? "Edit Finished Product" : "New Finished Product"}
          </h3>
          <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2 flex flex-wrap items-center gap-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
              {editingProductId ? (
                <FinishedProductPhoto
                  photoUrl={photoUrl}
                  productName={form.product_name}
                  size="lg"
                />
              ) : pendingPhotoPreviewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={pendingPhotoPreviewUrl}
                  alt={`${form.product_name.trim() || "Product"} photo preview`}
                  className="h-16 w-16 shrink-0 rounded-md object-cover bg-slate-100 ring-1 ring-slate-200"
                />
              ) : (
                <FinishedProductPhoto
                  photoUrl={null}
                  productName={form.product_name}
                  size="lg"
                />
              )}
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-700">Product photo</p>
                {editingProductId ? (
                  <ImageFileUploadButton
                    files={[]}
                    onChange={(next) => {
                      const file = next[0];
                      if (file) {
                        void handlePhotoUpload(file);
                      }
                    }}
                    multiple={false}
                    disabled={photoUploading || !editingProductId}
                    accept="image/jpeg,image/png,image/webp"
                    addLabel={photoUploading ? "Uploading…" : "Add photo"}
                    showClear={false}
                    resetInputAfterSelect
                    emptyHint="JPEG, PNG, or WebP. Saved when you upload."
                  />
                ) : (
                  <ImageFileUploadButton
                    files={pendingPhotoFile ? [pendingPhotoFile] : []}
                    onChange={(next) => {
                      setPendingPhoto(next[0] ?? null);
                    }}
                    multiple={false}
                    disabled={loading}
                    accept="image/jpeg,image/png,image/webp"
                    addLabel="Choose photo"
                    changeLabel="Change photo"
                    emptyHint="JPEG, PNG, or WebP. Uploads when you save the product."
                  />
                )}
              </div>
            </div>
            {editingProductId ? (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Product Code
                </label>
                <input
                  type="text"
                  readOnly
                  value={form.product_code}
                  className={`${inputClassName} bg-slate-50 text-slate-600`}
                />
              </div>
            ) : null}
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Product Name
              </label>
              <input
                type="text"
                required
                value={form.product_name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    product_name: event.target.value,
                  }))
                }
                className={inputClassName}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Unit of Measure
              </label>
              <input
                type="text"
                required
                placeholder="e.g. litres, bottles"
                value={form.unit_of_measure}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    unit_of_measure: event.target.value,
                  }))
                }
                className={inputClassName}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Standard Selling Price
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.standard_selling_price}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    standard_selling_price: event.target.value,
                  }))
                }
                className={inputClassName}
              />
            </div>
            <div className="md:col-span-2">
              <fieldset>
                <legend className="mb-2 block text-sm font-medium text-slate-700">
                  Sourcing
                </legend>
                <div className="flex flex-wrap gap-4">
                  {FINISHED_PRODUCT_SOURCING_OPTIONS.map((option) => (
                    <label
                      key={option.value}
                      className="flex items-center gap-2 text-sm text-slate-700"
                    >
                      <input
                        type="radio"
                        name="sourcing_type"
                        required
                        value={option.value}
                        checked={form.sourcing_type === option.value}
                        onChange={() =>
                          setForm((current) => ({
                            ...current,
                            sourcing_type: option.value as FinishedProductSourcingType,
                            supplier_id:
                              option.value === "purchased"
                                ? current.supplier_id
                                : "",
                          }))
                        }
                        className="h-4 w-4 border-slate-300 text-[#0f2744] focus:ring-[#0f2744]"
                      />
                      {option.label}
                      <span className="text-xs text-slate-500">
                        {option.value === "manufactured"
                          ? "(produced in-house)"
                          : "(bought from a supplier for resale)"}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
            {form.sourcing_type === "purchased" ? (
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Primary Supplier{" "}
                  <span className="font-normal text-slate-500">(optional)</span>
                </label>
                <select
                  value={form.supplier_id}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      supplier_id: event.target.value,
                    }))
                  }
                  className={inputClassName}
                >
                  <option value="">No default supplier</option>
                  {initialSuppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-500">
                  Per-purchase supplier is recorded on the Purchases screen. This
                  field is only a default reference.
                </p>
              </div>
            ) : null}
            <div className="md:col-span-2 flex gap-3">
              <button
                type="submit"
                disabled={loading}
                className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Saving…" : editingProductId ? "Save Changes" : "Add Product"}
              </button>
              <button
                type="button"
                onClick={closeForm}
                disabled={loading}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Photo</th>
              <th className={scrollableTableThClassName}>Code</th>
              <th className={scrollableTableThClassName}>Product</th>
              <th className={scrollableTableThClassName}>Unit</th>
              <th className={scrollableTableThClassName}>Current Stock</th>
              <th className={scrollableTableThClassName}>Selling Price</th>
              <th className={scrollableTableThClassName}>Mfg Date</th>
              <th className={scrollableTableThClassName}>Expiration</th>
              {!readOnly ? (
                <th className={scrollableTableThClassName}>Actions</th>
              ) : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {products.length === 0 ? (
              <tr>
                <td
                  colSpan={readOnly ? 8 : 9}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  No finished products yet.
                </td>
              </tr>
            ) : (
              products.map((product, index) => {
                const expirationStatus = getFinishedProductExpirationStatus(
                  product.expiration_date,
                );
                const purchaseCount = purchaseCountByProductId[product.id] ?? 0;
                const hasBlockingPurchaseHistory = purchaseCount > 0;
                const showDeactivateAction =
                  !product.is_archived && hasBlockingPurchaseHistory;

                return (
                <tr key={product.id} className={getStripedRowClassName(index)}>
                  <td className="px-4 py-3">
                    <FinishedProductPhoto
                      photoUrl={product.photo_url}
                      productName={product.product_name}
                      size="sm"
                    />
                  </td>
                  <td className="px-4 py-3">{product.product_code}</td>
                  <td className="px-4 py-3 font-medium text-[#0f2744]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{product.product_name}</span>
                      {product.is_archived ? (
                        <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700">
                          Inactive
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">{product.unit_of_measure}</td>
                  <td className="px-4 py-3">
                    {formatInventoryQuantity(product.current_stock)}
                  </td>
                  <td className="px-4 py-3">
                    {formatInventoryMoney(product.standard_selling_price)}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {product.manufacturing_date ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-slate-600">
                        {product.expiration_date ?? "—"}
                      </span>
                      {expirationStatus === "expired" ? (
                        <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700">
                          Expired
                        </span>
                      ) : null}
                      {expirationStatus === "nearing_expiration" ? (
                        <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900">
                          Nearing expiration
                        </span>
                      ) : null}
                    </div>
                  </td>
                  {!readOnly ? (
                  <RegisterRowActions
                    onEdit={() => openEditForm(product)}
                    onDelete={
                      showDeactivateAction || product.is_archived
                        ? undefined
                        : () => handleDelete(product.id)
                    }
                    onArchive={
                      showDeactivateAction
                        ? () => handleArchive(product.id)
                        : undefined
                    }
                    onRestore={
                      product.is_archived
                        ? () => handleReactivate(product.id)
                        : undefined
                    }
                    deleting={deletingProductId === product.id}
                    archiving={archivingProductId === product.id}
                    restoring={reactivatingProductId === product.id}
                    archiveLabel="Deactivate"
                  />
                  ) : null}
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </ScrollableTable>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-[#0f2744]">
              Record Stock Adjustment
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              Opening balance and found stock update quantity and weighted
              average cost. Corrections and write-offs change quantity only.
            </p>
          </div>
          {!readOnly && !viewAllBusinessUnits ? (
            <button
              type="button"
              onClick={() =>
                setShowAdjustmentForm((current) => !current)
              }
              className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
            >
              {showAdjustmentForm ? "Cancel" : "Record Stock Adjustment"}
            </button>
          ) : null}
        </div>

        {!readOnly && viewAllBusinessUnits ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Switch to a specific business to record a stock adjustment.
          </p>
        ) : null}

        {showAdjustmentForm && !readOnly && !viewAllBusinessUnits ? (
          <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <form
              onSubmit={handleAdjustmentSubmit}
              className="grid gap-4 md:grid-cols-2"
            >
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Product
                </label>
                <select
                  required
                  value={adjustmentForm.product_id}
                  onChange={(event) =>
                    setAdjustmentForm((current) => ({
                      ...current,
                      product_id: event.target.value,
                    }))
                  }
                  className={inputClassName}
                >
                  <option value="">Select product</option>
                  {catalogProducts.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.product_code} — {product.product_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Adjustment Type
                </label>
                <select
                  required
                  value={adjustmentForm.adjustment_type}
                  onChange={(event) =>
                    setAdjustmentForm((current) => ({
                      ...current,
                      adjustment_type: event.target
                        .value as "" | FinishedProductAdjustmentType,
                      cost_per_unit:
                        event.target.value === "opening_balance" ||
                        event.target.value === "found_stock"
                          ? current.cost_per_unit
                          : "",
                    }))
                  }
                  className={inputClassName}
                >
                  <option value="">Select type</option>
                  {FINISHED_PRODUCT_ADJUSTMENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {FINISHED_PRODUCT_ADJUSTMENT_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
              </div>
              {adjustmentForm.adjustment_type === "correction" ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Direction
                  </label>
                  <select
                    required
                    value={adjustmentForm.correction_direction}
                    onChange={(event) =>
                      setAdjustmentForm((current) => ({
                        ...current,
                        correction_direction: event.target.value as
                          | "increase"
                          | "decrease",
                      }))
                    }
                    className={inputClassName}
                  >
                    <option value="increase">Increase</option>
                    <option value="decrease">Decrease</option>
                  </select>
                </div>
              ) : null}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  {adjustmentQuantityLabel}
                </label>
                <input
                  type="number"
                  min={0.0001}
                  step="0.0001"
                  required
                  value={adjustmentForm.quantity}
                  onChange={(event) =>
                    setAdjustmentForm((current) => ({
                      ...current,
                      quantity: event.target.value,
                    }))
                  }
                  className={inputClassName}
                />
              </div>
              {adjustmentNeedsCost ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Cost per Unit
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.0001"
                    required
                    value={adjustmentForm.cost_per_unit}
                    onChange={(event) =>
                      setAdjustmentForm((current) => ({
                        ...current,
                        cost_per_unit: event.target.value,
                      }))
                    }
                    className={inputClassName}
                  />
                </div>
              ) : null}
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Reason
                </label>
                <input
                  type="text"
                  required
                  value={adjustmentForm.reason}
                  onChange={(event) =>
                    setAdjustmentForm((current) => ({
                      ...current,
                      reason: event.target.value,
                    }))
                  }
                  className={inputClassName}
                  placeholder="Why is this adjustment needed?"
                />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Notes
                </label>
                <textarea
                  rows={2}
                  value={adjustmentForm.notes}
                  onChange={(event) =>
                    setAdjustmentForm((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                  className={inputClassName}
                />
              </div>
              <div className="md:col-span-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? "Saving…" : "Save Adjustment"}
                </button>
              </div>
            </form>
          </section>
        ) : null}

        <FilteredListCount
          filteredCount={adjustments.length}
          totalCount={adjustments.length}
          itemSingular="adjustment"
        />

        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Date</th>
                <th className={scrollableTableThClassName}>Product</th>
                <th className={scrollableTableThClassName}>Type</th>
                <th className={scrollableTableThClassName}>Quantity</th>
                <th className={scrollableTableThClassName}>Cost / Unit</th>
                <th className={scrollableTableThClassName}>Reason</th>
                <th className={scrollableTableThClassName}>Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {adjustments.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-center text-sm text-slate-500"
                  >
                    No stock adjustments recorded yet.
                  </td>
                </tr>
              ) : (
                adjustments.map((adjustment, index) => (
                  <tr
                    key={adjustment.id}
                    className={getStripedRowClassName(index)}
                  >
                    <td className="px-4 py-3">
                      {adjustment.created_at.slice(0, 10)}
                    </td>
                    <td className="px-4 py-3">
                      {adjustment.product?.product_name ??
                        adjustment.product_id}
                    </td>
                    <td className="px-4 py-3">
                      {formatFinishedProductAdjustmentType(
                        adjustment.adjustment_type,
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {formatInventoryQuantity(adjustment.quantity_delta)}{" "}
                      {adjustment.product?.unit_of_measure ?? ""}
                    </td>
                    <td className="px-4 py-3">
                      {adjustment.cost_per_unit == null
                        ? "—"
                        : formatInventoryMoney(adjustment.cost_per_unit)}
                    </td>
                    <td className="px-4 py-3">{adjustment.reason}</td>
                    <td className="px-4 py-3">
                      {adjustment.notes ?? "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollableTable>
      </section>
    </div>
  );
}
