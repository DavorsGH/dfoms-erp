"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { useAlert, useToast } from "@/components/feedback";
import {
  useBusinessUnitReadScope,
  useStampBusinessUnitId,
} from "@/app/dashboard/business-unit-view-context";
import {
  assertCanModifyBusinessUnitRow,
  formatBusinessUnitAccessError,
  loadWriteBusinessUnitContext,
  resolveWriteBusinessUnitIdForCreate,
} from "@/utils/business-unit-access";
import type { ExpenseSubcategoryLookup } from "../finance/expense-register-utils";
import RegisterRowActions, { getStripedRowClassName } from "../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import {
  allocateConsumableItemCode,
  CONSUMABLE_UNIT_PRESETS,
  formatConsumablesItemSaveError,
  parseConsumableMinimumLevel,
  type ConsumableItemRecord,
} from "./consumables-store-utils";
import { UnitOfMeasureSelect } from "@/components/unit-of-measure-select";
import { formatUnit } from "@/utils/units-of-measure";
import {
  consumablesInputClassName,
  consumablesPrimaryButtonClassName,
  refreshConsumableItems,
} from "./consumables-store-client";
import {
  CONSUMABLES_NO_ITEMS_MESSAGE,
  ConsumablesScopeNotice,
} from "./consumables-empty-scope-messages";
import { ConsumablesScopeSubtitle } from "./consumables-scope-subtitle";

type Props = {
  tenantId: string;
  initialItems: ConsumableItemRecord[];
  expenseSubcategories: ExpenseSubcategoryLookup[];
  fetchError: string | null;
};

type ItemFormState = {
  name: string;
  category: string;
  unit: string;
  minimum_level: string;
  notes: string;
};

function toItemSaveError(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    const row = error as { code?: string; message: string };
    return formatConsumablesItemSaveError({
      message: row.message,
      code: row.code ?? "",
    });
  }
  if (error instanceof Error) {
    return formatConsumablesItemSaveError(error.message);
  }
  return formatConsumablesItemSaveError(String(error));
}

export default function ConsumablesItemsScreen({
  tenantId,
  initialItems,
  expenseSubcategories,
  fetchError,
}: Props) {
  const supabase = createClient();
  const buReadScope = useBusinessUnitReadScope();
  const stampBusinessUnit = useStampBusinessUnitId();
  const { alertError } = useAlert();
  const { toast } = useToast();
  const [items, setItems] = useState(initialItems);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(fetchError);
  const [form, setForm] = useState<ItemFormState>({
    name: "",
    category: "",
    unit: CONSUMABLE_UNIT_PRESETS[0]!,
    minimum_level: "",
    notes: "",
  });

  const subcategoryOptions = useMemo(() => {
    const active = expenseSubcategories.filter((row) => row.is_active !== false);
    const current = form.category.trim();
    if (current && !active.some((row) => row.name === current)) {
      const legacy = expenseSubcategories.find((row) => row.name === current);
      if (legacy) {
        return [...active, legacy];
      }
    }
    return active;
  }, [expenseSubcategories, form.category]);

  const activeItems = items.filter((item) => !item.is_archived);

  async function reload() {
    const result = await refreshConsumableItems(tenantId, buReadScope);
    if (result.error) {
      setListError(result.error);
      return;
    }
    setItems(result.items);
    setListError(null);
  }

  function openAdd() {
    setEditingId(null);
    setForm({
      name: "",
      category: "",
      unit: CONSUMABLE_UNIT_PRESETS[0]!,
      minimum_level: "",
      notes: "",
    });
    setShowForm(true);
  }

  function openEdit(item: ConsumableItemRecord) {
    setEditingId(item.id);
    setForm({
      name: item.name,
      category: item.category ?? "",
      unit: item.unit?.trim() || CONSUMABLE_UNIT_PRESETS[0]!,
      minimum_level:
        item.minimum_level != null && Number(item.minimum_level) > 0
          ? String(item.minimum_level)
          : "",
      notes: item.notes ?? "",
    });
    setShowForm(true);
  }

  async function handleArchive(item: ConsumableItemRecord) {
    setLoading(true);
    const buContext = await loadWriteBusinessUnitContext(supabase);
    if (!buContext.ok) {
      await alertError(buContext.error, { title: "Could not archive item" });
      setLoading(false);
      return;
    }
    try {
      assertCanModifyBusinessUnitRow(
        buContext.allowedUnits,
        item.business_unit_id,
      );
    } catch (accessError) {
      await alertError(formatBusinessUnitAccessError(accessError), {
        title: "Could not archive item",
      });
      setLoading(false);
      return;
    }
    const { error } = await supabase
      .from("consumable_items")
      .update({ is_archived: true, updated_at: new Date().toISOString() })
      .eq("id", item.id)
      .eq("tenant_id", tenantId);
    if (error) {
      await alertError(formatConsumablesItemSaveError(error), {
        title: "Could not archive item",
      });
    } else {
      toast("Item archived.");
      await reload();
    }
    setLoading(false);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) {
      return;
    }
    const unit = form.unit.trim();
    if (!unit) {
      await alertError("Enter a unit of measure.", { title: "Unit required" });
      return;
    }
    setLoading(true);
    try {
      const buContext = await loadWriteBusinessUnitContext(supabase);
      if (!buContext.ok) {
        throw new Error(buContext.error);
      }
      const payload = {
        name: form.name.trim(),
        category: form.category.trim(),
        unit,
        minimum_level: parseConsumableMinimumLevel(form.minimum_level),
        notes: form.notes.trim() || null,
        updated_at: new Date().toISOString(),
      };

      if (editingId) {
        const existing = items.find((item) => item.id === editingId);
        assertCanModifyBusinessUnitRow(
          buContext.allowedUnits,
          existing?.business_unit_id,
        );
        const { error } = await supabase
          .from("consumable_items")
          .update(payload)
          .eq("id", editingId)
          .eq("tenant_id", tenantId);
        if (error) {
          throw error;
        }
        toast("Item updated.");
      } else {
        const stampResult = resolveWriteBusinessUnitIdForCreate({
          allowedUnits: buContext.allowedUnits,
          stamp: stampBusinessUnit,
        });
        if (!stampResult.ok) {
          throw new Error(stampResult.error);
        }
        assertCanModifyBusinessUnitRow(
          buContext.allowedUnits,
          stampResult.businessUnitId,
        );
        const { itemCode, error: codeError } = await allocateConsumableItemCode(
          supabase,
          tenantId,
        );
        if (codeError || !itemCode) {
          throw new Error(codeError ?? "Could not allocate item code.");
        }
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const { error } = await supabase.from("consumable_items").insert({
          tenant_id: tenantId,
          business_unit_id: stampResult.businessUnitId,
          item_code: itemCode,
          is_archived: false,
          created_by: user?.id ?? null,
          ...payload,
        });
        if (error) {
          throw error;
        }
        toast("Item created.");
      }
      setShowForm(false);
      await reload();
    } catch (submitError) {
      await alertError(toItemSaveError(submitError), {
        title: "Could not save item",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {listError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {listError}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ConsumablesScopeSubtitle title="Items" />
        <button
          type="button"
          className={consumablesPrimaryButtonClassName}
          onClick={openAdd}
        >
          Add item
        </button>
      </div>
      {activeItems.length === 0 ? (
        <ConsumablesScopeNotice message={CONSUMABLES_NO_ITEMS_MESSAGE} />
      ) : null}
      {showForm ? (
        <form
          onSubmit={(event) => void handleSubmit(event)}
          className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
        >
          <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
            {editingId ? "Edit item" : "New item"}
          </h3>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm md:col-span-2">
              <span className="mb-1 block font-medium">Name</span>
              <input
                required
                className={consumablesInputClassName}
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Category</span>
              <select
                required
                className={consumablesInputClassName}
                value={form.category}
                onChange={(e) =>
                  setForm((f) => ({ ...f, category: e.target.value }))
                }
              >
                <option value="">Select sub-category</option>
                {subcategoryOptions.map((row) => (
                  <option key={row.id} value={row.name}>
                    {row.expense_category
                      ? `${row.name} (${row.expense_category})`
                      : row.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="text-sm">
              <UnitOfMeasureSelect
                required
                label="Unit"
                value={form.unit}
                onChange={(unit) => setForm((f) => ({ ...f, unit }))}
                className={consumablesInputClassName}
                otherInputClassName={consumablesInputClassName}
              />
            </div>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">
                Minimum level (optional)
              </span>
              <input
                type="number"
                min={0}
                step="0.01"
                className={consumablesInputClassName}
                value={form.minimum_level}
                onChange={(e) =>
                  setForm((f) => ({ ...f, minimum_level: e.target.value }))
                }
              />
            </label>
            <label className="block text-sm md:col-span-2">
              <span className="mb-1 block font-medium">Notes</span>
              <textarea
                className={consumablesInputClassName}
                rows={2}
                value={form.notes}
                onChange={(e) =>
                  setForm((f) => ({ ...f, notes: e.target.value }))
                }
              />
            </label>
          </div>
          <div className="mt-4 flex gap-3">
            <button
              type="submit"
              disabled={loading}
              className={consumablesPrimaryButtonClassName}
            >
              {loading ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              disabled={loading}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm"
              onClick={() => setShowForm(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Code</th>
              <th className={scrollableTableThClassName}>Name</th>
              <th className={scrollableTableThClassName}>Category</th>
              <th className={scrollableTableThClassName}>Unit</th>
              <th className={scrollableTableThClassName}>Min level</th>
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {activeItems.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No active items yet.
                </td>
              </tr>
            ) : (
              activeItems.map((item, index) => (
                <tr key={item.id} className={getStripedRowClassName(index)}>
                  <td className="px-4 py-3 text-sm">{item.item_code}</td>
                  <td className="px-4 py-3 text-sm">{item.name}</td>
                  <td className="px-4 py-3 text-sm">{item.category ?? "—"}</td>
                  <td className="px-4 py-3 text-sm">
                    {item.unit ? formatUnit(item.unit) : "—"}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {item.minimum_level ?? 0}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <RegisterRowActions
                      onEdit={() => openEdit(item)}
                      onArchive={() => void handleArchive(item)}
                      disableDelete
                    />
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
