import "server-only";

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireDavorsPlatformSuperAdmin } from "@/utils/admin-auth";
import { requirePlatformOnlyLandlordSession } from "@/utils/landlord-portal-auth";
import { assertRealEstateLandlordTenant } from "@/utils/property-management";
import { createAdminClient } from "@/utils/supabase/admin";
import { LESSEE_ANNOUNCEMENT_CODE_ENTITY_TYPE } from "@/utils/lessee-announcements-types";

export type LesseeAnnouncementAdminContext =
  | {
      ok: true;
      userId: string;
      tenantId: string;
      landlordName: string;
      admin: SupabaseClient;
    }
  | { ok: false; response: NextResponse };

export function readTenantIdFromBody(body: unknown): string {
  if (body !== null && typeof body === "object" && "tenant_id" in body) {
    const value = (body as { tenant_id?: unknown }).tenant_id;
    return typeof value === "string" ? value.trim() : "";
  }
  return "";
}

export function readTenantIdFromSearchParams(
  searchParams: URLSearchParams,
): string {
  return searchParams.get("tenant_id")?.trim() ?? "";
}

export async function requireLesseeAnnouncementAdmin(
  tenantIdRaw: string,
): Promise<LesseeAnnouncementAdminContext> {
  const auth = await requireDavorsPlatformSuperAdmin();
  if (!auth.ok) {
    return auth;
  }

  const admin = createAdminClient();
  const landlord = await assertRealEstateLandlordTenant(admin, tenantIdRaw);
  if (!landlord.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: landlord.error },
        { status: landlord.status },
      ),
    };
  }

  return {
    ok: true,
    userId: auth.userId,
    tenantId: landlord.tenantId,
    landlordName: landlord.name,
    admin,
  };
}

/**
 * platform_only landlords compose/send their own tenant announcements.
 * Tenant scope always comes from the session (ignore body/query tenant_id).
 */
export async function requireLesseeAnnouncementLandlordPortal(): Promise<LesseeAnnouncementAdminContext> {
  const auth = await requirePlatformOnlyLandlordSession();
  if (!auth.ok) {
    return auth;
  }

  return {
    ok: true,
    userId: auth.session.authUserId,
    tenantId: auth.session.tenantId,
    landlordName: auth.session.fullName,
    admin: auth.admin,
  };
}

export async function allocateLesseeAnnouncementCode(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<{ code: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc("generate_next_code", {
    p_tenant_id: tenantId,
    p_entity_type: LESSEE_ANNOUNCEMENT_CODE_ENTITY_TYPE,
    p_padding: 4,
  });

  if (error) {
    return { code: null, error: error.message };
  }

  const code = typeof data === "string" ? data.trim() : "";
  if (!code) {
    return {
      code: null,
      error: "generate_next_code returned an empty announcement code.",
    };
  }

  return { code, error: null };
}

export async function loadActiveLesseeTemplate(
  supabase: SupabaseClient,
  tenantId: string,
  templateId: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const { data, error } = await supabase
    .from("lessee_message_templates")
    .select("id, is_active, tenant_id")
    .eq("id", templateId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message, status: 400 };
  }
  if (!data) {
    return {
      ok: false,
      error: "Template not found for this landlord.",
      status: 404,
    };
  }
  if (data.is_active !== true) {
    return {
      ok: false,
      error: "Select an active message template.",
      status: 400,
    };
  }

  return { ok: true };
}
