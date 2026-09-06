import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveSessionTenantId } from "@/utils/session-tenant-client";

export type UserBusinessUnitAccess = {
  businessUnitIds: string[];
  defaultBusinessUnitId: string | null;
};

/** null = unrestricted (zero access rows); otherwise restricted to listed units. */
export type AllowedBusinessUnits = UserBusinessUnitAccess | null;

export class BusinessUnitAccessDeniedError extends Error {
  readonly code = "BUSINESS_UNIT_ACCESS_DENIED" as const;

  constructor(message: string) {
    super(message);
    this.name = "BusinessUnitAccessDeniedError";
  }
}

const ACCESS_DENIED_MESSAGE =
  "You do not have permission to write to this business unit.";

const UNTAGGED_DENIED_MESSAGE =
  "This record is not tagged to a business unit you can access.";

const RESTRICTED_DEFAULT_REQUIRED_MESSAGE =
  "Select a business unit you are allowed to use.";

type AccessRow = {
  business_unit_id: string;
  is_default: boolean | null;
};

export function formatBusinessUnitAccessError(error: unknown): string {
  if (error instanceof BusinessUnitAccessDeniedError) {
    return error.message;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return ACCESS_DENIED_MESSAGE;
}

/**
 * Returns null when the user has zero rows (unrestricted).
 * Otherwise returns allowed business_unit_id values and the default flag.
 */
export async function getUserAllowedBusinessUnits(
  supabase: SupabaseClient,
  tenantId: string,
  authUid: string,
): Promise<AllowedBusinessUnits> {
  const trimmedTenantId = tenantId.trim();
  const trimmedAuthUid = authUid.trim();
  if (!trimmedTenantId || !trimmedAuthUid) {
    throw new BusinessUnitAccessDeniedError(
      "Workspace session is missing tenant or user context.",
    );
  }

  const { data, error } = await supabase
    .from("user_business_unit_access")
    .select("business_unit_id, is_default")
    .eq("tenant_id", trimmedTenantId)
    .eq("auth_uid", trimmedAuthUid);

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as AccessRow[];
  if (rows.length === 0) {
    return null;
  }

  const businessUnitIds = rows
    .map((row) => String(row.business_unit_id ?? "").trim())
    .filter(Boolean);

  if (businessUnitIds.length === 0) {
    return null;
  }

  const defaultRow =
    rows.find((row) => row.is_default === true) ??
    (rows.length === 1 ? rows[0] : null);
  const defaultBusinessUnitId = defaultRow
    ? String(defaultRow.business_unit_id ?? "").trim() || null
    : null;

  return {
    businessUnitIds,
    defaultBusinessUnitId,
  };
}

export function assertBusinessUnitAccess(
  allowedUnits: AllowedBusinessUnits,
  businessUnitId: string | null | undefined,
): void {
  if (allowedUnits === null) {
    return;
  }

  const trimmed =
    businessUnitId == null ? "" : String(businessUnitId).trim();
  if (!trimmed) {
    throw new BusinessUnitAccessDeniedError(UNTAGGED_DENIED_MESSAGE);
  }

  if (!allowedUnits.businessUnitIds.includes(trimmed)) {
    throw new BusinessUnitAccessDeniedError(ACCESS_DENIED_MESSAGE);
  }
}

export function resolveDefaultBusinessUnitId(
  allowedUnits: UserBusinessUnitAccess,
): string {
  if (allowedUnits.defaultBusinessUnitId) {
    return allowedUnits.defaultBusinessUnitId;
  }
  if (allowedUnits.businessUnitIds.length === 1) {
    return allowedUnits.businessUnitIds[0]!;
  }
  throw new BusinessUnitAccessDeniedError(RESTRICTED_DEFAULT_REQUIRED_MESSAGE);
}

/**
 * Resolve the business_unit_id to stamp on a create/write.
 * - Explicit requestedBusinessUnitId (when provided): must pass access check.
 * - Restricted + no explicit id: default unit (is_default or sole allowed unit).
 * - Unrestricted + no explicit id: returns null (caller applies switcher stamp).
 */
export function resolveWriteBusinessUnitId(input: {
  allowedUnits: AllowedBusinessUnits;
  requestedBusinessUnitId?: string | null;
}): string | null {
  const { allowedUnits, requestedBusinessUnitId } = input;

  const hasExplicit =
    requestedBusinessUnitId !== undefined &&
    requestedBusinessUnitId !== null &&
    String(requestedBusinessUnitId).trim() !== "";

  if (hasExplicit) {
    const id = String(requestedBusinessUnitId).trim();
    assertBusinessUnitAccess(allowedUnits, id);
    return id;
  }

  if (allowedUnits !== null) {
    return resolveDefaultBusinessUnitId(allowedUnits);
  }

  return null;
}

export type StampBusinessUnitResult =
  | { ok: true; businessUnitId: string | null }
  | { ok: false; error: string };

/**
 * Client create helper: combines BU access rules with the active switcher stamp.
 */
export function resolveWriteBusinessUnitIdForCreate(input: {
  allowedUnits: AllowedBusinessUnits;
  stamp: StampBusinessUnitResult;
}): StampBusinessUnitResult {
  try {
    if (input.allowedUnits !== null) {
      const requested = input.stamp.ok
        ? input.stamp.businessUnitId
        : undefined;
      const businessUnitId = resolveWriteBusinessUnitId({
        allowedUnits: input.allowedUnits,
        requestedBusinessUnitId: requested,
      });
      return { ok: true, businessUnitId };
    }

    if (!input.stamp.ok) {
      return input.stamp;
    }

    return { ok: true, businessUnitId: input.stamp.businessUnitId };
  } catch (error) {
    return { ok: false, error: formatBusinessUnitAccessError(error) };
  }
}

export function assertCanModifyBusinessUnitRow(
  allowedUnits: AllowedBusinessUnits,
  rowBusinessUnitId: string | null | undefined,
): void {
  assertBusinessUnitAccess(allowedUnits, rowBusinessUnitId);
}

export type WriteBusinessUnitContext =
  | {
      ok: true;
      tenantId: string;
      authUid: string;
      allowedUnits: AllowedBusinessUnits;
    }
  | { ok: false; error: string };

/** Load tenant + auth + allowed business units for client-side write handlers. */
export async function loadWriteBusinessUnitContext(
  supabase: SupabaseClient,
): Promise<WriteBusinessUnitContext> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    return { ok: false, error: authError.message };
  }
  if (!user) {
    return { ok: false, error: "Not signed in." };
  }

  const { tenantId, error: tenantError } =
    await resolveSessionTenantId(supabase);
  if (tenantError || !tenantId) {
    return {
      ok: false,
      error: tenantError ?? "Unable to resolve workspace for this session.",
    };
  }

  try {
    const allowedUnits = await getUserAllowedBusinessUnits(
      supabase,
      tenantId,
      user.id,
    );
    return { ok: true, tenantId, authUid: user.id, allowedUnits };
  } catch (error) {
    return { ok: false, error: formatBusinessUnitAccessError(error) };
  }
}
