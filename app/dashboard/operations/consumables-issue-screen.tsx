"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { useAlert, useToast } from "@/components/feedback";
import { confirmDialog } from "@/components/feedback/app-dialogs";
import {
  useStampBusinessUnitId,
  useBusinessUnitReadScope,
} from "@/app/dashboard/business-unit-view-context";
import {
  assertCanModifyBusinessUnitRow,
  loadWriteBusinessUnitContext,
  resolveWriteBusinessUnitIdForCreate,
} from "@/utils/business-unit-access";
import type { ConsumableSiteOption } from "./consumables-store-data";
import {
  computeWeightedAverageState,
  formatConsumablesStockError,
  type ConsumableItemRecord,
  type ConsumableMovementRecord,
} from "./consumables-store-utils";
import {
  consumablesInputClassName,
  consumablesPrimaryButtonClassName,
  refreshConsumableMovements,
} from "./consumables-store-client";
import {
  CONSUMABLES_NO_ITEMS_MESSAGE,
  CONSUMABLES_NO_SITES_MESSAGE,
  ConsumablesScopeNotice,
} from "./consumables-empty-scope-messages";
import { formatDate } from "../hr-payroll/hr-register-utils";
import { formatUnit } from "@/utils/units-of-measure";

type Props = {
  tenantId: string;
  initialItems: ConsumableItemRecord[];
  initialMovements: ConsumableMovementRecord[];
  sites: ConsumableSiteOption[];
  fetchError: string | null;
};

const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

const TYPE_LABELS = {
  issue: "Issue",
  return: "Return",
} as const;

export default function ConsumablesIssueScreen({
  tenantId,
  initialItems,
  initialMovements,
  sites,
  fetchError,
}: Props) {
  const supabase = createClient();
  const buReadScope = useBusinessUnitReadScope();
  const stampBusinessUnit = useStampBusinessUnitId();
  const { alertError } = useAlert();
  const { toast } = useToast();
  const [movements, setMovements] = useState(initialMovements);
  const [loading, setLoading] = useState(false);
  const [highlightMovementId, setHighlightMovementId] = useState<string | null>(
    null,
  );
  const [mode, setMode] = useState<"issue" | "return">("issue");
  const [form, setForm] = useState({
    item_id: "",
    movement_date: new Date().toISOString().slice(0, 10),
    site_code: "",
    quantity: "",
    notes: "",
  });

  const activeItems = useMemo(
    () => initialItems.filter((item) => !item.is_archived),
    [initialItems],
  );

  const selectedItem = activeItems.find((item) => item.id === form.item_id);

  useEffect(() => {
    setMovements(initialMovements);
  }, [initialMovements]);

  useEffect(() => {
    if (!highlightMovementId) return;
    const timer = window.setTimeout(() => setHighlightMovementId(null), 4000);
    return () => window.clearTimeout(timer);
  }, [highlightMovementId]);

  const onHand = useMemo(() => {
    if (!form.item_id) return 0;
    const rows = movements.filter((m) => m.item_id === form.item_id);
    return computeWeightedAverageState(rows).onHand;
  }, [form.item_id, movements]);

  const averageCost = useMemo(() => {
    if (!form.item_id) return 0;
    const rows = movements.filter((m) => m.item_id === form.item_id);
    return computeWeightedAverageState(rows).averageCost;
  }, [form.item_id, movements]);

  const recentSiteMovements = useMemo(() => {
    return movements
      .filter(
        (row) => row.movement_type === "issue" || row.movement_type === "return",
      )
      .slice(0, 10);
  }, [movements]);

  const itemsById = useMemo(
    () => new Map(activeItems.map((item) => [item.id, item])),
    [activeItems],
  );

  const sitesByCode = useMemo(
    () => new Map(sites.map((site) => [site.site_code, site])),
    [sites],
  );

  function projectLabelForRow(row: ConsumableMovementRecord): string {
    const site = row.site_code ? sitesByCode.get(row.site_code) : undefined;
    if (site?.project_name) {
      return [site.project_code, site.project_name].filter(Boolean).join(" — ");
    }
    return "—";
  }

  async function findDuplicate(): Promise<ConsumableMovementRecord | null> {
    const qty = Number(form.quantity);
    if (
      !form.item_id ||
      !form.site_code ||
      !form.movement_date ||
      !Number.isFinite(qty)
    ) {
      return null;
    }
    const cutoff = Date.now() - DUPLICATE_WINDOW_MS;
    for (const row of movements) {
      if (row.movement_type !== mode) continue;
      const createdAt = row.created_at
        ? new Date(row.created_at).getTime()
        : 0;
      if (createdAt < cutoff) continue;
      if (row.item_id !== form.item_id) continue;
      if (row.site_code !== form.site_code) continue;
      if (row.movement_date.slice(0, 10) !== form.movement_date) continue;
      if (Number(row.quantity) !== qty) continue;
      return row;
    }
    return null;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;

    const duplicate = await findDuplicate();
    if (duplicate) {
      const when = duplicate.created_at
        ? new Date(duplicate.created_at).toLocaleString()
        : "recently";
      const ok = await confirmDialog({
        title: "Duplicate movement?",
        message: `This looks the same as a ${TYPE_LABELS[mode].toLowerCase()} saved at ${when}. Save again?`,
      });
      if (!ok) return;
    }

    setLoading(true);
    try {
      const qty = Number(form.quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error("Enter a quantity greater than zero.");
      }
      const site = sites.find((s) => s.site_code === form.site_code);
      if (!site) {
        throw new Error("Select a site.");
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
      const payload = {
        tenant_id: tenantId,
        business_unit_id: stampResult.businessUnitId,
        item_id: form.item_id,
        movement_type: mode,
        movement_date: form.movement_date,
        quantity: qty,
        unit_cost: averageCost,
        site_code: form.site_code,
        project_id: site.project_id,
        notes: form.notes.trim() || null,
        created_by: user?.id ?? null,
      };
      const { data: inserted, error } = await supabase
        .from("consumable_movements")
        .insert(payload)
        .select("id")
        .single();
      if (error) {
        const friendly = formatConsumablesStockError(
          error.message,
          selectedItem?.name,
          selectedItem?.unit,
        );
        throw new Error(friendly);
      }
      toast(mode === "issue" ? "Issued to site." : "Returned from site.");
      if (inserted?.id) {
        setHighlightMovementId(String(inserted.id));
      }
      setForm((f) => ({ ...f, item_id: "", quantity: "", notes: "" }));
      const refreshed = await refreshConsumableMovements(tenantId, buReadScope);
      if (!refreshed.error) {
        setMovements(refreshed.movements);
      }
    } catch (err) {
      await alertError(err, {
        title:
          mode === "issue" ? "Could not issue stock" : "Could not return stock",
      });
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
      {sites.length === 0 ? (
        <ConsumablesScopeNotice message={CONSUMABLES_NO_SITES_MESSAGE} />
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          className={`rounded-md px-3 py-1.5 text-sm ${mode === "issue" ? "bg-[#0f2744] text-white" : "bg-slate-100"}`}
          onClick={() => setMode("issue")}
        >
          Issue to site
        </button>
        <button
          type="button"
          className={`rounded-md px-3 py-1.5 text-sm ${mode === "return" ? "bg-[#0f2744] text-white" : "bg-slate-100"}`}
          onClick={() => setMode("return")}
        >
          Return from site
        </button>
      </div>
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
                In store: {onHand} {formatUnit(selectedItem.unit) || "units"}{" "}
                (avg cost applied on save)
              </span>
            ) : null}
          </label>
          {sites.length > 0 ? (
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Site</span>
              <select
                required
                className={consumablesInputClassName}
                value={form.site_code}
                onChange={(e) =>
                  setForm((f) => ({ ...f, site_code: e.target.value }))
                }
              >
                <option value="">Select site</option>
                {sites.map((site) => (
                  <option key={site.site_code} value={site.site_code}>
                    {site.site_name}
                    {site.project_name ? ` (${site.project_name})` : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
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
            disabled={
              loading || activeItems.length === 0 || sites.length === 0
            }
            className={consumablesPrimaryButtonClassName}
          >
            {loading ? "Saving…" : mode === "issue" ? "Issue" : "Return"}
          </button>
        </form>

        <aside className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-[#0f2744]">
            Recent issues
          </h3>
          {recentSiteMovements.length === 0 ? (
            <p className="text-sm text-slate-500">No issues or returns yet.</p>
          ) : (
            <ul className="space-y-2">
              {recentSiteMovements.map((row) => {
                const item = itemsById.get(row.item_id);
                const siteName = row.site_code
                  ? (sitesByCode.get(row.site_code)?.site_name ?? row.site_code)
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
                      {formatDate(row.movement_date)} ·{" "}
                      {TYPE_LABELS[row.movement_type as "issue" | "return"] ??
                        row.movement_type}
                    </div>
                    <div className="text-slate-700">{item?.name ?? "Item"}</div>
                    <div className="text-slate-600">
                      {row.quantity} {formatUnit(item?.unit) || "units"}
                    </div>
                    <div className="text-slate-500">
                      {siteName} · {projectLabelForRow(row)}
                    </div>
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
