/**
 * Server-only Phase 5e lock / write helpers.
 * Pure onConflict + scope helpers: `@/utils/phase5e-key-structure`.
 * View/stamp constants: `@/utils/business-unit-view`.
 */
import "server-only";

import { cache } from "react";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  getActiveBusinessUnitId,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { LOCK_REQUIRES_SCOPED_BU_MESSAGE } from "@/utils/business-unit-view";

/** Active BU for scoped writes/filters — null is valid (workspace default row). */
export async function resolveWriteBusinessUnitId(): Promise<string | null> {
  return getActiveBusinessUnitId();
}

export const countActiveBusinessUnitsForTenant = cache(
  async (tenantId: string): Promise<number> => {
    const admin = createAdminClient();
    const { count } = await admin
      .from("business_units")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("is_active", true);
    return count ?? 0;
  },
);

/**
 * Lock Period only: block when tenant has ≥1 active BU and user is on All Businesses.
 * Workspace default (null + view_all false) and specific BUs are allowed.
 * Zero-BU tenants always allowed.
 */
export async function assertLockBusinessUnitAllowed(
  tenantId: string,
  activeBusinessUnitId: string | null,
  viewAllBusinessUnits?: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const activeCount = await countActiveBusinessUnitsForTenant(tenantId);
  if (activeCount < 1) {
    return { ok: true };
  }

  const viewAll =
    viewAllBusinessUnits === undefined
      ? await getViewAllBusinessUnits()
      : viewAllBusinessUnits;

  if (viewAll) {
    return { ok: false, error: LOCK_REQUIRES_SCOPED_BU_MESSAGE };
  }

  // Scoped default (null) or a concrete BU — both OK for lock.
  void activeBusinessUnitId;
  return { ok: true };
}

export async function assertLockBusinessUnitAllowedForCurrentUser(
  activeBusinessUnitId?: string | null,
  viewAllBusinessUnits?: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const tenantId = await getCurrentUserTenantId();
  if (!tenantId) {
    return { ok: false, error: "Unauthorized" };
  }
  const buId =
    activeBusinessUnitId === undefined
      ? await getActiveBusinessUnitId()
      : activeBusinessUnitId;
  return assertLockBusinessUnitAllowed(tenantId, buId, viewAllBusinessUnits);
}
