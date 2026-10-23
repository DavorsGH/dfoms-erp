import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PortalLoginTargetPersona,
  SharedLoginLink,
} from "./types";

/**
 * Find every app-table link for an Auth user except the target being edited.
 */
export async function findSharedLoginLinks(
  admin: SupabaseClient,
  authUserId: string,
  exclude: {
    persona: PortalLoginTargetPersona;
    recordId: string;
    tenantId?: string;
  },
): Promise<SharedLoginLink[]> {
  const links: SharedLoginLink[] = [];

  const [
    { data: staffRows },
    { data: landlordRows },
    { data: lesseeRows },
    { data: fmRows },
  ] = await Promise.all([
    admin
      .from("user_accounts")
      .select("auth_uid, tenant_id, email, role")
      .eq("auth_uid", authUserId),
    admin
      .from("landlords")
      .select("tenant_id, auth_user_id")
      .eq("auth_user_id", authUserId),
    admin
      .from("lessees")
      .select("lessee_id, tenant_id, full_name, email, auth_user_id")
      .eq("auth_user_id", authUserId),
    admin
      .from("facility_managers")
      .select("facility_manager_id, tenant_id, full_name, email, auth_user_id")
      .eq("auth_user_id", authUserId),
  ]);

  for (const row of staffRows ?? []) {
    const recordId = row.auth_uid as string;
    const rowTenantId = (row.tenant_id as string | null) ?? null;
    if (
      exclude.persona === "staff" &&
      exclude.recordId === recordId &&
      (!exclude.tenantId || exclude.tenantId === rowTenantId)
    ) {
      continue;
    }
    links.push({
      kind: "staff",
      tenantId: rowTenantId,
      recordId,
      label: `Staff account (${(row.email as string | null) ?? row.auth_uid})`,
    });
  }

  for (const row of landlordRows ?? []) {
    const recordId = row.tenant_id as string;
    if (exclude.persona === "landlord" && exclude.recordId === recordId) {
      continue;
    }
    links.push({
      kind: "landlord",
      tenantId: recordId,
      recordId,
      label: `Landlord portal (tenant ${recordId})`,
    });
  }

  for (const row of lesseeRows ?? []) {
    const recordId = row.lessee_id as string;
    if (exclude.persona === "lessee" && exclude.recordId === recordId) {
      continue;
    }
    links.push({
      kind: "lessee",
      tenantId: (row.tenant_id as string | null) ?? null,
      recordId,
      label: `Tenant portal (${(row.full_name as string | null) ?? recordId})`,
    });
  }

  for (const row of fmRows ?? []) {
    const recordId = row.facility_manager_id as string;
    if (
      exclude.persona === "facility_manager" &&
      exclude.recordId === recordId
    ) {
      continue;
    }
    links.push({
      kind: "facility_manager",
      tenantId: (row.tenant_id as string | null) ?? null,
      recordId,
      label: `Facility manager (${(row.full_name as string | null) ?? recordId})`,
    });
  }

  return links;
}

export function formatSharedLoginSummary(links: SharedLoginLink[]): string {
  if (links.length === 0) return "";
  return links.map((link) => link.label).join("; ");
}
