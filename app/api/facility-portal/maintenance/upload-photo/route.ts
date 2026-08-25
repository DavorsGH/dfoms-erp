import { NextResponse } from "next/server";
import { normalizePhotoUrls } from "@/app/dashboard/real-estate/properties-utils";
import { requireFacilityManagerSession } from "@/utils/facility-portal-auth";
import { assertFacilityLeaseOnAssignedProperty } from "@/utils/facility-portal-data";
import { uploadPropertyPhoto } from "@/utils/property-photo";

export async function POST(request: Request) {
  const auth = await requireFacilityManagerSession();
  if (!auth.ok) {
    return auth.response;
  }

  const { session, admin } = auth;
  if (!session.canManageMaintenance) {
    return NextResponse.json(
      { error: "You do not have permission to manage maintenance." },
      { status: 403 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

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

  const { data: existing, error: existingError } = await admin
    .from("maintenance_requests")
    .select("request_id, lease_id, photo_urls")
    .eq("tenant_id", session.tenantId)
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

  const leaseCheck = await assertFacilityLeaseOnAssignedProperty(
    admin,
    session,
    existing.lease_id as string,
  );
  if (!leaseCheck.ok) {
    return NextResponse.json(
      { error: leaseCheck.error },
      { status: leaseCheck.status },
    );
  }

  const uploadResult = await uploadPropertyPhoto(
    admin,
    session.tenantId,
    "maintenance",
    requestId,
    file,
  );
  if ("error" in uploadResult) {
    return NextResponse.json({ error: uploadResult.error }, { status: 400 });
  }

  const nextUrls = [
    ...normalizePhotoUrls(existing.photo_urls),
    uploadResult.storagePath,
  ];

  const { error: updateError } = await admin
    .from("maintenance_requests")
    .update({
      photo_urls: nextUrls,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", session.tenantId)
    .eq("request_id", requestId);

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
