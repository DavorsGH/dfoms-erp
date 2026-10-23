import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PortalLoginTargetRef,
  ResolvedPortalLoginTarget,
} from "./types";

export async function resolvePortalLoginTarget(
  admin: SupabaseClient,
  ref: PortalLoginTargetRef,
): Promise<
  | { ok: true; target: ResolvedPortalLoginTarget }
  | { ok: false; error: string; status: 400 | 403 | 404 }
> {
  if (ref.persona === "landlord") {
    const tenantId = ref.tenantId.trim();
    if (!tenantId) {
      return { ok: false, error: "tenant_id is required", status: 400 };
    }

    const [{ data: tenant }, { data: landlord }] = await Promise.all([
      admin
        .from("tenants")
        .select("id, name, email")
        .eq("id", tenantId)
        .eq("product_line", "real_estate_only")
        .maybeSingle(),
      admin
        .from("landlords")
        .select("tenant_id, landlord_type, auth_user_id")
        .eq("tenant_id", tenantId)
        .maybeSingle(),
    ]);

    if (!tenant || !landlord) {
      return { ok: false, error: "Landlord not found", status: 404 };
    }

    const landlordType =
      landlord.landlord_type === "platform_only" ||
      landlord.landlord_type === "davors_managed"
        ? landlord.landlord_type
        : null;

    return {
      ok: true,
      target: {
        persona: "landlord",
        tenantId,
        recordId: tenantId,
        displayName:
          typeof tenant.name === "string" && tenant.name.trim()
            ? tenant.name.trim()
            : "Landlord",
        profileEmail:
          typeof tenant.email === "string" && tenant.email.trim()
            ? tenant.email.trim().toLowerCase()
            : null,
        authUserId:
          typeof landlord.auth_user_id === "string" &&
          landlord.auth_user_id.trim()
            ? landlord.auth_user_id.trim()
            : null,
        landlordType,
      },
    };
  }

  if (ref.persona === "lessee") {
    const tenantId = ref.tenantId.trim();
    const lesseeId = ref.lesseeId.trim();
    if (!tenantId || !lesseeId) {
      return {
        ok: false,
        error: "tenant_id and lessee_id are required",
        status: 400,
      };
    }

    const [{ data: lessee }, { data: landlord }] = await Promise.all([
      admin
        .from("lessees")
        .select("lessee_id, tenant_id, full_name, email, auth_user_id")
        .eq("tenant_id", tenantId)
        .eq("lessee_id", lesseeId)
        .maybeSingle(),
      admin
        .from("landlords")
        .select("landlord_type")
        .eq("tenant_id", tenantId)
        .maybeSingle(),
    ]);

    if (!lessee) {
      return { ok: false, error: "Lessee not found", status: 404 };
    }

    const landlordType =
      landlord?.landlord_type === "platform_only" ||
      landlord?.landlord_type === "davors_managed"
        ? landlord.landlord_type
        : null;

    return {
      ok: true,
      target: {
        persona: "lessee",
        tenantId,
        recordId: lessee.lessee_id as string,
        displayName:
          typeof lessee.full_name === "string" && lessee.full_name.trim()
            ? lessee.full_name.trim()
            : "Tenant",
        profileEmail:
          typeof lessee.email === "string" && lessee.email.trim()
            ? lessee.email.trim().toLowerCase()
            : null,
        authUserId:
          typeof lessee.auth_user_id === "string" && lessee.auth_user_id.trim()
            ? lessee.auth_user_id.trim()
            : null,
        landlordType,
      },
    };
  }

  if (ref.persona === "facility_manager") {
    const tenantId = ref.tenantId.trim();
    const facilityManagerId = ref.facilityManagerId.trim();
    if (!tenantId || !facilityManagerId) {
      return {
        ok: false,
        error: "tenant_id and facility_manager_id are required",
        status: 400,
      };
    }

    const [{ data: fm }, { data: landlord }] = await Promise.all([
      admin
        .from("facility_managers")
        .select(
          "facility_manager_id, tenant_id, full_name, email, auth_user_id, status",
        )
        .eq("tenant_id", tenantId)
        .eq("facility_manager_id", facilityManagerId)
        .maybeSingle(),
      admin
        .from("landlords")
        .select("landlord_type")
        .eq("tenant_id", tenantId)
        .maybeSingle(),
    ]);

    if (!fm) {
      return { ok: false, error: "Facility manager not found", status: 404 };
    }

    const landlordType =
      landlord?.landlord_type === "platform_only" ||
      landlord?.landlord_type === "davors_managed"
        ? landlord.landlord_type
        : null;

    return {
      ok: true,
      target: {
        persona: "facility_manager",
        tenantId,
        recordId: fm.facility_manager_id as string,
        displayName:
          typeof fm.full_name === "string" && fm.full_name.trim()
            ? fm.full_name.trim()
            : "Facility manager",
        profileEmail:
          typeof fm.email === "string" && fm.email.trim()
            ? fm.email.trim().toLowerCase()
            : null,
        authUserId:
          typeof fm.auth_user_id === "string" && fm.auth_user_id.trim()
            ? fm.auth_user_id.trim()
            : null,
        landlordType,
      },
    };
  }

  const tenantId = ref.tenantId.trim();
  const authUid = ref.authUid.trim();
  if (!tenantId || !authUid) {
    return {
      ok: false,
      error: "tenant_id and auth_uid are required",
      status: 400,
    };
  }

  const { data: account, error } = await admin
    .from("user_accounts")
    .select("auth_uid, tenant_id, email, role, is_active, employee_id")
    .eq("tenant_id", tenantId)
    .eq("auth_uid", authUid)
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message, status: 400 };
  }
  if (!account) {
    return { ok: false, error: "User account not found", status: 404 };
  }

  let displayName =
    typeof account.email === "string" && account.email.trim()
      ? account.email.trim()
      : "Staff user";
  if (
    typeof account.employee_id === "string" &&
    account.employee_id.trim()
  ) {
    const { data: employee } = await admin
      .from("employees")
      .select("full_name")
      .eq("employee_id", account.employee_id)
      .maybeSingle();
    if (
      typeof employee?.full_name === "string" &&
      employee.full_name.trim()
    ) {
      displayName = employee.full_name.trim();
    }
  }

  return {
    ok: true,
    target: {
      persona: "staff",
      tenantId,
      recordId: account.auth_uid as string,
      displayName,
      profileEmail:
        typeof account.email === "string" && account.email.trim()
          ? account.email.trim().toLowerCase()
          : null,
      authUserId: account.auth_uid as string,
      landlordType: null,
    },
  };
}

/**
 * Davors admin: landlords always; lessees/FMs under davors_managed; staff any tenant.
 * Landlords: lessees/FMs for own platform_only tenant.
 * Tenant admin: staff in own tenant only.
 */
export function assertActorMayManageTarget(options: {
  actorPath: "admin" | "landlord" | "tenant_admin";
  actorTenantId: string;
  target: ResolvedPortalLoginTarget;
}): { ok: true } | { ok: false; error: string; status: 403 } {
  const { actorPath, actorTenantId, target } = options;

  if (actorPath === "tenant_admin") {
    if (target.persona !== "staff") {
      return { ok: false, error: "Forbidden", status: 403 };
    }
    if (target.tenantId !== actorTenantId) {
      return { ok: false, error: "Forbidden", status: 403 };
    }
    return { ok: true };
  }

  if (actorPath === "admin") {
    if (target.persona === "staff" || target.persona === "landlord") {
      return { ok: true };
    }
    if (target.landlordType !== "davors_managed") {
      return { ok: false, error: "Forbidden", status: 403 };
    }
    return { ok: true };
  }

  if (target.persona === "landlord" || target.persona === "staff") {
    return { ok: false, error: "Forbidden", status: 403 };
  }
  if (target.tenantId !== actorTenantId) {
    return { ok: false, error: "Forbidden", status: 403 };
  }
  if (target.landlordType !== "platform_only") {
    return { ok: false, error: "Forbidden", status: 403 };
  }
  return { ok: true };
}
