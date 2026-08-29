"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

export type BusinessUnitSwitcherOption = {
  id: string;
  name: string;
};

type Props = {
  units: BusinessUnitSwitcherOption[];
  /** null = All Businesses */
  activeBusinessUnitId: string | null;
};

const ALL_VALUE = "__all__";

export default function BusinessUnitSwitcher({
  units,
  activeBusinessUnitId,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    activeBusinessUnitId,
  );

  useEffect(() => {
    setSelectedId(activeBusinessUnitId);
  }, [activeBusinessUnitId]);

  if (units.length < 1) {
    return null;
  }

  const selectValue = selectedId ?? ALL_VALUE;

  async function handleChange(nextValue: string) {
    const nextId = nextValue === ALL_VALUE ? null : nextValue;
    setError(null);
    setSelectedId(nextId);

    try {
      const response = await fetch("/api/account/active-business-unit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_unit_id: nextId }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        active_business_unit_id?: string | null;
      } | null;

      if (!response.ok) {
        setSelectedId(activeBusinessUnitId);
        setError(payload?.error ?? "Unable to switch business unit.");
        return;
      }

      setSelectedId(payload?.active_business_unit_id ?? null);
      startTransition(() => {
        router.refresh();
      });
    } catch {
      setSelectedId(activeBusinessUnitId);
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
        className="max-w-[11rem] truncate rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-[#0f2744] shadow-sm outline-none transition-colors hover:border-slate-300 focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744] disabled:opacity-60 sm:max-w-[14rem]"
        aria-busy={pending}
      >
        <option value={ALL_VALUE}>All Businesses</option>
        {units.map((unit) => (
          <option key={unit.id} value={unit.id}>
            {unit.name}
          </option>
        ))}
      </select>
      {error ? (
        <p className="max-w-[14rem] text-right text-xs text-red-700">{error}</p>
      ) : null}
    </div>
  );
}
