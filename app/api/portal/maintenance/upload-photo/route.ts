import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { getPortalLesseeSession } from "@/utils/lessee-portal-auth";
import { uploadPropertyPhoto } from "@/utils/property-photo";
import { normalizePhotoUrls } from "@/app/dashboard/real-estate/properties-utils";

/**
 * Tenant Portal: upload a photo onto an owned maintenance request.
 */
export async function POST(request: Request) {
  const session = await getPortalLesseeSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  const admin = createAdminClient();

  const { data: leaseIds } = await admin
    .from("leases")
    .select("lease_id")
    .eq("tenant_id", session.tenantId)
    .eq("lessee_id", session.lesseeId);

  const allowedLeaseIds = new Set(
    ((leaseIds as Array<{ lease_id: string }> | null) ?? []).map(
      (row) => row.lease_id,
    ),
  );

  const { data: existing, error: existingError } = await admin
    .from("maintenance_requests")
    .select("request_id, lease_id, photo_urls, reported_by")
    .eq("tenant_id", session.tenantId)
    .eq("request_id", requestId)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 400 });
  }
  if (
    !existing ||
    !allowedLeaseIds.has(existing.lease_id) ||
    existing.reported_by !== "tenant"
  ) {
    return NextResponse.json(
      { error: "Maintenance request not found." },
      { status: 404 },
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
