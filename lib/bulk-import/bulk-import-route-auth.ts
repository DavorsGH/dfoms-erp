import "server-only";

import { requireTenantRoleIn } from "@/utils/admin-auth";
import { CRM_SECTION_ROLES, EMPLOYEES_SECTION_ROLES } from "@/utils/rbac-access";
import { assertTenantHasFeature } from "@/utils/tier-access";
import type { BulkImportType } from "@/lib/bulk-import/types";

export const BULK_IMPORT_GATE_ROLES = [
  ...CRM_SECTION_ROLES,
  ...EMPLOYEES_SECTION_ROLES.filter(
    (role) => !CRM_SECTION_ROLES.includes(role),
  ),
] as const;

export async function requireBulkImportAccess(importType: BulkImportType) {
  if (importType === "employee") {
    return requireTenantRoleIn(EMPLOYEES_SECTION_ROLES);
  }

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
