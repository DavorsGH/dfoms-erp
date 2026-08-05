import { NextResponse } from "next/server";
import { requirePlatformOnlyLandlordSession } from "@/utils/landlord-portal-auth";
import { uploadPropertyPhoto } from "@/utils/property-photo";
import { normalizePhotoUrls } from "@/app/dashboard/real-estate/properties-utils";

/**
 * platform_only: upload move-in condition photos for a lease on the landlord's tenant.
 */
export async function POST(request: Request) {
  const auth = await requirePlatformOnlyLandlordSession();
  if (!auth.ok) {
    return auth.response;
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const leaseId = String(formData.get("lease_id") ?? "").trim();
  const file = formData.get("file");

  if (!leaseId) {
    return NextResponse.json({ error: "lease_id is required" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const tenantId = auth.session.tenantId;

  const { data: existing, error: existingError } = await auth.admin
    .from("leases")
    .select("lease_id, move_in_condition_photo_urls")
    .eq("tenant_id", tenantId)
    .eq("lease_id", leaseId)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 400 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Lease not found." }, { status: 404 });
  }

  const uploadResult = await uploadPropertyPhoto(
    auth.admin,
    tenantId,
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

  const { error: updateError } = await auth.admin
    .from("leases")
    .update({
      move_in_condition_photo_urls: nextUrls,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId)
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
