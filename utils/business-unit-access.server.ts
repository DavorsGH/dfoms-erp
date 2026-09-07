import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BusinessUnitAccessDeniedError,
  assertCanModifyBusinessUnitRow,
  formatBusinessUnitAccessError,
  getUserAllowedBusinessUnits,
  resolveWriteBusinessUnitId,
  type AllowedBusinessUnits,
} from "@/utils/business-unit-access";
import {
  resolveCreateBusinessUnitId,
  StampRefusedViewAllError,
  type CreateBusinessUnitStampOptions,
} from "@/utils/business-unit-stamp";

export type ServerWriteBusinessUnitResult =
  | { ok: true; businessUnitId: string | null; allowedUnits: AllowedBusinessUnits }
  | { ok: false; error: string; status: number };

export type ServerRowWriteAccessResult =
  | { ok: true; businessUnitId: string | null; allowedUnits: AllowedBusinessUnits }
  | { ok: false; error: string; status: number };

/**
 * Assert the authenticated user may modify a row before update/delete/RPC writes.
 */
export async function assertServerRowWriteAccess(input: {
  supabase: SupabaseClient;
  tenantId: string;
  authUid: string;
  table: string;
  rowId: string;
  idColumn?: string;
}): Promise<ServerRowWriteAccessResult> {
  const idColumn = input.idColumn ?? "id";

  const { data: existing, error: existingError } = await input.supabase
    .from(input.table)
    .select("business_unit_id")
    .eq(idColumn, input.rowId)
    .eq("tenant_id", input.tenantId)
    .maybeSingle();

  if (existingError) {
    return { ok: false, error: existingError.message, status: 400 };
  }

  if (!existing) {
    return { ok: false, error: "Record not found.", status: 404 };
  }

  try {
    const allowedUnits = await getUserAllowedBusinessUnits(
      input.supabase,
      input.tenantId,
      input.authUid,
    );
    assertCanModifyBusinessUnitRow(
      allowedUnits,
      (existing as { business_unit_id?: string | null }).business_unit_id,
    );
    return {
      ok: true,
      businessUnitId:
        (existing as { business_unit_id?: string | null }).business_unit_id ??
        null,
      allowedUnits,
    };
  } catch (error) {
    if (error instanceof BusinessUnitAccessDeniedError) {
      return { ok: false, error: error.message, status: 403 };
    }
    return {
      ok: false,
      error: formatBusinessUnitAccessError(error),
      status: 400,
    };
  }
}

export async function getServerAuthUid(
  supabase: SupabaseClient,
): Promise<{ ok: true; authUid: string } | { ok: false; error: string; status: number }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "Not authenticated.", status: 401 };
  }

  return { ok: true, authUid: user.id };
}

/**
 * Resolve business_unit_id for an authenticated server write, applying user
 * access restrictions before the active switcher stamp.
 */
export async function resolveServerWriteBusinessUnitId(input: {
  supabase: SupabaseClient;
  tenantId: string;
  authUid: string;
  requestedBusinessUnitId?: string | null;
  stampOptions?: CreateBusinessUnitStampOptions;
}): Promise<ServerWriteBusinessUnitResult> {
  try {
    const allowedUnits = await getUserAllowedBusinessUnits(
      input.supabase,
      input.tenantId,
      input.authUid,
    );

    if (input.requestedBusinessUnitId !== undefined) {
      const businessUnitId = resolveWriteBusinessUnitId({
        allowedUnits,
        requestedBusinessUnitId: input.requestedBusinessUnitId,
      });
      return { ok: true, businessUnitId, allowedUnits };
    }

    if (allowedUnits !== null) {
      let activeStamp: string | null | undefined;
      try {
        activeStamp = await resolveCreateBusinessUnitId(input.stampOptions);
      } catch (error) {
        if (!(error instanceof StampRefusedViewAllError)) {
          throw error;
        }
        activeStamp = undefined;
      }

      const businessUnitId = resolveWriteBusinessUnitId({
        allowedUnits,
        requestedBusinessUnitId: activeStamp,
      });
      return { ok: true, businessUnitId, allowedUnits };
    }

    const businessUnitId = await resolveCreateBusinessUnitId(input.stampOptions);
    return { ok: true, businessUnitId, allowedUnits };
  } catch (error) {
    if (error instanceof StampRefusedViewAllError) {
      return { ok: false, error: error.message, status: 400 };
    }
    if (error instanceof BusinessUnitAccessDeniedError) {
      return { ok: false, error: error.message, status: 403 };
    }
    return {
      ok: false,
      error: formatBusinessUnitAccessError(error),
      status: 400,
    };
  }
}
