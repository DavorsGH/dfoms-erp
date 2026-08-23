export const LESSEE_EMAIL_DUPLICATE_WARNING =
  "This email is already used on another tenant record. Portal invites only work for one account per email.";

export type LesseeEmailDuplicateCheckRequest = {
  email: string;
  lessee_id?: string;
  tenant_id?: string;
};

/**
 * Tenant-safe duplicate check — returns fixed warning text only, never other record details.
 */
export async function fetchLesseeEmailDuplicateWarning(
  surface: "admin" | "landlord-portal",
  request: LesseeEmailDuplicateCheckRequest,
): Promise<string | null> {
  const email = request.email.trim();
  if (!email) {
    return null;
  }

  const endpoint =
    surface === "admin"
      ? "/api/admin/lessees/check-email-duplicate"
      : "/api/landlord-portal/lessees/check-email-duplicate";

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        lessee_id: request.lessee_id,
        tenant_id: request.tenant_id,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as { duplicate?: boolean };
    return payload.duplicate ? LESSEE_EMAIL_DUPLICATE_WARNING : null;
  } catch {
    return null;
  }
}
