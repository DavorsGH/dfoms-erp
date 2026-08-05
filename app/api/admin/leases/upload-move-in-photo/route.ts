import { NextResponse } from "next/server";
import { requireDavorsPlatformSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { assertRealEstateLandlordTenant } from "@/utils/property-management";
import { uploadPropertyPhoto } from "@/utils/property-photo";
import { normalizePhotoUrls } from "@/app/dashboard/real-estate/properties-utils";

export async function POST(request: Request) {
  const auth = await requireDavorsPlatformSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  const leaseId = String(formData.get("lease_id") ?? "").trim();
  const file = formData.get("file");

  if (!leaseId) {
    return NextResponse.json({ error: "lease_id is required" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const landlord = await assertRealEstateLandlordTenant(admin, tenantId);
  if (!landlord.ok) {
    return NextResponse.json(
      { error: landlord.error },
      { status: landlord.status },
    );
  }

  const { data: existing, error: existingError } = await admin
    .from("leases")
    .select("lease_id, move_in_condition_photo_urls")
    .eq("tenant_id", landlord.tenantId)
    .eq("lease_id", leaseId)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 400 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Lease not found." }, { status: 404 });
  }

  const uploadResult = await uploadPropertyPhoto(
    admin,
    landlord.tenantId,
    "lease",
    leaseId,
    file,
  );
  if ("error" in uploadResult) {
    return NextResponse.json({ error: uploadResult.error }, { status: 400 });
  }

  const nextUrls = [
    ...normalizePhotoUrls(existing.move_in_condition_photo_urls),
    uploadResult.storagePath,
  ];

  const { error: updateError } = await admin
    .from("leases")
    .update({
      move_in_condition_photo_urls: nextUrls,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", landlord.tenantId)
    .eq("lease_id", leaseId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    storagePath: uploadResult.storagePath,
    signedUrl: uploadResult.signedUrl,
    photo_urls: nextUrls,
  });
}
