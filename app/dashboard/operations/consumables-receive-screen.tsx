"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { useAlert, useToast } from "@/components/feedback";
import { confirmDialog } from "@/components/feedback/app-dialogs";
import {
  useBusinessUnitReadScope,
  useStampBusinessUnitId,
} from "@/app/dashboard/business-unit-view-context";
import {
  assertCanModifyBusinessUnitRow,
  loadWriteBusinessUnitContext,
  resolveWriteBusinessUnitIdForCreate,
} from "@/utils/business-unit-access";
import { TenantSupplierIdSelect } from "@/components/tenant-supplier-select";
import { formatGHS } from "../finance/income-register-utils";
import { formatDate } from "../hr-payroll/hr-register-utils";
import type { VendorSupplierOption } from "../finance/vendor-select-utils";
import type {
  ExpenseLinkOption,
  PayableLinkOption,
} from "./consumables-store-data";
import ConsumablesPurchaseLinkCombobox from "./consumables-purchase-link-combobox";
import { buildConsumablePurchaseLinkChoices } from "./consumables-purchase-link-utils";
import {
  consumablesInputClassName,
  consumablesPrimaryButtonClassName,
  refreshConsumableMovements,
} from "./consumables-store-client";
import {
  computeWeightedAverageState,
  formatConsumablesMovementSaveError,
  type ConsumableItemRecord,
  type ConsumableMovementRecord,
} from "./consumables-store-utils";
import {
  CONSUMABLES_NO_ITEMS_MESSAGE,
  ConsumablesScopeNotice,
} from "./consumables-empty-scope-messages";
import { formatUnit } from "@/utils/units-of-measure";

type Props = {
  tenantId: string;
  initialItems: ConsumableItemRecord[];
  initialMovements: ConsumableMovementRecord[];
  expenses: ExpenseLinkOption[];
  payables: PayableLinkOption[];
  suppliers: VendorSupplierOption[];
  fetchError: string | null;
};

const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

type LinkValue = { type: "expense" | "payable"; id: string } | null;

export default function ConsumablesReceiveScreen({
  tenantId,
  initialItems,
  initialMovements,
  expenses,
  payables,
  suppliers,
  fetchError,
}: Props) {
  const supabase = createClient();
  const buReadScope = useBusinessUnitReadScope();
  const stampBusinessUnit = useStampBusinessUnitId();
  const { alertError } = useAlert();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [highlightMovementId, setHighlightMovementId] = useState<string | null>(
    null,
  );
  const [form, setForm] = useState({
    item_id: "",
    movement_date: new Date().toISOString().slice(0, 10),
    quantity: "",
    unit_cost: "",
    supplier_id: "",
    link: null as LinkValue,
    notes: "",
  });

  const [movements, setMovements] = useState(initialMovements);

  useEffect(() => {
    setMovements(initialMovements);
  }, [initialMovements]);

  useEffect(() => {
    if (!highlightMovementId) return;
    const timer = window.setTimeout(() => setHighlightMovementId(null), 4000);
    return () => window.clearTimeout(timer);
  }, [highlightMovementId]);

  const activeItems = useMemo(
    () => initialItems.filter((item) => !item.is_archived),
    [initialItems],
  );

  const selectedItem = activeItems.find((item) => item.id === form.item_id);

  const stockSnapshot = useMemo(() => {
    if (!form.item_id) {
      return { onHand: 0, averageCost: 0, stockValue: 0 };
    }
    const rows = movements.filter((m) => m.item_id === form.item_id);
    const { onHand, averageCost } = computeWeightedAverageState(rows);
    return {
      onHand,
      averageCost,
      stockValue: Math.round(onHand * averageCost * 100) / 100,
    };
  }, [form.item_id, movements]);

  const selectedSupplierName = useMemo(
    () => suppliers.find((row) => row.id === form.supplier_id)?.name ?? "",
    [suppliers, form.supplier_id],
  );

  const linkGroups = useMemo(
    () =>
      buildConsumablePurchaseLinkChoices(
        expenses,
        payables,
        suppliers,
        form.supplier_id,
      ),
    [expenses, payables, suppliers, form.supplier_id],
  );

  const allLinkChoices = useMemo(
    () => [...linkGroups.fromSupplier, ...linkGroups.other],
    [linkGroups],
  );

  const selectedLinkChoice = useMemo(
    () =>
      form.link
        ? allLinkChoices.find(
            (row) =>
              row.type === form.link!.type && row.id === form.link!.id,
          ) ?? null
        : null,
    [allLinkChoices, form.link],
  );

  const receiptLineTotal = useMemo(() => {
    const qty = Number(form.quantity);
    const unitCost = Number(form.unit_cost);
    if (!Number.isFinite(qty) || !Number.isFinite(unitCost)) {
      return null;
    }
    return Math.round(qty * unitCost * 100) / 100;
  }, [form.quantity, form.unit_cost]);

  const purchaseTotalMismatchNote = useMemo(() => {
    if (!selectedLinkChoice || receiptLineTotal === null) {
      return null;
    }
    const purchaseTotal = Math.round(selectedLinkChoice.amount * 100) / 100;
    if (Math.abs(purchaseTotal - receiptLineTotal) < 0.005) {
      return null;
    }
    return `Purchase total ${formatGHS(purchaseTotal)}; this receipt ${formatGHS(receiptLineTotal)}`;
  }, [selectedLinkChoice, receiptLineTotal]);

  const recentReceipts = useMemo(() => {
    return movements
      .filter((row) => row.movement_type === "receive")
      .slice(0, 10);
  }, [movements]);

  const itemsById = useMemo(
    () => new Map(activeItems.map((item) => [item.id, item])),
    [activeItems],
  );

  async function findDuplicateReceive(): Promise<ConsumableMovementRecord | null> {
    const qty = Number(form.quantity);
    const unitCost = Number(form.unit_cost);
    if (
      !form.item_id ||
      !form.supplier_id ||
      !form.movement_date ||
      !Number.isFinite(qty) ||
      !Number.isFinite(unitCost)
    ) {
      return null;
    }
    const cutoff = Date.now() - DUPLICATE_WINDOW_MS;
    for (const row of movements) {
      if (row.movement_type !== "receive") continue;
      const createdAt = row.created_at
        ? new Date(row.created_at).getTime()
        : 0;
      if (createdAt < cutoff) continue;
      if (row.item_id !== form.item_id) continue;
      if (row.supplier_id !== form.supplier_id) continue;
      if (row.movement_date.slice(0, 10) !== form.movement_date) continue;
      if (Number(row.quantity) !== qty) continue;
      if (Number(row.unit_cost) !== unitCost) continue;
      return row;
    }
    return null;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;

    const duplicate = await findDuplicateReceive();
    if (duplicate) {
      const when = duplicate.created_at
        ? new Date(duplicate.created_at).toLocaleString()
        : "recently";
      const ok = await confirmDialog({
        title: "Duplicate receipt?",
        message: `This looks the same as a receipt saved at ${when}. Save again?`,
      });
      if (!ok) return;
    }

    setLoading(true);
    try {
      const qty = Number(form.quantity);
      const unitCost = Number(form.unit_cost);
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error("Enter a quantity greater than zero.");
      }
      if (!Number.isFinite(unitCost) || unitCost < 0) {
        throw new Error("Enter a valid unit cost.");
      }
      const buContext = await loadWriteBusinessUnitContext(supabase);
      if (!buContext.ok) throw new Error(buContext.error);
      const stampResult = resolveWriteBusinessUnitIdForCreate({
        allowedUnits: buContext.allowedUnits,
        stamp: stampBusinessUnit,
      });
      if (!stampResult.ok) throw new Error(stampResult.error);
      assertCanModifyBusinessUnitRow(
        buContext.allowedUnits,
        stampResult.businessUnitId,
      );
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const link = form.link;
      const payload = {
        tenant_id: tenantId,
        business_unit_id: stampResult.businessUnitId,
        item_id: form.item_id,
        movement_type: "receive" as const,
        movement_date: form.movement_date,
        quantity: qty,
        unit_cost: unitCost,
        expense_id: link?.type === "expense" ? link.id : null,
        accounts_payable_id: link?.type === "payable" ? link.id : null,
        supplier_id: form.supplier_id,
        notes: form.notes.trim() || null,
        created_by: user?.id ?? null,
      };
      const { data: inserted, error } = await supabase
        .from("consumable_movements")
        .insert(payload)
        .select("id")
        .single();
      if (error) {
        throw new Error(
          formatConsumablesMovementSaveError(
            error,
            selectedItem?.name,
            selectedItem?.unit,
          ),
        );
      }
      toast("Stock received.");
      if (inserted?.id) {
        setHighlightMovementId(String(inserted.id));
      }
      setForm((f) => ({
        ...f,
        item_id: "",
        quantity: "",
        unit_cost: "",
        link: null,
        notes: "",
      }));
      const refreshed = await refreshConsumableMovements(tenantId, buReadScope);
      if (!refreshed.error) {
        setMovements(refreshed.movements);
      }
    } catch (err) {
      await alertError(err, { title: "Could not receive stock" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {fetchError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {fetchError}
        </p>
      ) : null}
      {activeItems.length === 0 ? (
        <ConsumablesScopeNotice message={CONSUMABLES_NO_ITEMS_MESSAGE} />
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
        >
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Item</span>
            <select
              required
              className={consumablesInputClassName}
              value={form.item_id}
              onChange={(e) =>
                setForm((f) => ({ ...f, item_id: e.target.value }))
              }
            >
              <option value="">Select item</option>
              {activeItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.item_code} — {item.name}
                </option>
              ))}
            </select>
            {selectedItem ? (
              <span className="mt-1 block text-xs text-slate-600">
                In store: {stockSnapshot.onHand}{" "}
                {formatUnit(selectedItem.unit) || "units"}
                {stockSnapshot.onHand > 0
                  ? ` · avg ${formatGHS(stockSnapshot.averageCost)} · value ${formatGHS(stockSnapshot.stockValue)}`
                  : ""}
              </span>
            ) : null}
          </label>
          <p className="text-sm text-slate-600">
            <Link
              href="/dashboard/operations/consumables/items"
              className="text-[#0f2744] underline"
            >
              Add new item
            </Link>
          </p>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Date</span>
            <input
              type="date"
              required
              className={consumablesInputClassName}
              value={form.movement_date}
              onChange={(e) =>
                setForm((f) => ({ ...f, movement_date: e.target.value }))
              }
            />
          </label>
          <TenantSupplierIdSelect
            required
            allowEmpty={false}
            suppliers={suppliers}
            value={form.supplier_id}
            onChange={(supplierId) =>
              setForm((f) => ({ ...f, supplier_id: supplierId }))
            }
            className={consumablesInputClassName}
          />
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Quantity</span>
              <input
                type="number"
                required
                min={0.0001}
                step="any"
                className={consumablesInputClassName}
                value={form.quantity}
                onChange={(e) =>
                  setForm((f) => ({ ...f, quantity: e.target.value }))
                }
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Unit cost (GHS)</span>
              <input
                type="number"
                required
                min={0}
                step="0.01"
                className={consumablesInputClassName}
                value={form.unit_cost}
                onChange={(e) =>
                  setForm((f) => ({ ...f, unit_cost: e.target.value }))
                }
              />
            </label>
          </div>
          <div className="space-y-2">
            <span className="block text-sm font-medium">
              Link to expense or bill (optional)
            </span>
            <p className="text-xs text-slate-600">
              Optional. Pick the expense or bill that paid for this stock. Shows
              purchases from the last 120 days in this business unit.
            </p>
            <ConsumablesPurchaseLinkCombobox
              value={form.link}
              onChange={(link) => setForm((f) => ({ ...f, link }))}
              fromSupplier={linkGroups.fromSupplier}
              other={linkGroups.other}
              supplierName={selectedSupplierName}
              disabled={loading}
            />
            {purchaseTotalMismatchNote ? (
              <p className="text-xs text-amber-800">{purchaseTotalMismatchNote}</p>
            ) : null}
          </div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Notes</span>
            <textarea
              className={consumablesInputClassName}
              rows={2}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            className={consumablesPrimaryButtonClassName}
          >
            {loading ? "Saving…" : "Receive into store"}
          </button>
        </form>

        <aside className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-[#0f2744]">
            Recent receipts
          </h3>
          {recentReceipts.length === 0 ? (
            <p className="text-sm text-slate-500">No receipts yet.</p>
          ) : (
            <ul className="space-y-2">
              {recentReceipts.map((row) => {
                const item = itemsById.get(row.item_id);
                const value =
                  (Number(row.quantity) || 0) * (Number(row.unit_cost) || 0);
                const supplierName = row.supplier_id
                  ? (suppliers.find((s) => s.id === row.supplier_id)?.name ??
                    "—")
                  : "—";
                const highlighted = row.id === highlightMovementId;
                return (
                  <li
                    key={row.id}
                    className={`rounded-md border px-3 py-2 text-xs transition-colors ${
                      highlighted
                        ? "border-emerald-300 bg-emerald-50"
                        : "border-slate-100 bg-slate-50"
                    }`}
                  >
                    <div className="font-medium text-slate-800">
                      {formatDate(row.movement_date)}
                    </div>
                    <div className="text-slate-700">{item?.name ?? "Item"}</div>
                    <div className="text-slate-600">
                      {row.quantity} {formatUnit(item?.unit) || "units"} ·{" "}
                      {formatGHS(row.unit_cost ?? 0)} · {formatGHS(value)}
                    </div>
                    <div className="text-slate-500">{supplierName}</div>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
