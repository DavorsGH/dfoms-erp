"use client";

import { useBusinessUnitView } from "@/app/dashboard/business-unit-view-context";

export function useConsumablesScopeSubtitle(title: string): string {
  const { viewAllBusinessUnits, activeBusinessUnitId, units } =
    useBusinessUnitView();
  if (viewAllBusinessUnits) {
    return `${title} - All businesses`;
  }
  const unitName = units
    .find((unit) => unit.id === activeBusinessUnitId)
    ?.name?.trim();
  if (unitName) {
    return `${title} - ${unitName}`;
  }
  return title;
}

export function ConsumablesScopeSubtitle({ title }: { title: string }) {
  const subtitle = useConsumablesScopeSubtitle(title);
  return <p className="text-sm text-slate-600">{subtitle}</p>;
}
