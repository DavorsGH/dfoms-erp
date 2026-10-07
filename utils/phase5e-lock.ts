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
  getActiveBusinessUnitIdForWriteStamp,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { LOCK_REQUIRES_SCOPED_BU_MESSAGE, REMIT_REQUIRES_SCOPED_BU_MESSAGE } from "@/utils/business-unit-view";

/** Active BU for scoped writes — no primary/name fallback (explicit switcher or null). */
export async function resolveWriteBusinessUnitId(): Promise<string | null> {
  return getActiveBusinessUnitIdForWriteStamp();
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

/**
 * Tax Ledger Remit / Undo Remit: block when tenant has ≥1 active BU and user is
 * on All Businesses (same gate shape as Lock Period).
 */
export async function assertRemitBusinessUnitAllowed(
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
    return { ok: false, error: REMIT_REQUIRES_SCOPED_BU_MESSAGE };
  }

  void activeBusinessUnitId;
  return { ok: true };
}

const CHOOSE_BUSINESS_MESSAGE = "Choose a business before saving.";

/**
 * Payroll / lock writes: explicit switcher BU, single-BU tenant default, or null when zero BUs.
 * Never primary-BU fallback.
 */
export async function resolvePayrollWriteBusinessUnitId(
  tenantId: string,
): Promise<
  { ok: true; businessUnitId: string | null } | { ok: false; error: string }
> {
  const activeCount = await countActiveBusinessUnitsForTenant(tenantId);
  if (activeCount === 0) {
    return { ok: true, businessUnitId: null };
  }

  if (activeCount === 1) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("business_units")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    return { ok: true, businessUnitId: data?.id ?? null };
  }

  const explicit = await getActiveBusinessUnitIdForWriteStamp();
  if (!explicit) {
    return { ok: false, error: CHOOSE_BUSINESS_MESSAGE };
  }
  return { ok: true, businessUnitId: explicit };
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
