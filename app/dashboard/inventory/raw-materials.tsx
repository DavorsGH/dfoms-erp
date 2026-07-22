"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { inputClassName } from "../employees/employee-record-utils";
import RegisterRowActions, {
  confirmRawMaterialPurchaseDelete,
  confirmRawMaterialPurchaseEdit,
  getStripedRowClassName,
} from "../finance/register-row-actions";
import {
  buildRawMaterialDeleteMessage,
  confirmCascadeDelete,
  type RawMaterialDeletePreview,
} from "./inventory-delete-utils";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import {
  formatInventoryMoney,
  formatInventoryQuantity,
  nullableNumber,
  nullableText,
} from "./inventory-utils";
import { allocateMaterialCode } from "./inventory-ids-api";
import {
  normalizeRawMaterial,
  normalizeRawMaterialPurchase,
  RAW_MATERIAL_PURCHASE_SELECT,
  RAW_MATERIAL_SELECT,
  type RawMaterialPurchaseRecord,
  type RawMaterialRecord,
} from "./raw-materials-utils";
import type { NamedLookup } from "../lookup-types";

type RawMaterialsProps = {
  initialMaterials: RawMaterialRecord[];
  initialPurchases: RawMaterialPurchaseRecord[];
  initialPaymentMethods: NamedLookup[];
  fetchError: string | null;
  readOnly?: boolean;
};

const emptyMaterialForm = {
  material_code: "",
  material_name: "",
  unit_of_measure: "",
  reorder_level: "",
};

const emptyPurchaseForm = {
  material_id: "",
  purchase_date: new Date().toISOString().slice(0, 10),
  quantity: "",
  cost_per_unit: "",
  supplier: "",
  payment_method: "",
  notes: "",
};

export default function RawMaterials({
  initialMaterials,
  initialPurchases,
  initialPaymentMethods,
  fetchError,
  readOnly = false,
}: RawMaterialsProps) {
  const supabase = createClient();
  const [materials, setMaterials] = useState(
    initialMaterials.map(normalizeRawMaterial),
  );
  const [purchases, setPurchases] = useState(
    initialPurchases.map(normalizeRawMaterialPurchase),
  );
  const [paymentMethods, setPaymentMethods] = useState(initialPaymentMethods);
  const [showMaterialForm, setShowMaterialForm] = useState(false);
  const [showPurchaseForm, setShowPurchaseForm] = useState(false);
  const [editingMaterialId, setEditingMaterialId] = useState<string | null>(null);
  const [deletingMaterialId, setDeletingMaterialId] = useState<string | null>(
    null,
  );
  const [editingPurchaseId, setEditingPurchaseId] = useState<string | null>(
    null,
  );
  const [deletingPurchaseId, setDeletingPurchaseId] = useState<string | null>(
    null,
  );
  const [purchaseEditForm, setPurchaseEditForm] = useState(emptyPurchaseForm);
  const [materialForm, setMaterialForm] = useState(emptyMaterialForm);
  const [purchaseForm, setPurchaseForm] = useState(emptyPurchaseForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);

  useEffect(() => {
    setMaterials(initialMaterials.map(normalizeRawMaterial));
    setPurchases(initialPurchases.map(normalizeRawMaterialPurchase));
    setPaymentMethods(initialPaymentMethods);
  }, [initialMaterials, initialPurchases, initialPaymentMethods]);

  useEffect(() => {
    if (!showPurchaseForm && !editingPurchaseId) {
      return;
    }

    async function loadPaymentMethods() {
      const { data, error: methodsError } = await supabase
        .from("payment_methods")
        .select("name")
        .order("name", { ascending: true });

      if (methodsError) {
        setError(methodsError.message);
        return;
      }

      setPaymentMethods((data as NamedLookup[] | null) ?? []);
    }

    void loadPaymentMethods();
  }, [showPurchaseForm, editingPurchaseId, supabase]);

  const purchasePreviewTotal = useMemo(() => {
    const quantity = Number.parseFloat(purchaseForm.quantity);
    const unitCost = Number.parseFloat(purchaseForm.cost_per_unit);
    if (Number.isNaN(quantity) || Number.isNaN(unitCost)) {
      return null;
    }

    return Math.round(quantity * unitCost * 10000) / 10000;
  }, [purchaseForm.cost_per_unit, purchaseForm.quantity]);

  const purchaseEditPreviewTotal = useMemo(() => {
    const quantity = Number.parseFloat(purchaseEditForm.quantity);
    const unitCost = Number.parseFloat(purchaseEditForm.cost_per_unit);
    if (Number.isNaN(quantity) || Number.isNaN(unitCost)) {
      return null;
    }

    return Math.round(quantity * unitCost * 10000) / 10000;
  }, [purchaseEditForm.cost_per_unit, purchaseEditForm.quantity]);

  async function refreshData() {
    const [{ data: materialRows, error: materialError }, { data: purchaseRows, error: purchaseError }] =
      await Promise.all([
        supabase
          .from("raw_materials")
          .select(RAW_MATERIAL_SELECT)
          .order("material_name", { ascending: true }),
        supabase
          .from("raw_material_purchases")
          .select(RAW_MATERIAL_PURCHASE_SELECT)
          .order("purchase_date", { ascending: false }),
      ]);

    if (materialError || purchaseError) {
      setError(materialError?.message ?? purchaseError?.message ?? "Refresh failed.");
      return;
    }

    setMaterials(
      ((materialRows as RawMaterialRecord[] | null) ?? []).map((row) =>
        normalizeRawMaterial(row),
      ),
    );
    setPurchases(
      (((purchaseRows as unknown) as RawMaterialPurchaseRecord[] | null) ?? []).map(
        (row) => normalizeRawMaterialPurchase(row),
      ),
    );
    setError(null);
  }

  function openAddMaterialForm() {
    setEditingMaterialId(null);
    setMaterialForm({ ...emptyMaterialForm });
    setShowMaterialForm(true);
  }

  function openEditMaterialForm(material: RawMaterialRecord) {
    setEditingMaterialId(material.id);
    setMaterialForm({
      material_code: material.material_code,
      material_name: material.material_name,
      unit_of_measure: material.unit_of_measure,
      reorder_level:
        material.reorder_level == null ? "" : String(material.reorder_level),
    });
    setShowMaterialForm(true);
  }

  function closeMaterialForm() {
    setEditingMaterialId(null);
    setMaterialForm(emptyMaterialForm);
    setShowMaterialForm(false);
  }

  async function handleMaterialSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    if (editingMaterialId) {
      const { error: saveError } = await supabase
        .from("raw_materials")
        .update({
          material_name: materialForm.material_name.trim(),
          unit_of_measure: materialForm.unit_of_measure.trim(),
          reorder_level: nullableNumber(materialForm.reorder_level),
          updated_at: new Date().toISOString(),
        })
        .eq("id", editingMaterialId);

      if (saveError) {
        setError(saveError.message);
        setLoading(false);
        return;
      }
    } else {
      const allocated = await allocateMaterialCode(supabase);
      if (allocated.error || !allocated.materialCode) {
        setError(allocated.error ?? "Unable to allocate material code.");
        setLoading(false);
        return;
      }

      const { error: saveError } = await supabase.from("raw_materials").insert({
        material_code: allocated.materialCode,
        material_name: materialForm.material_name.trim(),
        unit_of_measure: materialForm.unit_of_measure.trim(),
        reorder_level: nullableNumber(materialForm.reorder_level),
      });

      if (saveError) {
        setError(saveError.message);
        setLoading(false);
        return;
      }
    }

    closeMaterialForm();
    await refreshData();
    setLoading(false);
  }

  async function handleDeleteMaterial(materialId: string) {
    setDeletingMaterialId(materialId);
    setError(null);

    const { data: previewData, error: previewError } = await supabase.rpc(
      "preview_raw_material_delete",
      { p_material_id: materialId },
    );

    if (previewError) {
      setError(previewError.message);
      setDeletingMaterialId(null);
      return;
    }

    const preview = previewData as RawMaterialDeletePreview;
    if (!confirmCascadeDelete(buildRawMaterialDeleteMessage(preview))) {
      setDeletingMaterialId(null);
      return;
    }

    const { error: deleteError } = await supabase.rpc(
      "delete_raw_material_cascade",
      { p_material_id: materialId },
    );

    if (deleteError) {
      setError(deleteError.message);
      setDeletingMaterialId(null);
      return;
    }

    if (editingMaterialId === materialId) {
      closeMaterialForm();
    }

    await refreshData();
    setDeletingMaterialId(null);
  }

  function openEditPurchaseForm(purchase: RawMaterialPurchaseRecord) {
    setEditingPurchaseId(purchase.id);
    setPurchaseEditForm({
      material_id: purchase.material_id,
      purchase_date: purchase.purchase_date,
      quantity: String(purchase.quantity),
      cost_per_unit: String(purchase.cost_per_unit),
      supplier: purchase.supplier ?? "",
      payment_method: purchase.payment_method ?? "",
      notes: purchase.notes ?? "",
    });
    setShowPurchaseForm(false);
  }

  function closePurchaseEditForm() {
    setEditingPurchaseId(null);
    setPurchaseEditForm(emptyPurchaseForm);
  }

  async function handlePurchaseEditSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!confirmRawMaterialPurchaseEdit()) {
      return;
    }

    if (!editingPurchaseId) {
      return;
    }

    setLoading(true);
    setError(null);

    const quantity = Number.parseFloat(purchaseEditForm.quantity);
    const costPerUnit = Number.parseFloat(purchaseEditForm.cost_per_unit);

    if (Number.isNaN(quantity) || quantity <= 0) {
      setError("Purchase quantity must be greater than zero.");
      setLoading(false);
      return;
    }

    if (Number.isNaN(costPerUnit) || costPerUnit < 0) {
      setError("Cost per unit must be zero or greater.");
      setLoading(false);
      return;
    }

    if (!purchaseEditForm.payment_method.trim()) {
      setError("Select a payment method for this purchase.");
      setLoading(false);
      return;
    }

    const { error: updateError } = await supabase.rpc(
      "update_raw_material_purchase",
      {
        p_purchase_id: editingPurchaseId,
        p_purchase_date: purchaseEditForm.purchase_date,
        p_quantity: quantity,
        p_cost_per_unit: costPerUnit,
        p_supplier: nullableText(purchaseEditForm.supplier),
        p_payment_method: purchaseEditForm.payment_method.trim(),
        p_notes: nullableText(purchaseEditForm.notes),
      },
    );

    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }

    closePurchaseEditForm();
    await refreshData();
    setLoading(false);
  }

  async function handleDeletePurchase(purchaseId: string) {
    if (!confirmRawMaterialPurchaseDelete()) {
      return;
    }

    setDeletingPurchaseId(purchaseId);
    setError(null);

    const { error: deleteError } = await supabase.rpc(
      "delete_raw_material_purchase",
      { p_purchase_id: purchaseId },
    );

    if (deleteError) {
      setError(deleteError.message);
      setDeletingPurchaseId(null);
      return;
    }

    if (editingPurchaseId === purchaseId) {
      closePurchaseEditForm();
    }

    await refreshData();
    setDeletingPurchaseId(null);
  }

  async function handlePurchaseSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const quantity = Number.parseFloat(purchaseForm.quantity);
    const costPerUnit = Number.parseFloat(purchaseForm.cost_per_unit);

    if (Number.isNaN(quantity) || quantity <= 0) {
      setError("Purchase quantity must be greater than zero.");
      setLoading(false);
      return;
    }

    if (Number.isNaN(costPerUnit) || costPerUnit < 0) {
      setError("Cost per unit must be zero or greater.");
      setLoading(false);
      return;
    }

    if (!purchaseForm.material_id) {
      setError("Select a raw material for this purchase.");
      setLoading(false);
      return;
    }

    if (!purchaseForm.payment_method.trim()) {
      setError("Select a payment method for this purchase.");
      setLoading(false);
      return;
    }

    const { error: insertError } = await supabase
      .from("raw_material_purchases")
      .insert({
        material_id: purchaseForm.material_id,
        purchase_date: purchaseForm.purchase_date,
        quantity,
        cost_per_unit: costPerUnit,
        total_cost: Math.round(quantity * costPerUnit * 10000) / 10000,
        supplier: nullableText(purchaseForm.supplier),
        payment_method: purchaseForm.payment_method.trim(),
        notes: nullableText(purchaseForm.notes),
      });

    if (insertError) {
      setError(insertError.message);
      setLoading(false);
      return;
    }

    setPurchaseForm(emptyPurchaseForm);
    setShowPurchaseForm(false);
    await refreshData();
    setLoading(false);
  }

  return (
    <div className="space-y-8">
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-slate-600">
            Maintain raw material master data and record purchases. Stock and
            weighted average cost update automatically; cash or accounts payable
            postings apply from the inventory go-live date.
          </p>
          {!readOnly ? (
          <button
            type="button"
            onClick={() =>
              showMaterialForm ? closeMaterialForm() : openAddMaterialForm()
            }
            className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
          >
            {showMaterialForm ? "Cancel" : "Add Raw Material"}
          </button>
          ) : null}
        </div>

        {showMaterialForm && !readOnly ? (
          <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
              {editingMaterialId ? "Edit Raw Material" : "New Raw Material"}
            </h3>
            <form onSubmit={handleMaterialSubmit} className="grid gap-4 md:grid-cols-2">
              {editingMaterialId ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Material Code
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={materialForm.material_code}
                    className={`${inputClassName} bg-slate-50 text-slate-600`}
                  />
                </div>
              ) : null}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Material Name
                </label>
                <input
                  type="text"
                  required
                  value={materialForm.material_name}
                  onChange={(event) =>
                    setMaterialForm((current) => ({
                      ...current,
                      material_name: event.target.value,
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
                  placeholder="e.g. litres, kg"
                  value={materialForm.unit_of_measure}
                  onChange={(event) =>
                    setMaterialForm((current) => ({
                      ...current,
                      unit_of_measure: event.target.value,
                    }))
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Reorder Level
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.0001"
                  value={materialForm.reorder_level}
                  onChange={(event) =>
                    setMaterialForm((current) => ({
                      ...current,
                      reorder_level: event.target.value,
                    }))
                  }
                  className={inputClassName}
                />
              </div>
              <div className="md:col-span-2 flex gap-3">
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? "Saving…" : editingMaterialId ? "Save Changes" : "Add Material"}
                </button>
                <button
                  type="button"
                  onClick={closeMaterialForm}
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
                <th className={scrollableTableThClassName}>Code</th>
                <th className={scrollableTableThClassName}>Material</th>
                <th className={scrollableTableThClassName}>Unit</th>
                <th className={scrollableTableThClassName}>Current Stock</th>
                <th className={scrollableTableThClassName}>Avg Cost / Unit</th>
                <th className={scrollableTableThClassName}>Reorder Level</th>
                <th className={scrollableTableThClassName}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {materials.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-center text-sm text-slate-500"
                  >
                    No raw materials yet.
                  </td>
                </tr>
              ) : (
                materials.map((material, index) => (
                  <tr
                    key={material.id}
                    className={getStripedRowClassName(index)}
                  >
                    <td className="px-4 py-3">{material.material_code}</td>
                    <td className="px-4 py-3 font-medium text-[#0f2744]">
                      {material.material_name}
                    </td>
                    <td className="px-4 py-3">{material.unit_of_measure}</td>
                    <td className="px-4 py-3">
                      {formatInventoryQuantity(material.current_stock)}
                    </td>
                    <td className="px-4 py-3">
                      {formatInventoryMoney(material.average_cost_per_unit)}
                    </td>
                    <td className="px-4 py-3">
                      {formatInventoryQuantity(material.reorder_level)}
                    </td>
                    {!readOnly ? (
                    <RegisterRowActions
                      onEdit={() => openEditMaterialForm(material)}
                      onDelete={() => handleDeleteMaterial(material.id)}
                      deleting={deletingMaterialId === material.id}
                    />
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollableTable>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-[#0f2744]">
              Record Purchase
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              Increases stock and recalculates weighted average cost. Debits
              Inventory and credits Cash or Accounts Payable (same payment-method
              rules as Expense Register).
            </p>
          </div>
          {!readOnly ? (
          <button
            type="button"
            onClick={() => setShowPurchaseForm((current) => !current)}
            className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
          >
            {showPurchaseForm ? "Cancel" : "Record Purchase"}
          </button>
          ) : null}
        </div>

        {showPurchaseForm && !readOnly ? (
          <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <form onSubmit={handlePurchaseSubmit} className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Material
                </label>
                <select
                  required
                  value={purchaseForm.material_id}
                  onChange={(event) =>
                    setPurchaseForm((current) => ({
                      ...current,
                      material_id: event.target.value,
                    }))
                  }
                  className={inputClassName}
                >
                  <option value="">Select material</option>
                  {materials.map((material) => (
                    <option key={material.id} value={material.id}>
                      {material.material_code} — {material.material_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Purchase Date
                </label>
                <input
                  type="date"
                  required
                  value={purchaseForm.purchase_date}
                  onChange={(event) =>
                    setPurchaseForm((current) => ({
                      ...current,
                      purchase_date: event.target.value,
                    }))
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Quantity
                </label>
                <input
                  type="number"
                  min={0.0001}
                  step="0.0001"
                  required
                  value={purchaseForm.quantity}
                  onChange={(event) =>
                    setPurchaseForm((current) => ({
                      ...current,
                      quantity: event.target.value,
                    }))
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Cost per Unit
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.0001"
                  required
                  value={purchaseForm.cost_per_unit}
                  onChange={(event) =>
                    setPurchaseForm((current) => ({
                      ...current,
                      cost_per_unit: event.target.value,
                    }))
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Supplier
                </label>
                <input
                  type="text"
                  value={purchaseForm.supplier}
                  onChange={(event) =>
                    setPurchaseForm((current) => ({
                      ...current,
                      supplier: event.target.value,
                    }))
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Payment Method
                </label>
                <select
                  required
                  value={purchaseForm.payment_method}
                  onChange={(event) =>
                    setPurchaseForm((current) => ({
                      ...current,
                      payment_method: event.target.value,
                    }))
                  }
                  className={inputClassName}
                >
                  <option value="">Select payment method</option>
                  {paymentMethods.map((method) => (
                    <option key={method.name} value={method.name}>
                      {method.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Notes
                </label>
                <textarea
                  rows={2}
                  value={purchaseForm.notes}
                  onChange={(event) =>
                    setPurchaseForm((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                  className={inputClassName}
                />
              </div>
              {purchasePreviewTotal != null ? (
                <div className="md:col-span-2 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  Total purchase cost:{" "}
                  <span className="font-medium text-[#0f2744]">
                    {formatInventoryMoney(purchasePreviewTotal)}
                  </span>
                </div>
              ) : null}
              <div className="md:col-span-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? "Saving…" : "Save Purchase"}
                </button>
              </div>
            </form>
          </section>
        ) : null}

        {editingPurchaseId ? (
          <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <h4 className="mb-4 text-lg font-semibold text-[#0f2744]">
              Edit Purchase
            </h4>
            <form
              onSubmit={handlePurchaseEditSubmit}
              className="grid gap-4 md:grid-cols-2"
            >
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Material
                </label>
                <input
                  type="text"
                  readOnly
                  value={
                    materials.find((item) => item.id === purchaseEditForm.material_id)
                      ?.material_name ?? purchaseEditForm.material_id
                  }
                  className={`${inputClassName} bg-slate-50 text-slate-600`}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Purchase Date
                </label>
                <input
                  type="date"
                  required
                  value={purchaseEditForm.purchase_date}
                  onChange={(event) =>
                    setPurchaseEditForm((current) => ({
                      ...current,
                      purchase_date: event.target.value,
                    }))
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Quantity
                </label>
                <input
                  type="number"
                  min={0.0001}
                  step="0.0001"
                  required
                  value={purchaseEditForm.quantity}
                  onChange={(event) =>
                    setPurchaseEditForm((current) => ({
                      ...current,
                      quantity: event.target.value,
                    }))
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Cost per Unit
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.0001"
                  required
                  value={purchaseEditForm.cost_per_unit}
                  onChange={(event) =>
                    setPurchaseEditForm((current) => ({
                      ...current,
                      cost_per_unit: event.target.value,
                    }))
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Supplier
                </label>
                <input
                  type="text"
                  value={purchaseEditForm.supplier}
                  onChange={(event) =>
                    setPurchaseEditForm((current) => ({
                      ...current,
                      supplier: event.target.value,
                    }))
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Payment Method
                </label>
                <select
                  required
                  value={purchaseEditForm.payment_method}
                  onChange={(event) =>
                    setPurchaseEditForm((current) => ({
                      ...current,
                      payment_method: event.target.value,
                    }))
                  }
                  className={inputClassName}
                >
                  <option value="">Select payment method</option>
                  {paymentMethods.map((method) => (
                    <option key={method.name} value={method.name}>
                      {method.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Notes
                </label>
                <textarea
                  rows={2}
                  value={purchaseEditForm.notes}
                  onChange={(event) =>
                    setPurchaseEditForm((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                  className={inputClassName}
                />
              </div>
              {purchaseEditPreviewTotal != null ? (
                <div className="md:col-span-2 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  Total purchase cost:{" "}
                  <span className="font-medium text-[#0f2744]">
                    {formatInventoryMoney(purchaseEditPreviewTotal)}
                  </span>
                </div>
              ) : null}
              <div className="md:col-span-2 flex gap-3">
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? "Saving…" : "Save Changes"}
                </button>
                <button
                  type="button"
                  onClick={closePurchaseEditForm}
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
                <th className={scrollableTableThClassName}>Date</th>
                <th className={scrollableTableThClassName}>Material</th>
                <th className={scrollableTableThClassName}>Quantity</th>
                <th className={scrollableTableThClassName}>Cost / Unit</th>
                <th className={scrollableTableThClassName}>Total Cost</th>
                <th className={scrollableTableThClassName}>Supplier</th>
                <th className={scrollableTableThClassName}>Payment</th>
                <th className={scrollableTableThClassName}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {purchases.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-8 text-center text-sm text-slate-500"
                  >
                    No purchases recorded yet.
                  </td>
                </tr>
              ) : (
                purchases.map((purchase, index) => (
                  <tr
                    key={purchase.id}
                    className={getStripedRowClassName(index)}
                  >
                    <td className="px-4 py-3">{purchase.purchase_date}</td>
                    <td className="px-4 py-3">
                      {purchase.material?.material_name ?? purchase.material_id}
                    </td>
                    <td className="px-4 py-3">
                      {formatInventoryQuantity(purchase.quantity)}{" "}
                      {purchase.material?.unit_of_measure ?? ""}
                    </td>
                    <td className="px-4 py-3">
                      {formatInventoryMoney(purchase.cost_per_unit)}
                    </td>
                    <td className="px-4 py-3">
                      {formatInventoryMoney(purchase.total_cost)}
                    </td>
                    <td className="px-4 py-3">{purchase.supplier ?? "—"}</td>
                    <td className="px-4 py-3">{purchase.payment_method ?? "—"}</td>
                    {!readOnly ? (
                    <RegisterRowActions
                      onEdit={() => openEditPurchaseForm(purchase)}
                      onDelete={() => handleDeletePurchase(purchase.id)}
                      deleting={deletingPurchaseId === purchase.id}
                    />
                    ) : null}
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
