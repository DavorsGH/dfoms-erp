import "server-only";

import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { FINANCE_SECTION_ROLES, CRM_SECTION_ROLES, EMPLOYEES_SECTION_ROLES } from "@/utils/rbac-access";
import { assertTenantHasFeature } from "@/utils/tier-access";
import type { BulkImportType } from "@/lib/bulk-import/types";

export const BULK_IMPORT_GATE_ROLES = [
  ...CRM_SECTION_ROLES,
  ...EMPLOYEES_SECTION_ROLES.filter(
    (role) => !CRM_SECTION_ROLES.includes(role),
  ),
  ...FINANCE_SECTION_ROLES.filter(
    (role) =>
      !CRM_SECTION_ROLES.includes(role) &&
      !EMPLOYEES_SECTION_ROLES.includes(role),
  ),
] as const;

async function requireCrmCoreBulkImportAccess() {
  const auth = await requireTenantRoleIn(CRM_SECTION_ROLES);
  if (!auth.ok) {
    return auth;
  }

  const feature = await assertTenantHasFeature(auth.tenantId, "crm_core");
  if (!feature.ok) {
    return feature;
  }

  return auth;
}

export async function requireBulkImportAccess(importType: BulkImportType) {
  if (importType === "employee") {
    return requireTenantRoleIn(EMPLOYEES_SECTION_ROLES);
  }

  if (importType === "customer") {
    return requireCrmCoreBulkImportAccess();
  }

  if (importType === "product" || importType === "service") {
    return requireCrmCoreBulkImportAccess();
  }

  if (importType === "expense" || importType === "fixed_asset") {
    return requireTenantRoleIn(FINANCE_SECTION_ROLES);
  }

  return {
    ok: false as const,
    response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
  };
}
