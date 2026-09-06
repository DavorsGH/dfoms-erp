import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BusinessUnitAccessDeniedError,
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
