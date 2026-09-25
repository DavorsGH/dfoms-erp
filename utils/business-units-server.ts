import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { resolveDatabaseUrl } from "@/utils/database-url";
import { BUSINESS_UNIT_SELECT, type BusinessUnitRow } from "@/utils/business-units-types";

type AdminClient = SupabaseClient;

export const PRIMARY_DEACTIVATE_ERROR =
  "This is your primary business unit. Set another unit as primary before deactivating it.";

export const LAST_ACTIVE_DEACTIVATE_ERROR =
  "You cannot deactivate the last active business unit in this workspace.";

function formatAffectedUserNames(names: string[]): string {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  unique.sort((a, b) => a.localeCompare(b));
  return unique.join(", ");
}

async function loadAffectedUserDisplayNames(
  admin: AdminClient,
  tenantId: string,
  authUids: string[],
): Promise<string[]> {
  if (authUids.length === 0) {
    return [];
  }

  const { data, error } = await admin
    .from("user_accounts")
    .select("auth_uid, email, employees!user_accounts_employee_id_fkey(full_name)")
    .eq("tenant_id", tenantId)
    .in("auth_uid", authUids);

  if (error) {
    throw new Error(error.message);
  }

  type UserAccountNameRow = {
    auth_uid: string;
    email: string | null;
    employees:
      | { full_name: string | null }
      | { full_name: string | null }[]
      | null;
  };

  return ((data ?? []) as UserAccountNameRow[]).map((row) => {
    const employee = row.employees;
    const fullName = Array.isArray(employee)
      ? employee[0]?.full_name
      : employee?.full_name;
    const email = typeof row.email === "string" ? row.email.trim() : "";
    return fullName?.trim() || email || row.auth_uid;
  });
}

export async function assertCanDeactivateBusinessUnit(
  admin: AdminClient,
  tenantId: string,
  businessUnitId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: unit, error: unitError } = await admin
    .from("business_units")
    .select("id, is_primary, is_active")
    .eq("id", businessUnitId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (unitError) {
    return { ok: false, error: unitError.message };
  }

  if (!unit) {
    return { ok: false, error: "Business unit not found" };
  }

  if (unit.is_primary === true) {
    return { ok: false, error: PRIMARY_DEACTIVATE_ERROR };
  }

  const { count: activeCount, error: countError } = await admin
    .from("business_units")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("is_active", true);

  if (countError) {
    return { ok: false, error: countError.message };
  }

  if ((activeCount ?? 0) <= 1 && unit.is_active === true) {
    return { ok: false, error: LAST_ACTIVE_DEACTIVATE_ERROR };
  }

  const { data: accessRows, error: accessError } = await admin
    .from("user_business_unit_access")
    .select("auth_uid, business_unit_id")
    .eq("tenant_id", tenantId);

  if (accessError) {
    return { ok: false, error: accessError.message };
  }

  const rows = accessRows ?? [];
  if (rows.length === 0) {
    return { ok: true };
  }

  const { data: activeUnits, error: activeUnitsError } = await admin
    .from("business_units")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("is_active", true);

  if (activeUnitsError) {
    return { ok: false, error: activeUnitsError.message };
  }

  const activeIdSet = new Set(
    (activeUnits ?? []).map((row) => String(row.id)).filter(Boolean),
  );
  activeIdSet.delete(businessUnitId);

  const accessByUser = new Map<string, Set<string>>();
  for (const row of rows) {
    const authUid = String(row.auth_uid ?? "").trim();
    const buId = String(row.business_unit_id ?? "").trim();
    if (!authUid || !buId) {
      continue;
    }
    if (!accessByUser.has(authUid)) {
      accessByUser.set(authUid, new Set());
    }
    accessByUser.get(authUid)!.add(buId);
  }

  const usersWithDeactivatingUnit = new Set(
    rows
      .filter((row) => String(row.business_unit_id) === businessUnitId)
      .map((row) => String(row.auth_uid ?? "").trim())
      .filter(Boolean),
  );

  const strandedAuthUids: string[] = [];
  for (const authUid of usersWithDeactivatingUnit) {
    const buIds = accessByUser.get(authUid);
    if (!buIds) {
      continue;
    }
    let activeAllowed = 0;
    for (const buId of buIds) {
      if (activeIdSet.has(buId)) {
        activeAllowed += 1;
      }
    }
    if (activeAllowed === 0) {
      strandedAuthUids.push(authUid);
    }
  }

  if (strandedAuthUids.length === 0) {
    return { ok: true };
  }

  const names = await loadAffectedUserDisplayNames(
    admin,
    tenantId,
    strandedAuthUids,
  );
  const label = formatAffectedUserNames(names);
  return {
    ok: false,
    error: `Cannot deactivate this business unit: ${label} would have no active business units in their access. Update their Business Unit Access first.`,
  };
}

async function setPrimaryWithAdminClient(
  admin: AdminClient,
  tenantId: string,
  businessUnitId: string,
): Promise<string | null> {
  const { data: unit, error: unitError } = await admin
    .from("business_units")
    .select("id, is_active")
    .eq("id", businessUnitId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (unitError) {
    return unitError.message;
  }

  if (!unit) {
    return "Business unit not found";
  }

  if (unit.is_active !== true) {
    return "Cannot set an inactive business unit as primary.";
  }

  const { error: clearError } = await admin
    .from("business_units")
    .update({ is_primary: false, updated_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .eq("is_primary", true);

  if (clearError) {
    return clearError.message;
  }

  const { error: setError } = await admin
    .from("business_units")
    .update({ is_primary: true, updated_at: new Date().toISOString() })
    .eq("id", businessUnitId)
    .eq("tenant_id", tenantId);

  return setError?.message ?? null;
}

async function setPrimaryInTransaction(
  admin: AdminClient,
  tenantId: string,
  businessUnitId: string,
): Promise<string | null> {
  const dbUrl = resolveDatabaseUrl();
  if (!dbUrl) {
    return setPrimaryWithAdminClient(admin, tenantId, businessUnitId);
  }

  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    await client.query("BEGIN");

    const unitResult = await client.query(
      `SELECT is_active FROM business_units WHERE id = $1 AND tenant_id = $2`,
      [businessUnitId, tenantId],
    );

    if (unitResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return "Business unit not found";
    }

    const unitRow = unitResult.rows[0] as { is_active?: boolean } | undefined;
    if (unitRow?.is_active !== true) {
      await client.query("ROLLBACK");
      return "Cannot set an inactive business unit as primary.";
    }

    await client.query(
      `UPDATE business_units SET is_primary = false, updated_at = now()
       WHERE tenant_id = $1 AND is_primary = true`,
      [tenantId],
    );

    await client.query(
      `UPDATE business_units SET is_primary = true, updated_at = now()
       WHERE id = $1 AND tenant_id = $2`,
      [businessUnitId, tenantId],
    );

    await client.query("COMMIT");
    return null;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    return error instanceof Error
      ? error.message
      : "Failed to set primary business unit.";
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function setTenantPrimaryBusinessUnit(
  admin: AdminClient,
  tenantId: string,
  businessUnitId: string,
): Promise<{ ok: true; business_unit: BusinessUnitRow } | { ok: false; error: string }> {
  const syncError = await setPrimaryInTransaction(
    admin,
    tenantId,
    businessUnitId,
  );

  if (syncError) {
    return { ok: false, error: syncError };
  }

  const { data, error } = await admin
    .from("business_units")
    .select(BUSINESS_UNIT_SELECT)
    .eq("id", businessUnitId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message };
  }

  if (!data) {
    return { ok: false, error: "Business unit not found after update." };
  }

  return { ok: true, business_unit: data as BusinessUnitRow };
}
