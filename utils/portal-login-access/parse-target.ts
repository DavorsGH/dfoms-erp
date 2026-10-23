import type { PortalLoginTargetRef } from "./types";

export function parsePortalLoginTargetFromBody(
  body: Record<string, unknown>,
):
  | { ok: true; ref: PortalLoginTargetRef }
  | { ok: false; error: string } {
  const persona =
    typeof body.persona === "string" ? body.persona.trim() : "";
  const tenantId =
    typeof body.tenant_id === "string" ? body.tenant_id.trim() : "";

  if (persona === "landlord") {
    if (!tenantId) return { ok: false, error: "tenant_id is required" };
    return { ok: true, ref: { persona: "landlord", tenantId } };
  }

  if (persona === "lessee") {
    const lesseeId =
      typeof body.lessee_id === "string" ? body.lessee_id.trim() : "";
    if (!tenantId || !lesseeId) {
      return {
        ok: false,
        error: "tenant_id and lessee_id are required",
      };
    }
    return { ok: true, ref: { persona: "lessee", tenantId, lesseeId } };
  }

  if (persona === "facility_manager") {
    const facilityManagerId =
      typeof body.facility_manager_id === "string"
        ? body.facility_manager_id.trim()
        : "";
    if (!tenantId || !facilityManagerId) {
      return {
        ok: false,
        error: "tenant_id and facility_manager_id are required",
      };
    }
    return {
      ok: true,
      ref: { persona: "facility_manager", tenantId, facilityManagerId },
    };
  }

  if (persona === "staff") {
    const authUid =
      typeof body.auth_uid === "string" ? body.auth_uid.trim() : "";
    if (!tenantId || !authUid) {
      return {
        ok: false,
        error: "tenant_id and auth_uid are required",
      };
    }
    return { ok: true, ref: { persona: "staff", tenantId, authUid } };
  }

  return {
    ok: false,
    error:
      "persona must be landlord, lessee, facility_manager, or staff",
  };
}
