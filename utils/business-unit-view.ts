/**
 * Business-unit view / stamp helpers (client-safe).
 *
 * Separates:
 *   - All Businesses (aggregate, view-only — not a stamp target)
 *   - Workspace default (active_business_unit_id null — untagged/legacy rows)
 *   - Specific business unit (uuid)
 *
 * Distinctive string constants below are intentional guard-262 scan markers.
 */

/** DB / API field name — distinctive Phase-6-prep marker. */
export const VIEW_ALL_BUSINESS_UNITS_FIELD =
  "view_all_business_units" as const;

/** Switcher / API selection literals — distinctive Phase-6-prep markers. */
export const BU_SELECTION_ALL = "all" as const;
export const BU_SELECTION_DEFAULT = "default" as const;
export const BU_SELECTION_UNIT = "unit" as const;

export type BusinessUnitSelection =
  | typeof BU_SELECTION_ALL
  | typeof BU_SELECTION_DEFAULT
  | typeof BU_SELECTION_UNIT;

/**
 * Shown when create/upsert is attempted while All Businesses is selected.
 * Distinctive guard-262 marker (must stay unique in the repo).
 */
export const STAMP_REFUSED_VIEW_ALL_MESSAGE =
  "Pick your workspace or a business unit before creating records. All Businesses is view-only (dfoms-bu-view-all-no-stamp) and cannot stamp new rows." as const;

/**
 * Lock Period when All Businesses is selected and the tenant has active BUs.
 * Distinctive guard-262 marker.
 */
export const LOCK_REQUIRES_SCOPED_BU_MESSAGE =
  "Select your workspace default or a specific business before locking payroll. Locking while All Businesses is selected (dfoms-bu-view-all-no-lock) is not allowed when this workspace has business units." as const;

/** @deprecated Use LOCK_REQUIRES_SCOPED_BU_MESSAGE — kept as alias during Phase 5e→6 prep. */
export const LOCK_REQUIRES_SPECIFIC_BU_MESSAGE =
  LOCK_REQUIRES_SCOPED_BU_MESSAGE;

export type BusinessUnitReadScope =
  | { mode: "all" }
  | { mode: "default" }
  | { mode: "unit"; id: string };

export function resolveBusinessUnitSelection(args: {
  viewAllBusinessUnits: boolean;
  activeBusinessUnitId: string | null;
}): BusinessUnitSelection {
  if (args.viewAllBusinessUnits) return BU_SELECTION_ALL;
  if (args.activeBusinessUnitId) return BU_SELECTION_UNIT;
  return BU_SELECTION_DEFAULT;
}

export function resolveBusinessUnitReadScope(args: {
  viewAllBusinessUnits: boolean;
  activeBusinessUnitId: string | null;
}): BusinessUnitReadScope {
  if (args.viewAllBusinessUnits) return { mode: "all" };
  if (args.activeBusinessUnitId) {
    return { mode: "unit", id: args.activeBusinessUnitId };
  }
  return { mode: "default" };
}

/**
 * Stamp target for creates, or refuse when viewing All Businesses.
 */
export function resolveStampBusinessUnitId(args: {
  viewAllBusinessUnits: boolean;
  activeBusinessUnitId: string | null;
}):
  | { ok: true; businessUnitId: string | null }
  | { ok: false; error: typeof STAMP_REFUSED_VIEW_ALL_MESSAGE } {
  if (args.viewAllBusinessUnits) {
    return { ok: false, error: STAMP_REFUSED_VIEW_ALL_MESSAGE };
  }
  return { ok: true, businessUnitId: activeBusinessUnitIdOrNull(args.activeBusinessUnitId) };
}

function activeBusinessUnitIdOrNull(id: string | null | undefined): string | null {
  if (id == null) return null;
  const trimmed = String(id).trim();
  return trimmed || null;
}

/** Switcher option values (not UUIDs). */
export const BU_SWITCHER_ALL_VALUE = "__all__" as const;
export const BU_SWITCHER_DEFAULT_VALUE = "__default__" as const;
