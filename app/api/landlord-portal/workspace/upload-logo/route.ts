import { NextResponse } from "next/server";
import {
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import { LANDLORD_PORTAL_INACTIVE_LOGO_MESSAGE } from "@/utils/landlord-portal-access-messages";
import { createAdminClient } from "@/utils/supabase/admin";
import { uploadPropertyPhoto } from "@/utils/property-photo";

/**
 * Approved landlord uploads their workspace logo to landlords.logo_url.
 */
export async function POST(request: Request) {
  const session = await getLandlordPortalSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!landlordPortalHasDataAccess(session)) {
    return NextResponse.json(
      {
        error: LANDLORD_PORTAL_INACTIVE_LOGO_MESSAGE,
      },
      { status: 403 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const tenantId = session.tenantId;

  const { data: landlord, error: landlordError } = await admin
    .from("landlords")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (landlordError) {
    return NextResponse.json({ error: landlordError.message }, { status: 400 });
  }
  if (!landlord) {
    return NextResponse.json({ error: "Landlord not found." }, { status: 404 });
  }

  const uploadResult = await uploadPropertyPhoto(
    admin,
    tenantId,
    "landlord",
    tenantId,
    file,
  );
  if ("error" in uploadResult) {
    return NextResponse.json({ error: uploadResult.error }, { status: 400 });
  }

  const { error: updateError } = await admin
    .from("landlords")
    .update({
      logo_url: uploadResult.storagePath,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    logo_url: uploadResult.storagePath,
  });
}
