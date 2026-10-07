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
const EXPLICIT_BU_REQUIRED_MESSAGE = "Choose a business before saving.";

export async function fetchActiveBusinessUnitIds(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("business_units")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("is_active", true);
  if (error) {
    throw error;
  }
  return (data ?? []).map((row) => String(row.id));
}

export async function resolveServerWriteBusinessUnitId(input: {
  supabase: SupabaseClient;
  tenantId: string;
  authUid: string;
  requestedBusinessUnitId?: string | null;
  stampOptions?: CreateBusinessUnitStampOptions;
  requireExplicitSwitcherSelection?: boolean;
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

    const activeUnitIds = await fetchActiveBusinessUnitIds(
      input.supabase,
      input.tenantId,
    );
    const multiBuTenant = activeUnitIds.length > 1;
    const singleBuId =
      activeUnitIds.length === 1 ? activeUnitIds[0]! : null;

    const stampOpts: CreateBusinessUnitStampOptions = {
      ...input.stampOptions,
      requireExplicitSwitcherSelection:
        input.requireExplicitSwitcherSelection === true ||
        input.stampOptions?.requireExplicitSwitcherSelection === true ||
        (multiBuTenant && input.requestedBusinessUnitId === undefined),
    };

    if (allowedUnits !== null) {
      if (singleBuId) {
        const businessUnitId = resolveWriteBusinessUnitId({
          allowedUnits,
          requestedBusinessUnitId: singleBuId,
        });
        return { ok: true, businessUnitId, allowedUnits };
      }

      let activeStamp: string | null | undefined;
      try {
        activeStamp = await resolveCreateBusinessUnitId(stampOpts);
      } catch (error) {
        if (!(error instanceof StampRefusedViewAllError)) {
          throw error;
        }
        activeStamp = undefined;
      }

      if (stampOpts.requireExplicitSwitcherSelection && !activeStamp) {
        return {
          ok: false,
          error: EXPLICIT_BU_REQUIRED_MESSAGE,
          status: 400,
        };
      }

      const businessUnitId = resolveWriteBusinessUnitId({
        allowedUnits,
        requestedBusinessUnitId: activeStamp,
      });
      return { ok: true, businessUnitId, allowedUnits };
    }

    if (singleBuId && input.requestedBusinessUnitId === undefined) {
      return { ok: true, businessUnitId: singleBuId, allowedUnits };
    }

    const businessUnitId = await resolveCreateBusinessUnitId(stampOpts);
    if (stampOpts.requireExplicitSwitcherSelection && !businessUnitId) {
      return {
        ok: false,
        error: EXPLICIT_BU_REQUIRED_MESSAGE,
        status: 400,
      };
    }
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
