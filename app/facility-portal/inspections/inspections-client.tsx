"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ActiveLeaseOption } from "@/app/dashboard/real-estate/maintenance-utils";
import {
  INSPECTION_CONDITION_OPTIONS,
  INSPECTION_TYPE_OPTIONS,
  createDefaultInspectionChecklist,
  formatInspectionDate,
  formatInspectionType,
  type InspectionChecklistItem,
  type InspectionCondition,
} from "@/app/dashboard/real-estate/inspections-utils";
import type { FacilityInspectionListRow } from "@/utils/facility-portal-types";
import {
  portalCompactSectionClassName,
  portalErrorBannerClassName,
  portalInputClassName,
  portalLabelClassName,
  portalPrimaryButtonClassName,
  portalSuccessBannerClassName,
  portalTabBarClassName,
  portalTabButtonClassName,
} from "../portal-ui";

type FacilityInspectionsClientProps = {
  rows: FacilityInspectionListRow[];
  leases: ActiveLeaseOption[];
  conductedByDefault: string;
};

type TabId = "list" | "create";

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

export default function FacilityInspectionsClient({
  rows,
  leases,
  conductedByDefault,
}: FacilityInspectionsClientProps) {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("list");
  const [leaseId, setLeaseId] = useState(leases[0]?.leaseId ?? "");
  const [inspectionType, setInspectionType] = useState("move_in");
  const [inspectionDate, setInspectionDate] = useState(todayInputValue());
  const [notes, setNotes] = useState("");
  const [checklist, setChecklist] = useState<InspectionChecklistItem[]>(() =>
    createDefaultInspectionChecklist(),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function updateChecklistItem(
    index: number,
    patch: Partial<InspectionChecklistItem>,
  ) {
    setChecklist((current) =>
      current.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/facility-portal/inspections/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lease_id: leaseId,
        inspection_type: inspectionType,
        inspection_date: inspectionDate,
        notes: notes.trim() === "" ? null : notes,
        checklist,
      }),
    });
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to create inspection.");
      setLoading(false);
      return;
    }

    setNotes("");
    setChecklist(createDefaultInspectionChecklist());
    setInspectionDate(todayInputValue());
    setSuccess("Inspection recorded.");
    setTab("list");
    setLoading(false);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className={portalTabBarClassName} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "list"}
          className={portalTabButtonClassName(tab === "list")}
          onClick={() => setTab("list")}
        >
          Inspections
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "create"}
          className={portalTabButtonClassName(tab === "create")}
          onClick={() => setTab("create")}
        >
          New inspection
        </button>
      </div>

      {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}
      {success ? (
        <div className={portalSuccessBannerClassName}>{success}</div>
      ) : null}

      {tab === "create" ? (
        <section className={portalCompactSectionClassName}>
          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <label className={portalLabelClassName} htmlFor="fm-insp-lease">
                Lease
              </label>
              <select
                id="fm-insp-lease"
                className={portalInputClassName}
                value={leaseId}
                onChange={(event) => setLeaseId(event.target.value)}
                required
              >
                <option value="" disabled>
                  Select lease
                </option>
                {leases.map((lease) => (
                  <option key={lease.leaseId} value={lease.leaseId}>
                    {lease.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={portalLabelClassName} htmlFor="fm-insp-type">
                  Type
                </label>
                <select
                  id="fm-insp-type"
                  className={portalInputClassName}
                  value={inspectionType}
                  onChange={(event) => setInspectionType(event.target.value)}
                  required
                >
                  {INSPECTION_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={portalLabelClassName} htmlFor="fm-insp-date">
                  Date
                </label>
                <input
                  id="fm-insp-date"
                  type="date"
                  className={portalInputClassName}
                  value={inspectionDate}
                  onChange={(event) => setInspectionDate(event.target.value)}
                  required
                />
              </div>
            </div>
            <p className="text-xs text-slate-500">
              Conducted by: {conductedByDefault}
            </p>
            <div>
              <label className={portalLabelClassName} htmlFor="fm-insp-notes">
                Notes (optional)
              </label>
              <textarea
                id="fm-insp-notes"
                className={`${portalInputClassName} min-h-[72px]`}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <p className={portalLabelClassName}>Checklist</p>
              {checklist.map((item, index) => (
                <div
                  key={`${item.name}-${index}`}
                  className="grid gap-2 rounded-md border border-slate-200 p-2 sm:grid-cols-[1fr_auto]"
                >
                  <p className="text-sm font-medium text-slate-800">{item.name}</p>
                  <select
                    className={portalInputClassName}
                    value={item.condition}
                    onChange={(event) =>
                      updateChecklistItem(index, {
                        condition: event.target.value as InspectionCondition,
                      })
                    }
                  >
                    {INSPECTION_CONDITION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <input
                    className={`${portalInputClassName} sm:col-span-2`}
                    placeholder="Note (optional)"
                    value={item.note}
                    onChange={(event) =>
                      updateChecklistItem(index, { note: event.target.value })
                    }
                  />
                </div>
              ))}
            </div>
            <button
              type="submit"
              className={portalPrimaryButtonClassName}
              disabled={loading || leases.length === 0}
            >
              {loading ? "Saving…" : "Save inspection"}
            </button>
          </form>
        </section>
      ) : rows.length === 0 ? (
        <section className={portalCompactSectionClassName}>
          <p className="text-sm text-slate-600">
            No inspections for your assigned properties yet.
          </p>
        </section>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.inspectionId} className={portalCompactSectionClassName}>
              <p className="text-sm font-medium text-[#0f2744]">
                {formatInspectionType(row.inspectionType)} · {row.dateLabel}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {row.lesseeName} · {row.unitLabel}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                Conducted by {row.conductedBy ?? "—"} ·{" "}
                {row.checklistItemCount} checklist items
              </p>
              {row.notes ? (
                <p className="mt-1 text-sm text-slate-700">{row.notes}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
