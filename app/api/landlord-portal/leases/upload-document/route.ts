import { NextResponse } from "next/server";
import { requirePlatformOnlyLandlordSession } from "@/utils/landlord-portal-auth";
import { uploadLeaseDocument } from "@/utils/lease-document";

export const runtime = "nodejs";

/**
 * platform_only: upload or clear a custom lease document on the landlord's own lease.
 * davors_managed must use staff ERP upload. Mirrors /api/admin/leases/upload-document.
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
  const action = String(formData.get("action") ?? "upload").trim();
  const file = formData.get("file");

  if (!leaseId) {
    return NextResponse.json({ error: "lease_id is required" }, { status: 400 });
  }

  const { data: existing, error: existingError } = await auth.admin
    .from("leases")
    .select("lease_id")
    .eq("tenant_id", auth.session.tenantId)
    .eq("lease_id", leaseId)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 400 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Lease not found." }, { status: 404 });
  }

  if (action === "remove") {
    const { error: updateError } = await auth.admin
      .from("leases")
      .update({
        lease_document_url: null,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", auth.session.tenantId)
      .eq("lease_id", leaseId);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      lease_document_url: null,
    });
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const uploadResult = await uploadLeaseDocument(
    auth.admin,
    auth.session.tenantId,
    leaseId,
    file,
  );
  if ("error" in uploadResult) {
    return NextResponse.json({ error: uploadResult.error }, { status: 400 });
  }

  const { error: updateError } = await auth.admin
    .from("leases")
    .update({
      lease_document_url: uploadResult.publicUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", auth.session.tenantId)
    .eq("lease_id", leaseId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    lease_document_url: uploadResult.publicUrl,
  });
}
