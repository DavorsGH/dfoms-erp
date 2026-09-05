"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  BU_SELECTION_ALL,
  BU_SELECTION_DEFAULT,
  BU_SELECTION_UNIT,
  BU_SWITCHER_ALL_VALUE,
  BU_SWITCHER_DEFAULT_VALUE,
  STAMP_REFUSED_VIEW_ALL_MESSAGE,
  VIEW_ALL_BUSINESS_UNITS_FIELD,
  resolveBusinessUnitSelection,
  type BusinessUnitSelection,
} from "@/utils/business-unit-view";

export type BusinessUnitSwitcherOption = {
  id: string;
  name: string;
  /** Storage path in tenant-logos (may be null). */
  logo_url: string | null;
  /** Signed URL for sidebar display; null when no BU logo. */
  logoUrl: string | null;
};

type Props = {
  units: BusinessUnitSwitcherOption[];
  /** Scoped BU id; null = workspace default (not All Businesses). */
  activeBusinessUnitId: string | null;
  viewAllBusinessUnits: boolean;
  /** tenants.name — label for the default/untagged option. */
  workspaceName: string;
};

export default function BusinessUnitSwitcher({
  units,
  activeBusinessUnitId,
  viewAllBusinessUnits,
  workspaceName,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<BusinessUnitSelection>(() =>
    resolveBusinessUnitSelection({
      viewAllBusinessUnits,
      activeBusinessUnitId,
    }),
  );
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(
    activeBusinessUnitId,
  );

  useEffect(() => {
    setSelection(
      resolveBusinessUnitSelection({
        viewAllBusinessUnits,
        activeBusinessUnitId,
      }),
    );
    setSelectedUnitId(activeBusinessUnitId);
  }, [activeBusinessUnitId, viewAllBusinessUnits]);

  if (units.length < 1) {
    return null;
  }

  const defaultLabel = workspaceName.trim() || "Workspace";
  const selectValue =
    selection === BU_SELECTION_ALL
      ? BU_SWITCHER_ALL_VALUE
      : selection === BU_SELECTION_DEFAULT
        ? BU_SWITCHER_DEFAULT_VALUE
        : (selectedUnitId ?? BU_SWITCHER_DEFAULT_VALUE);

  async function handleChange(nextValue: string) {
    setError(null);

    let nextSelection: BusinessUnitSelection;
    let nextUnitId: string | null;
    if (nextValue === BU_SWITCHER_ALL_VALUE) {
      nextSelection = BU_SELECTION_ALL;
      nextUnitId = selectedUnitId;
    } else if (nextValue === BU_SWITCHER_DEFAULT_VALUE) {
      nextSelection = BU_SELECTION_DEFAULT;
      nextUnitId = null;
    } else {
      nextSelection = BU_SELECTION_UNIT;
      nextUnitId = nextValue;
    }

    const prevSelection = selection;
    const prevUnitId = selectedUnitId;
    setSelection(nextSelection);
    setSelectedUnitId(nextUnitId);

    try {
      const response = await fetch("/api/account/active-business-unit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selection: nextSelection,
          business_unit_id: nextUnitId,
          // Distinctive field name kept in client payload for guard-262.
          [VIEW_ALL_BUSINESS_UNITS_FIELD]: nextSelection === BU_SELECTION_ALL,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        active_business_unit_id?: string | null;
        view_all_business_units?: boolean;
        selection?: BusinessUnitSelection;
      } | null;

      if (!response.ok) {
        setSelection(prevSelection);
        setSelectedUnitId(prevUnitId);
        setError(payload?.error ?? "Unable to switch business unit.");
        return;
      }

      const resolvedViewAll = payload?.view_all_business_units === true;
      const resolvedUnitId = payload?.active_business_unit_id ?? null;
      setSelection(
        payload?.selection ??
          resolveBusinessUnitSelection({
            viewAllBusinessUnits: resolvedViewAll,
            activeBusinessUnitId: resolvedUnitId,
          }),
      );
      setSelectedUnitId(resolvedUnitId);
      startTransition(() => {
        router.refresh();
      });
    } catch {
      setSelection(prevSelection);
      setSelectedUnitId(prevUnitId);
      setError("Unable to switch business unit.");
    }
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <label className="sr-only" htmlFor="business-unit-switcher">
        Active business unit
      </label>
      <select
        id="business-unit-switcher"
        value={selectValue}
        disabled={pending}
        onChange={(event) => {
          void handleChange(event.target.value);
        }}
        className="max-w-[11rem] cursor-pointer appearance-none truncate rounded-md border border-transparent bg-[#0f2744] bg-[length:1rem] bg-[right_0.5rem_center] bg-no-repeat px-2.5 py-1.5 pr-8 text-sm font-medium text-white shadow-sm outline-none transition-colors hover:bg-[#1a3a5c] focus:ring-2 focus:ring-[#0f2744]/40 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60 sm:max-w-[14rem]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%23ffffff'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E\")",
        }}
        aria-busy={pending}
      >
        <option value={BU_SWITCHER_ALL_VALUE}>All Businesses</option>
        <option value={BU_SWITCHER_DEFAULT_VALUE}>{defaultLabel}</option>
        {units.map((unit) => (
          <option key={unit.id} value={unit.id}>
            {unit.name}
          </option>
        ))}
      </select>
      {selection === BU_SELECTION_ALL ? (
        <p
          className="max-w-[14rem] text-right text-xs text-slate-600"
          title={STAMP_REFUSED_VIEW_ALL_MESSAGE}
        >
          View-only aggregate — pick {defaultLabel} or a business unit to create
          records.
        </p>
      ) : null}
      {error ? (
        <p className="max-w-[14rem] text-right text-xs text-red-700">{error}</p>
      ) : null}
    </div>
  );
}
