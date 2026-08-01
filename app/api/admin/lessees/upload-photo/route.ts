import { NextResponse } from "next/server";
import { requireDavorsPlatformSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { assertRealEstateLandlordTenant } from "@/utils/property-management";
import { uploadPropertyPhoto } from "@/utils/property-photo";

/**
 * Staff: upload/replace a single profile photo for a lessee (tenant person).
 */
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
  const lesseeId = String(formData.get("lessee_id") ?? "").trim();
  const file = formData.get("file");

  if (!lesseeId) {
    return NextResponse.json(
      { error: "lessee_id is required" },
      { status: 400 },
    );
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
    .from("lessees")
    .select("lessee_id")
    .eq("tenant_id", landlord.tenantId)
    .eq("lessee_id", lesseeId)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 400 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Tenant not found." }, { status: 404 });
  }

  const uploadResult = await uploadPropertyPhoto(
    admin,
    landlord.tenantId,
    "lessee",
    lesseeId,
    file,
  );
  if ("error" in uploadResult) {
    return NextResponse.json({ error: uploadResult.error }, { status: 400 });
  }

  const { error: updateError } = await admin
    .from("lessees")
    .update({
      photo_url: uploadResult.publicUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", landlord.tenantId)
    .eq("lessee_id", lesseeId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    photo_url: uploadResult.publicUrl,
  });
}
