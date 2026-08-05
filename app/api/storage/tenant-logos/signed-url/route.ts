import { NextResponse } from "next/server";
import { requireDavorsPlatformSuperAdmin } from "@/utils/admin-auth";
import { getLandlordPortalSession } from "@/utils/landlord-portal-auth";
import { getPortalLesseeSession } from "@/utils/lessee-portal-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  createTenantLogosSignedUrl,
  extractTenantLogosStoragePath,
  tenantIdFromTenantLogosStoragePath,
  TENANT_LOGOS_SIGNED_URL_TTL_SECONDS,
} from "@/utils/tenant-logos-storage";

export const runtime = "nodejs";

/**
 * Issue a short-lived signed URL for a tenant-logos object.
 * Used by client edit UIs that store storage paths and need fresh img src values.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const reference = searchParams.get("reference")?.trim() ?? "";
  const requestedTenantId = searchParams.get("tenant_id")?.trim() ?? "";

  if (!reference) {
    return NextResponse.json({ error: "reference is required." }, { status: 400 });
  }

  const storagePath = extractTenantLogosStoragePath(reference);
  if (!storagePath) {
    return NextResponse.json(
      { error: "Not a tenant-logos storage reference." },
      { status: 400 },
    );
  }

  const objectTenantId = tenantIdFromTenantLogosStoragePath(storagePath);
  if (!objectTenantId) {
    return NextResponse.json({ error: "Invalid storage path." }, { status: 400 });
  }

  const [portalSession, landlordSession, staffAuth] = await Promise.all([
    getPortalLesseeSession(),
    getLandlordPortalSession(),
    requireDavorsPlatformSuperAdmin(),
  ]);

  let authorizedTenantId: string | null = null;

  if (portalSession && portalSession.tenantId === objectTenantId) {
    authorizedTenantId = portalSession.tenantId;
  } else if (
    landlordSession &&
    landlordSession.tenantId === objectTenantId
  ) {
    authorizedTenantId = landlordSession.tenantId;
  } else if (staffAuth.ok) {
    authorizedTenantId = requestedTenantId || objectTenantId;
    if (authorizedTenantId !== objectTenantId) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }
  }

  if (!authorizedTenantId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const admin = createAdminClient();
  const signedUrl = await createTenantLogosSignedUrl(admin, storagePath);

  if (!signedUrl) {
    return NextResponse.json(
      { error: "Failed to create signed URL." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    signedUrl,
    expiresIn: TENANT_LOGOS_SIGNED_URL_TTL_SECONDS,
  });
}
