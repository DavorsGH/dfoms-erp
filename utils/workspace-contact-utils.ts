/** Mirrors Workspace Settings page prefill sources for signup persistence. */

export type WorkspaceContactEmployeeSource = {
  phone?: string | null;
  momo_number?: string | null;
};

export function resolveWorkspaceContactEmail(
  adminEmail: string | null | undefined,
): string | null {
  const trimmed = adminEmail?.trim();
  return trimmed || null;
}

export function resolveWorkspaceContactPhone(
  employee: WorkspaceContactEmployeeSource | null | undefined,
): string | null {
  const phone =
    employee?.phone?.trim() || employee?.momo_number?.trim() || "";
  return phone || null;
}

export function buildSignupWorkspaceContactPatch(
  adminEmail: string,
  employee: WorkspaceContactEmployeeSource | null | undefined,
): { email: string | null; phone: string | null } {
  return {
    email: resolveWorkspaceContactEmail(adminEmail),
    phone: resolveWorkspaceContactPhone(employee),
  };
}
