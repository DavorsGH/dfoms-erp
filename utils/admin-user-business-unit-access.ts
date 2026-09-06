import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { resolveDatabaseUrl } from "@/utils/database-url";

type AdminClient = SupabaseClient;

export type UserBusinessUnitAccessPayload = {
  business_unit_ids: string[];
  default_business_unit_id: string | null;
};

export type UserBusinessUnitAccessResponse = {
  unrestricted: boolean;
  business_unit_ids: string[];
  default_business_unit_id: string | null;
};

type AccessInsertRow = {
  tenant_id: string;
  auth_uid: string;
  business_unit_id: string;
  is_default: boolean;
};

export function normalizeBusinessUnitAccessInput(body: {
  business_unit_ids?: unknown;
  default_business_unit_id?: unknown;
}): UserBusinessUnitAccessPayload | { error: string } {
  if (!Array.isArray(body.business_unit_ids)) {
    return { error: "business_unit_ids must be an array." };
  }

  const business_unit_ids = [
    ...new Set(
      body.business_unit_ids
        .filter((id): id is string => typeof id === "string")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];

  if (
    body.default_business_unit_id !== undefined &&
    body.default_business_unit_id !== null &&
    typeof body.default_business_unit_id !== "string"
  ) {
    return { error: "default_business_unit_id must be a string or null." };
  }

  const default_business_unit_id =
    typeof body.default_business_unit_id === "string"
      ? body.default_business_unit_id.trim() || null
      : null;

  return { business_unit_ids, default_business_unit_id };
}

export async function fetchUserBusinessUnitAccessForAdmin(
  admin: AdminClient,
  tenantId: string,
  authUid: string,
): Promise<UserBusinessUnitAccessResponse> {
  const { data, error } = await admin
    .from("user_business_unit_access")
    .select("business_unit_id, is_default")
    .eq("tenant_id", tenantId)
    .eq("auth_uid", authUid);

  if (error) {
    throw new Error(error.message);
  }

  const rows = data ?? [];
  if (rows.length === 0) {
    return {
      unrestricted: true,
      business_unit_ids: [],
      default_business_unit_id: null,
    };
  }

  const business_unit_ids = rows
    .map((row) => String(row.business_unit_id ?? "").trim())
    .filter(Boolean);

  if (business_unit_ids.length === 0) {
    return {
      unrestricted: true,
      business_unit_ids: [],
      default_business_unit_id: null,
    };
  }

  const defaultRow =
    rows.find((row) => row.is_default === true) ??
    (rows.length === 1 ? rows[0] : null);

  return {
    unrestricted: false,
    business_unit_ids,
    default_business_unit_id: defaultRow
      ? String(defaultRow.business_unit_id ?? "").trim() || null
      : null,
  };
}

export async function validateBusinessUnitIdsBelongToTenant(
  admin: AdminClient,
  tenantId: string,
  businessUnitIds: string[],
): Promise<string | null> {
  if (businessUnitIds.length === 0) {
    return null;
  }

  const { data, error } = await admin
    .from("business_units")
    .select("id")
    .eq("tenant_id", tenantId)
    .in("id", businessUnitIds);

  if (error) {
    return error.message;
  }

  if ((data ?? []).length !== businessUnitIds.length) {
    return "One or more business units are invalid for this workspace.";
  }

  return null;
}

async function replaceAccessRowsWithAdminClient(
  admin: AdminClient,
  authUid: string,
  tenantId: string,
  rows: AccessInsertRow[],
): Promise<string | null> {
  const { error: deleteError } = await admin
    .from("user_business_unit_access")
    .delete()
    .eq("auth_uid", authUid)
    .eq("tenant_id", tenantId);

  if (deleteError) {
    return deleteError.message;
  }

  if (rows.length === 0) {
    return null;
  }

  const { error: insertError } = await admin
    .from("user_business_unit_access")
    .insert(rows);

  return insertError?.message ?? null;
}

async function replaceAccessRowsInTransaction(
  admin: AdminClient,
  authUid: string,
  tenantId: string,
  rows: AccessInsertRow[],
): Promise<string | null> {
  const dbUrl = resolveDatabaseUrl();
  if (!dbUrl) {
    return replaceAccessRowsWithAdminClient(admin, authUid, tenantId, rows);
  }

  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM user_business_unit_access WHERE auth_uid = $1 AND tenant_id = $2",
      [authUid, tenantId],
    );

    for (const row of rows) {
      await client.query(
        `INSERT INTO user_business_unit_access
          (tenant_id, auth_uid, business_unit_id, is_default)
         VALUES ($1, $2, $3, $4)`,
        [row.tenant_id, row.auth_uid, row.business_unit_id, row.is_default],
      );
    }

    await client.query("COMMIT");
    return null;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback failure
    }
    return error instanceof Error
      ? error.message
      : "Failed to sync business unit access.";
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function syncUserBusinessUnitAccess(
  admin: AdminClient,
  authUid: string,
  tenantId: string,
  payload: UserBusinessUnitAccessPayload,
): Promise<string | null> {
  const businessUnitIds = payload.business_unit_ids;

  if (businessUnitIds.length === 0) {
    return replaceAccessRowsInTransaction(admin, authUid, tenantId, []);
  }

  let defaultBusinessUnitId = payload.default_business_unit_id;
  if (businessUnitIds.length === 1) {
    defaultBusinessUnitId = businessUnitIds[0]!;
  } else if (
    !defaultBusinessUnitId ||
    !businessUnitIds.includes(defaultBusinessUnitId)
  ) {
    return "Select a default business unit when restricting access to more than one.";
  }

  const validationError = await validateBusinessUnitIdsBelongToTenant(
    admin,
    tenantId,
    businessUnitIds,
  );
  if (validationError) {
    return validationError;
  }

  const rows: AccessInsertRow[] = businessUnitIds.map((business_unit_id) => ({
    tenant_id: tenantId,
    auth_uid: authUid,
    business_unit_id,
    is_default: business_unit_id === defaultBusinessUnitId,
  }));

  return replaceAccessRowsInTransaction(admin, authUid, tenantId, rows);
}
