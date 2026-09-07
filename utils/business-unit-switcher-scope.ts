import type { BusinessUnitSwitcherOption } from "@/app/dashboard/business-unit-switcher";
import type { AllowedBusinessUnits } from "@/utils/business-unit-access";

export function canViewAllBusinessUnits(
  allowedUnits: AllowedBusinessUnits,
): boolean {
  return allowedUnits === null;
}

export function filterSwitcherUnitsForUser(
  units: BusinessUnitSwitcherOption[],
  allowedUnits: AllowedBusinessUnits,
): BusinessUnitSwitcherOption[] {
  if (allowedUnits === null) {
    return units;
  }

  const allowed = new Set(allowedUnits.businessUnitIds);
  return units.filter((unit) => allowed.has(unit.id));
}

export function resolveRestrictedActiveBusinessUnitId(
  allowedUnits: AllowedBusinessUnits,
  activeBusinessUnitId: string | null,
): string | null {
  if (allowedUnits === null) {
    return activeBusinessUnitId;
  }

  const allowedSet = new Set(allowedUnits.businessUnitIds);
  if (activeBusinessUnitId && allowedSet.has(activeBusinessUnitId)) {
    return activeBusinessUnitId;
  }

  const defaultId = allowedUnits.defaultBusinessUnitId?.trim() || null;
  if (defaultId && allowedSet.has(defaultId)) {
    return defaultId;
  }

  return allowedUnits.businessUnitIds[0] ?? null;
}

export function resolveEffectiveSwitcherState(args: {
  units: BusinessUnitSwitcherOption[];
  allowedUnits: AllowedBusinessUnits;
  activeBusinessUnitId: string | null;
  viewAllBusinessUnits: boolean;
}): {
  units: BusinessUnitSwitcherOption[];
  activeBusinessUnitId: string | null;
  viewAllBusinessUnits: boolean;
  allowViewAll: boolean;
} {
  const allowViewAll = canViewAllBusinessUnits(args.allowedUnits);
  const units = filterSwitcherUnitsForUser(args.units, args.allowedUnits);

  if (allowViewAll) {
    const activeStillListed =
      args.activeBusinessUnitId &&
      units.some((unit) => unit.id === args.activeBusinessUnitId)
        ? args.activeBusinessUnitId
        : null;

    return {
      units,
      activeBusinessUnitId: activeStillListed,
      viewAllBusinessUnits: args.viewAllBusinessUnits,
      allowViewAll: true,
    };
  }

  return {
    units,
    activeBusinessUnitId: resolveRestrictedActiveBusinessUnitId(
      args.allowedUnits,
      args.activeBusinessUnitId,
    ),
    viewAllBusinessUnits: false,
    allowViewAll: false,
  };
}
