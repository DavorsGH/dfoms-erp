import { NextResponse } from "next/server";
import { requireDavorsPlatformSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { assertDavorsManagedLandlord } from "@/utils/maintenance-management";
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
  const requestId = String(formData.get("request_id") ?? "").trim();
  const file = formData.get("file");

  if (!requestId) {
    return NextResponse.json(
      { error: "request_id is required" },
      { status: 400 },
    );
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const landlord = await assertDavorsManagedLandlord(admin, tenantId);
  if (!landlord.ok) {
    return NextResponse.json(
      { error: landlord.error },
      { status: landlord.status },
    );
  }

  const { data: existing, error: existingError } = await admin
    .from("maintenance_requests")
    .select("request_id, photo_urls")
    .eq("tenant_id", landlord.tenantId)
    .eq("request_id", requestId)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 400 });
  }
  if (!existing) {
    return NextResponse.json(
      { error: "Maintenance request not found." },
      { status: 404 },
    );
  }

  const uploadResult = await uploadPropertyPhoto(
    admin,
    landlord.tenantId,
    "maintenance",
    requestId,
    file,
  );
  if ("error" in uploadResult) {
    return NextResponse.json({ error: uploadResult.error }, { status: 400 });
  }

  const nextUrls = [
    ...normalizePhotoUrls(existing.photo_urls),
    uploadResult.publicUrl,
  ];

  const { error: updateError } = await admin
    .from("maintenance_requests")
    .update({
      photo_urls: nextUrls,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", landlord.tenantId)
    .eq("request_id", requestId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    publicUrl: uploadResult.publicUrl,
    photo_urls: nextUrls,
  });
}
