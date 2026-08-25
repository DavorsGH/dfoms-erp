"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatMaintenanceMoney } from "@/app/dashboard/real-estate/maintenance-utils";
import type {
  FacilityPropertyOption,
  FacilityServiceRecordRow,
  FacilityUnitOption,
} from "@/utils/facility-portal-types";
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

type FacilityServicesClientProps = {
  properties: FacilityPropertyOption[];
  units: FacilityUnitOption[];
  rows: FacilityServiceRecordRow[];
  totalCostGhs: number;
};

type TabId = "list" | "log";

const SERVICE_TYPE_OPTIONS = [
  { value: "cleaning", label: "Cleaning" },
  { value: "gardening", label: "Gardening" },
  { value: "other", label: "Other" },
] as const;

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function formatServiceType(value: string) {
  const match = SERVICE_TYPE_OPTIONS.find((option) => option.value === value);
  return match?.label ?? value;
}

export default function FacilityServicesClient({
  properties,
  units,
  rows,
  totalCostGhs,
}: FacilityServicesClientProps) {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("list");
  const [propertyId, setPropertyId] = useState(
    properties[0]?.propertyId ?? "",
  );
  const [unitId, setUnitId] = useState("");
  const [serviceType, setServiceType] = useState<string>("cleaning");
  const [serviceDate, setServiceDate] = useState(todayInputValue());
  const [costGhs, setCostGhs] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const unitsForProperty = useMemo(
    () => units.filter((unit) => unit.propertyId === propertyId),
    [units, propertyId],
  );

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/facility-portal/services/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          property_id: propertyId,
          unit_id: unitId || null,
          service_type: serviceType,
          service_date: serviceDate,
          cost_ghs: costGhs.trim() === "" ? null : costGhs,
          notes: notes.trim() === "" ? null : notes,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to log service.");
      }

      setUnitId("");
      setCostGhs("");
      setNotes("");
      setServiceDate(todayInputValue());
      setSuccess("Service logged.");
      setTab("list");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to log service.");
    } finally {
      setLoading(false);
    }
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
          History
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "log"}
          className={portalTabButtonClassName(tab === "log")}
          onClick={() => setTab("log")}
        >
          Log service
        </button>
      </div>

      {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}
      {success ? (
        <div className={portalSuccessBannerClassName}>{success}</div>
      ) : null}

      {tab === "list" ? (
        <>
          <section className={portalCompactSectionClassName}>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Running cost total
            </p>
            <p className="mt-1 text-2xl font-semibold text-[#0f2744]">
              {formatMaintenanceMoney(totalCostGhs)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Sum of logged service costs on your assigned properties.
            </p>
          </section>

          {rows.length === 0 ? (
            <section className={portalCompactSectionClassName}>
              <p className="text-sm text-slate-600">
                No service records yet. Log cleaning, gardening, or other work
                from the Log service tab.
              </p>
            </section>
          ) : (
            <ul className="space-y-3">
              {rows.map((row) => (
                <li key={row.recordId} className={portalCompactSectionClassName}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-[#0f2744]">
                        {formatServiceType(row.serviceType)}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {row.propertyName}
                        {row.unitLabel ? ` · ${row.unitLabel}` : ""}
                      </p>
                      {row.notes ? (
                        <p className="mt-1 text-sm text-slate-700">{row.notes}</p>
                      ) : null}
                    </div>
                    <div className="text-right text-xs text-slate-600">
                      <p>{row.serviceDate}</p>
                      <p className="mt-0.5 font-medium text-slate-900">
                        {formatMaintenanceMoney(row.costGhs)}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <section className={portalCompactSectionClassName}>
          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <label className={portalLabelClassName} htmlFor="svc-property">
                Property
              </label>
              <select
                id="svc-property"
                className={portalInputClassName}
                value={propertyId}
                onChange={(event) => {
                  setPropertyId(event.target.value);
                  setUnitId("");
                }}
                required
              >
                <option value="" disabled>
                  Select property
                </option>
                {properties.map((property) => (
                  <option
                    key={property.propertyId}
                    value={property.propertyId}
                  >
                    {property.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={portalLabelClassName} htmlFor="svc-unit">
                Unit (optional)
              </label>
              <select
                id="svc-unit"
                className={portalInputClassName}
                value={unitId}
                onChange={(event) => setUnitId(event.target.value)}
              >
                <option value="">Whole property</option>
                {unitsForProperty.map((unit) => (
                  <option key={unit.unitId} value={unit.unitId}>
                    {unit.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={portalLabelClassName} htmlFor="svc-type">
                Service type
              </label>
              <select
                id="svc-type"
                className={portalInputClassName}
                value={serviceType}
                onChange={(event) => setServiceType(event.target.value)}
                required
              >
                {SERVICE_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={portalLabelClassName} htmlFor="svc-date">
                Service date
              </label>
              <input
                id="svc-date"
                type="date"
                className={portalInputClassName}
                value={serviceDate}
                onChange={(event) => setServiceDate(event.target.value)}
                required
              />
            </div>
            <div>
              <label className={portalLabelClassName} htmlFor="svc-cost">
                Cost (GHS, optional)
              </label>
              <input
                id="svc-cost"
                type="number"
                min="0"
                step="0.01"
                className={portalInputClassName}
                value={costGhs}
                onChange={(event) => setCostGhs(event.target.value)}
              />
            </div>
            <div>
              <label className={portalLabelClassName} htmlFor="svc-notes">
                Notes (optional)
              </label>
              <textarea
                id="svc-notes"
                className={`${portalInputClassName} min-h-[72px]`}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>
            <button
              type="submit"
              className={portalPrimaryButtonClassName}
              disabled={loading || properties.length === 0}
            >
              {loading ? "Saving…" : "Log service"}
            </button>
            {properties.length === 0 ? (
              <p className="text-sm text-amber-700">
                No properties assigned to your account.
              </p>
            ) : null}
          </form>
        </section>
      )}
    </div>
  );
}
