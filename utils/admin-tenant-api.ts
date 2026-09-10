import { NextResponse } from "next/server";
import { parseRequiredUuid } from "@/utils/uuid-validation";
import { DAVORS_TENANT_ID } from "@/utils/tenant-signup";

export function validateAdminCustomerTenantId(
  tenantIdRaw: string | undefined,
):
  | { ok: true; tenantId: string }
  | { ok: false; response: NextResponse } {
  const parsed = parseRequiredUuid(tenantIdRaw, "tenant_id");
  if (!parsed.ok) {
    return {
      ok: false,
      response: NextResponse.json({ error: parsed.message }, { status: 400 }),
    };
  }

  if (parsed.value === DAVORS_TENANT_ID) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "The platform tenant cannot be modified from this screen." },
        { status: 400 },
      ),
    };
  }

  return { ok: true, tenantId: parsed.value };
}

export function staffAuditActorLabel(user: {
  id?: string | null;
  email?: string | null;
} | null): string {
  return (
    user?.email?.trim() ||
    user?.id?.trim() ||
    "davors-platform-super-admin"
  );
}
