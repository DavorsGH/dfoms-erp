import type { BusinessUnitReadScope } from "@/utils/business-unit-view";

/** Read BU from a product-sale cart_snapshot (camelCase stamp). */
export function snapshotBusinessUnitId(
  cartSnapshot: unknown,
): string | null {
  if (!cartSnapshot || typeof cartSnapshot !== "object") {
    return null;
  }
  const value = (cartSnapshot as Record<string, unknown>).businessUnitId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Match a row's business unit to the active switcher scope.
 * Untagged rows stay visible in a unit view (same as many registers).
 */
export function matchesBusinessUnitScope(
  rowBusinessUnitId: string | null,
  buScope: BusinessUnitReadScope,
): boolean {
  if (buScope.mode === "all") {
    return true;
  }
  if (buScope.mode === "unit") {
    return !rowBusinessUnitId || rowBusinessUnitId === buScope.id;
  }
  return !rowBusinessUnitId;
}
