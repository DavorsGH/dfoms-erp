import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ROUTE_HANDLER_AUTH_OPTS } from "@/lib/middleware-trust-policy";
import { requireAuthenticated } from "@/utils/admin-auth";
import { isStaffPortalRole } from "@/utils/assistant-staff-tool-common";
import {
  getCurrentUserAccount,
  getCurrentUserEmployeeId,
  getCurrentUserTenantId,
} from "@/utils/dashboard-auth";
import { getFacilityManagerSession } from "@/utils/facility-portal-auth";
import { getLandlordPortalSession } from "@/utils/landlord-portal-auth";
import { getPortalLesseeSession } from "@/utils/lessee-portal-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";
import {
  createEmployeePhotosSignedUrlForEmployee,
  type EmployeePhotoSigningRow,
} from "@/utils/employee-photos-storage";

export const EMPLOYEE_PHOTO_SIGNED_URL_BATCH_MAX = 200;

export type EmployeePhotoSignedUrlCaller = {
  tenantId: string;
  isStaff: boolean;
  ownEmployeeId: string | null;
};

export async function resolveEmployeePhotoSignedUrlCaller():
  Promise<
    | { ok: true; caller: EmployeePhotoSignedUrlCaller }
    | { ok: false; response: NextResponse }
  > {
  const auth = await requireAuthenticated();
  if (!auth.ok) {
    return auth;
  }

  const [
    tenantId,
    account,
    ownEmployeeId,
    lesseeSession,
    landlordSession,
    facilitySession,
  ] = await Promise.all([
    getCurrentUserTenantId(ROUTE_HANDLER_AUTH_OPTS),
    getCurrentUserAccount(ROUTE_HANDLER_AUTH_OPTS),
    getCurrentUserEmployeeId(ROUTE_HANDLER_AUTH_OPTS),
    getPortalLesseeSession(ROUTE_HANDLER_AUTH_OPTS),
    getLandlordPortalSession(ROUTE_HANDLER_AUTH_OPTS),
    getFacilityManagerSession(),
  ]);

  const isNonStaffPortal = Boolean(
    lesseeSession || landlordSession || facilitySession,
  );
  const isStaff =
    Boolean(tenantId) &&
    Boolean(account?.tenant_id) &&
    isStaffPortalRole(account?.role ?? null) &&
    !isNonStaffPortal;

  if (!tenantId?.trim()) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
    };
  }

  if (isNonStaffPortal && !isStaff) {
    if (!ownEmployeeId?.trim()) {
      return {
        ok: false,
        response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
      };
    }
    return {
      ok: true,
      caller: {
        tenantId: tenantId.trim(),
        isStaff: false,
        ownEmployeeId: ownEmployeeId.trim(),
      },
    };
  }

  if (!isStaff) {
    if (!ownEmployeeId?.trim()) {
      return {
        ok: false,
        response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
      };
    }
    return {
      ok: true,
      caller: {
        tenantId: tenantId.trim(),
        isStaff: false,
        ownEmployeeId: ownEmployeeId.trim(),
      },
    };
  }

  return {
    ok: true,
    caller: {
      tenantId: tenantId.trim(),
      isStaff: true,
      ownEmployeeId: ownEmployeeId?.trim() || null,
    },
  };
}

export function callerMayRequestEmployeePhoto(
  caller: EmployeePhotoSignedUrlCaller,
  employeeId: string,
): boolean {
  if (caller.isStaff) {
    return true;
  }
  return caller.ownEmployeeId === employeeId.trim();
}

export async function loadTenantEmployeePhotoRows(
  sessionClient: SupabaseClient,
  tenantId: string,
  employeeIds: string[],
): Promise<EmployeePhotoSigningRow[]> {
  const uniqueIds = [...new Set(employeeIds.map((id) => id.trim()).filter(Boolean))];
  if (uniqueIds.length === 0) {
    return [];
  }

  const { data, error } = await sessionClient
    .from("employees")
    .select("employee_id, tenant_id, photo_url")
    .eq("tenant_id", tenantId)
    .in("employee_id", uniqueIds);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as EmployeePhotoSigningRow[];
}

export async function signEmployeePhotoUrlsForCaller(
  caller: EmployeePhotoSignedUrlCaller,
  employeeIds: string[],
): Promise<Record<string, string>> {
  const allowedIds = employeeIds
    .map((id) => id.trim())
    .filter((id) => id && callerMayRequestEmployeePhoto(caller, id));

  if (allowedIds.length === 0) {
    return {};
  }

  const cookieStore = await cookies();
  const sessionClient = createClient(cookieStore);
  let rows: EmployeePhotoSigningRow[];
  try {
    rows = await loadTenantEmployeePhotoRows(
      sessionClient,
      caller.tenantId,
      allowedIds,
    );
  } catch {
    return {};
  }

  const admin = createAdminClient();
  const result: Record<string, string> = {};

  for (const row of rows) {
    if (!callerMayRequestEmployeePhoto(caller, row.employee_id)) {
      continue;
    }
    const signedUrl = await createEmployeePhotosSignedUrlForEmployee(
      admin,
      row,
    );
    if (signedUrl) {
      result[row.employee_id] = signedUrl;
    }
  }

  return result;
}
