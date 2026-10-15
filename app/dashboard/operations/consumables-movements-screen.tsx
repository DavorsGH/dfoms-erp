"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { useAlert, useToast } from "@/components/feedback";
import {
  useBusinessUnitReadScope,
  useStampBusinessUnitId,
} from "@/app/dashboard/business-unit-view-context";
import {
  assertCanModifyBusinessUnitRow,
  loadWriteBusinessUnitContext,
  resolveWriteBusinessUnitIdForCreate,
} from "@/utils/business-unit-access";
import { formatGHS } from "../finance/income-register-utils";
import { formatDate } from "../hr-payroll/hr-register-utils";
import RegisterRowActions, {
  confirmDeleteEntry,
  getStripedRowClassName,
  toDateInputValue,
} from "../finance/register-row-actions";
import {
  RegisterColumnFilterHeader,
  RegisterDateRangeFilterHeader,
  collectDistinctColumnValues,
  columnValuePassesFilter,
  createRegisterDateSortState,
  dateValuePassesRangeFilter,
  registerColumnSortConfig,
  sortRegisterRows,
  type RegisterColumnFilterValue,
  type RegisterColumnSortState,
  type RegisterDateRangeFilterValue,
} from "../finance/register-column-filter";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import type {
  ConsumableMovementDisplayMaps,
  ConsumableMovementPurchaseLink,
  ConsumableSiteOption,
} from "./consumables-store-data";
import {
  ADJUST_REASONS,
  type AdjustReason,
  computeWeightedAverageState,
  formatConsumablesStockError,
  isInboundMovementType,
  wouldInboundChangeCauseNegativeStock,
  type ConsumableItemRecord,
  type ConsumableMovementRecord,
  type ConsumableMovementType,
} from "./consumables-store-utils";
import {
  consumablesInputClassName,
  consumablesPrimaryButtonClassName,
  refreshConsumableMovementDisplayMaps,
  refreshConsumableMovements,
} from "./consumables-store-client";
import { ConsumablesScopeSubtitle } from "./consumables-scope-subtitle";

type Props = {
  tenantId: string;
  initialItems: ConsumableItemRecord[];
  initialMovements: ConsumableMovementRecord[];
  sites: ConsumableSiteOption[];
  initialDisplayMaps: ConsumableMovementDisplayMaps;
  fetchError: string | null;
};

const TYPE_LABELS: Record<ConsumableMovementType, string> = {
  receive: "Receive",
  issue: "Issue",
  return: "Return",
  adjust_in: "Adjust in",
  adjust_out: "Adjust out",
};

function purchaseLinkForRow(
  row: ConsumableMovementRecord,
  maps: ConsumableMovementDisplayMaps,
): ConsumableMovementPurchaseLink | null {
  if (row.accounts_payable_id) {
    return maps.payableById[row.accounts_payable_id] ?? null;
  }
  if (row.expense_id) {
    const accrualPayableId =
      maps.accrualExpensePayableIdByExpenseId[row.expense_id];
    if (accrualPayableId) {
      return maps.payableById[accrualPayableId] ?? null;
    }
    return maps.expenseById[row.expense_id] ?? null;
  }
  return null;
}

function toAdjustReason(value: string | null | undefined): AdjustReason {
  if (value && (ADJUST_REASONS as readonly string[]).includes(value)) {
    return value as AdjustReason;
  }
  return ADJUST_REASONS[0]!;
}

function PurchaseLinkCell({
  link,
}: {
  link: ConsumableMovementPurchaseLink | null;
}) {
  if (!link) {
    return <>—</>;
  }
  return (
    <Link
      href={link.href}
      title={link.label}
      className="text-[#0f2744] underline decoration-slate-300 underline-offset-2 hover:decoration-[#0f2744]"
    >
      {link.label}
    </Link>
  );
}

export default function ConsumablesMovementsScreen({
  tenantId,
  initialItems,
  initialMovements,
  sites,
  initialDisplayMaps,
  fetchError,
}: Props) {
  const supabase = createClient();
  const buReadScope = useBusinessUnitReadScope();
  const stampBusinessUnit = useStampBusinessUnitId();
  const { alertError } = useAlert();
  const { toast } = useToast();
  const [movements, setMovements] = useState(initialMovements);
  const [items] = useState(initialItems);
  const [displayMaps, setDisplayMaps] =
    useState<ConsumableMovementDisplayMaps>(initialDisplayMaps);
  const [listError, setListError] = useState<string | null>(fetchError);
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState<RegisterColumnFilterValue>(null);
  const [dateFilter, setDateFilter] =
    useState<RegisterDateRangeFilterValue>(null);
  const [columnSort, setColumnSort] = useState<RegisterColumnSortState | null>(
    () => createRegisterDateSortState("movement_date"),
  );
  const [adjustForm, setAdjustForm] = useState<{
    direction: "in" | "out";
    item_id: string;
    movement_date: string;
    quantity: string;
    reason: AdjustReason;
    notes: string;
  }>({
    direction: "out",
    item_id: "",
    movement_date: new Date().toISOString().slice(0, 10),
    quantity: "",
    reason: ADJUST_REASONS[0]!,
    notes: "",
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    movement_date: string;
    quantity: string;
    unit_cost: string;
    notes: string;
    reason: AdjustReason;
  }>({
    movement_date: "",
    quantity: "",
    unit_cost: "",
    notes: "",
    reason: ADJUST_REASONS[0]!,
  });

  const sitesByCode = useMemo(
    () => new Map(sites.map((s) => [s.site_code, s])),
    [sites],
  );

  const projectLabel = useCallback(
    (row: ConsumableMovementRecord) => {
      if (row.project_id) {
        const site = sites.find((s) => s.project_id === row.project_id);
        if (site?.project_name) {
          return [site.project_code, site.project_name]
            .filter(Boolean)
            .join(" — ");
        }
      }
      const site = row.site_code ? sitesByCode.get(row.site_code) : undefined;
      if (site?.project_name) {
        return [site.project_code, site.project_name].filter(Boolean).join(" — ");
      }
      return row.project_id ?? "—";
    },
    [sites, sitesByCode],
  );

  const itemsById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  );

  const columnSortConfig = useCallback(
    (columnId: string, valueType: "text" | "date" | "number") =>
      registerColumnSortConfig(columnId, valueType, columnSort, setColumnSort),
    [columnSort],
  );

  const filtered = useMemo(() => {
    const rows = movements.filter((row) => {
      if (
        !columnValuePassesFilter(TYPE_LABELS[row.movement_type], typeFilter)
      ) {
        return false;
      }
      return dateValuePassesRangeFilter(
        row.movement_date.slice(0, 10),
        dateFilter,
      );
    });
    const activeSort =
      columnSort ?? createRegisterDateSortState("movement_date");
    return sortRegisterRows(rows, activeSort, (row) => {
      if (activeSort.columnId === "movement_date") return row.movement_date;
      if (activeSort.columnId === "quantity") return row.quantity;
      return TYPE_LABELS[row.movement_type];
    });
  }, [movements, typeFilter, dateFilter, columnSort]);

  async function reload() {
    const result = await refreshConsumableMovements(tenantId, buReadScope);
    if (result.error) {
      setListError(result.error);
      return;
    }
    setMovements(result.movements);
    const mapResult = await refreshConsumableMovementDisplayMaps(
      tenantId,
      result.movements,
    );
    if (mapResult.error) {
      setListError(mapResult.error);
      return;
    }
    setDisplayMaps(mapResult.maps);
    setListError(null);
  }

  function openEdit(row: ConsumableMovementRecord) {
    setEditingId(row.id);
    setEditForm({
      movement_date: toDateInputValue(row.movement_date),
      quantity: String(row.quantity),
      unit_cost:
        row.unit_cost === null || row.unit_cost === undefined
          ? ""
          : String(row.unit_cost),
      notes: row.notes ?? "",
      reason: toAdjustReason(row.reason),
    });
  }

  function closeEdit() {
    setEditingId(null);
  }

  async function handleEditSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingId) return;
    const row = movements.find((m) => m.id === editingId);
    if (!row) return;
    if (!(event.currentTarget as HTMLFormElement).reportValidity()) return;

    const qty = Number(editForm.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      await alertError("Enter a quantity greater than zero.", {
        title: "Invalid quantity",
      });
      return;
    }

    const itemMovements = movements.filter((m) => m.item_id === row.item_id);
    if (
      isInboundMovementType(row.movement_type) &&
      wouldInboundChangeCauseNegativeStock({
        movements: itemMovements,
        targetMovementId: row.id,
        newQuantity: qty,
      })
    ) {
      const item = itemsById.get(row.item_id);
      await alertError(
        `Cannot reduce this receipt: ${item?.name ?? "item"} would go negative because stock was already issued.`,
        { title: "Edit blocked" },
      );
      return;
    }

    setLoading(true);
    try {
      const buContext = await loadWriteBusinessUnitContext(supabase);
      if (!buContext.ok) throw new Error(buContext.error);
      assertCanModifyBusinessUnitRow(
        buContext.allowedUnits,
        row.business_unit_id,
      );

      const payload: Record<string, unknown> = {
        movement_date: editForm.movement_date,
        quantity: qty,
        notes: editForm.notes.trim() || null,
      };
      if (row.movement_type === "receive") {
        const unitCost = Number(editForm.unit_cost);
        if (!Number.isFinite(unitCost) || unitCost < 0) {
          throw new Error("Enter a valid unit cost for a receipt.");
        }
        payload.unit_cost = unitCost;
      }
      if (
        row.movement_type === "adjust_in" ||
        row.movement_type === "adjust_out"
      ) {
        payload.reason = editForm.reason.trim() || null;
      }

      const { error } = await supabase
        .from("consumable_movements")
        .update(payload)
        .eq("id", row.id)
        .eq("tenant_id", tenantId);
      if (error) {
        const item = itemsById.get(row.item_id);
        throw new Error(
          formatConsumablesStockError(error.message, item?.name, item?.unit),
        );
      }
      toast("Movement updated.");
      closeEdit();
      await reload();
    } catch (err) {
      await alertError(err, { title: "Could not update movement" });
    } finally {
      setLoading(false);
    }
  }

  async function handleAdjustSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!(event.currentTarget as HTMLFormElement).reportValidity()) return;
    setLoading(true);
    try {
      const qty = Number(adjustForm.quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error("Enter a quantity greater than zero.");
      }
      const item = itemsById.get(adjustForm.item_id);
      if (!item) throw new Error("Select an item.");
      const rows = movements.filter((m) => m.item_id === adjustForm.item_id);
      const avg = computeWeightedAverageState(rows).averageCost;
      const buContext = await loadWriteBusinessUnitContext(supabase);
      if (!buContext.ok) throw new Error(buContext.error);
      const stampResult = resolveWriteBusinessUnitIdForCreate({
        allowedUnits: buContext.allowedUnits,
        stamp: stampBusinessUnit,
      });
      if (!stampResult.ok) throw new Error(stampResult.error);
      const movementType =
        adjustForm.direction === "in" ? "adjust_in" : "adjust_out";
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error } = await supabase.from("consumable_movements").insert({
        tenant_id: tenantId,
        business_unit_id: stampResult.businessUnitId,
        item_id: adjustForm.item_id,
        movement_type: movementType,
        movement_date: adjustForm.movement_date,
        quantity: qty,
        unit_cost: avg,
        reason: adjustForm.reason,
        notes: adjustForm.notes.trim() || null,
        created_by: user?.id ?? null,
      });
      if (error) {
        throw new Error(
          formatConsumablesStockError(error.message, item.name, item.unit),
        );
      }
      toast("Adjustment recorded.");
      setAdjustForm((f) => ({ ...f, quantity: "", notes: "" }));
      await reload();
    } catch (err) {
      await alertError(err, { title: "Could not adjust stock" });
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(row: ConsumableMovementRecord) {
    if (!(await confirmDeleteEntry())) return;
    const itemMovements = movements.filter((m) => m.item_id === row.item_id);
    if (
      isInboundMovementType(row.movement_type) &&
      wouldInboundChangeCauseNegativeStock({
        movements: itemMovements,
        targetMovementId: row.id,
      })
    ) {
      const item = itemsById.get(row.item_id);
      await alertError(
        `Cannot delete this receipt: ${item?.name ?? "item"} would go negative because stock was already issued.`,
        { title: "Delete blocked" },
      );
      return;
    }
    setLoading(true);
    try {
      const buContext = await loadWriteBusinessUnitContext(supabase);
      if (!buContext.ok) throw new Error(buContext.error);
      assertCanModifyBusinessUnitRow(
        buContext.allowedUnits,
        row.business_unit_id,
      );
      const { error } = await supabase
        .from("consumable_movements")
        .delete()
        .eq("id", row.id)
        .eq("tenant_id", tenantId);
      if (error) {
        await alertError(error.message, { title: "Could not delete movement" });
      } else {
        toast("Movement deleted.");
        if (editingId === row.id) closeEdit();
        await reload();
      }
    } catch (err) {
      await alertError(err, { title: "Could not delete movement" });
    } finally {
      setLoading(false);
    }
  }

  const editingRow = editingId
    ? movements.find((m) => m.id === editingId)
    : null;

  return (
    <div className="space-y-8">
      <ConsumablesScopeSubtitle title="Movements" />
      {listError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {listError}
        </p>
      ) : null}

      {editingRow ? (
        <form
          onSubmit={(e) => void handleEditSubmit(e)}
          className="rounded-lg border border-amber-200 bg-amber-50/50 p-4"
        >
          <h3 className="mb-3 text-sm font-semibold text-[#0f2744]">
            Edit movement — {TYPE_LABELS[editingRow.movement_type]}
          </h3>
          <div className="grid gap-3 md:grid-cols-3">
            <input
              type="date"
              required
              className={consumablesInputClassName}
              value={editForm.movement_date}
              onChange={(e) =>
                setEditForm((f) => ({ ...f, movement_date: e.target.value }))
              }
            />
            <input
              type="number"
              required
              min={0.0001}
              step="any"
              placeholder="Quantity"
              className={consumablesInputClassName}
              value={editForm.quantity}
              onChange={(e) =>
                setEditForm((f) => ({ ...f, quantity: e.target.value }))
              }
            />
            {editingRow.movement_type === "receive" ? (
              <input
                type="number"
                required
                min={0}
                step="0.01"
                placeholder="Unit cost (GHS)"
                className={consumablesInputClassName}
                value={editForm.unit_cost}
                onChange={(e) =>
                  setEditForm((f) => ({ ...f, unit_cost: e.target.value }))
                }
              />
            ) : null}
            {editingRow.movement_type === "adjust_in" ||
            editingRow.movement_type === "adjust_out" ? (
              <select
                required
                className={consumablesInputClassName}
                value={editForm.reason}
                onChange={(e) =>
                  setEditForm((f) => ({
                    ...f,
                    reason: e.target.value as AdjustReason,
                  }))
                }
              >
                {ADJUST_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            ) : null}
            <input
              type="text"
              placeholder="Notes"
              className={consumablesInputClassName}
              value={editForm.notes}
              onChange={(e) =>
                setEditForm((f) => ({ ...f, notes: e.target.value }))
              }
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={loading}
                className={consumablesPrimaryButtonClassName}
              >
                Save
              </button>
              <button
                type="button"
                className="rounded-md border border-slate-300 px-4 py-2 text-sm"
                onClick={closeEdit}
              >
                Cancel
              </button>
            </div>
          </div>
        </form>
      ) : null}

      <form
        onSubmit={(e) => void handleAdjustSubmit(e)}
        className="rounded-lg border border-slate-200 bg-slate-50 p-4"
      >
        <h3 className="mb-3 text-sm font-semibold text-[#0f2744]">
          Stock adjustment
        </h3>
        <div className="grid gap-3 md:grid-cols-3">
          <select
            className={consumablesInputClassName}
            value={adjustForm.direction}
            onChange={(e) =>
              setAdjustForm((f) => ({
                ...f,
                direction: e.target.value as "in" | "out",
              }))
            }
          >
            <option value="out">Adjust out</option>
            <option value="in">Adjust in</option>
          </select>
          <select
            required
            className={consumablesInputClassName}
            value={adjustForm.item_id}
            onChange={(e) =>
              setAdjustForm((f) => ({ ...f, item_id: e.target.value }))
            }
          >
            <option value="">Item</option>
            {items
              .filter((i) => !i.is_archived)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </select>
          <input
            type="date"
            required
            className={consumablesInputClassName}
            value={adjustForm.movement_date}
            onChange={(e) =>
              setAdjustForm((f) => ({ ...f, movement_date: e.target.value }))
            }
          />
          <input
            type="number"
            required
            min={0.0001}
            step="any"
            placeholder="Quantity"
            className={consumablesInputClassName}
            value={adjustForm.quantity}
            onChange={(e) =>
              setAdjustForm((f) => ({ ...f, quantity: e.target.value }))
            }
          />
          <select
            required
            className={consumablesInputClassName}
            value={adjustForm.reason}
            onChange={(e) =>
              setAdjustForm((f) => ({
                ...f,
                reason: e.target.value as AdjustReason,
              }))
            }
          >
            {ADJUST_REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={loading}
            className={consumablesPrimaryButtonClassName}
          >
            Save adjustment
          </button>
        </div>
      </form>
      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>
                <RegisterDateRangeFilterHeader
                  label="Date"
                  applied={dateFilter}
                  onApply={setDateFilter}
                  sort={columnSortConfig("movement_date", "date")}
                />
              </th>
              <th className={scrollableTableThClassName}>
                <RegisterColumnFilterHeader
                  label="Type"
                  options={collectDistinctColumnValues(
                    movements.map((m) => TYPE_LABELS[m.movement_type]),
                  )}
                  applied={typeFilter}
                  onApply={setTypeFilter}
                  sort={columnSortConfig("movement_type", "text")}
                />
              </th>
              <th className={scrollableTableThClassName}>Item</th>
              <th className={scrollableTableThClassName}>Qty</th>
              <th className={scrollableTableThClassName}>Unit</th>
              <th className={scrollableTableThClassName}>Unit cost</th>
              <th className={scrollableTableThClassName}>Value</th>
              <th className={scrollableTableThClassName}>Site</th>
              <th className={scrollableTableThClassName}>Contract / project</th>
              <th className={scrollableTableThClassName}>Supplier</th>
              <th className={scrollableTableThClassName}>Linked purchase</th>
              <th className={scrollableTableThClassName}>Reason</th>
              <th className={scrollableTableThClassName}>Recorded by</th>
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, index) => {
              const item = itemsById.get(row.item_id);
              const value =
                (Number(row.quantity) || 0) * (Number(row.unit_cost) || 0);
              const siteName = row.site_code
                ? (sitesByCode.get(row.site_code)?.site_name ?? row.site_code)
                : "—";
              return (
                <tr key={row.id} className={getStripedRowClassName(index)}>
                  <td className="px-4 py-3 text-sm">
                    {formatDate(row.movement_date)}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {TYPE_LABELS[row.movement_type]}
                  </td>
                  <td className="px-4 py-3 text-sm">{item?.name ?? row.item_id}</td>
                  <td className="px-4 py-3 text-sm">{row.quantity}</td>
                  <td className="px-4 py-3 text-sm">{item?.unit ?? "—"}</td>
                  <td className="px-4 py-3 text-sm">
                    {row.unit_cost != null ? formatGHS(row.unit_cost) : "—"}
                  </td>
                  <td className="px-4 py-3 text-sm">{formatGHS(value)}</td>
                  <td className="px-4 py-3 text-sm">{siteName}</td>
                  <td className="px-4 py-3 text-sm">{projectLabel(row)}</td>
                  <td className="px-4 py-3 text-sm">
                    {row.supplier_id
                      ? (displayMaps.supplierNameById[row.supplier_id] ?? "—")
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <PurchaseLinkCell
                      link={purchaseLinkForRow(row, displayMaps)}
                    />
                  </td>
                  <td className="px-4 py-3 text-sm">{row.reason ?? "—"}</td>
                  <td className="px-4 py-3 text-sm">
                    {row.created_by
                      ? (displayMaps.recordedByByAuthUid[row.created_by] ??
                        "—")
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <RegisterRowActions
                      onEdit={() => openEdit(row)}
                      onDelete={() => void handleDelete(row)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollableTable>
    </div>
  );
}
