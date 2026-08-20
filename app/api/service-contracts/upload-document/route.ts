import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { uploadServiceContractDocument } from "@/utils/service-contract-document-upload";
import { FINANCE_SECTION_ROLES } from "@/utils/rbac-access";

export async function POST(request: Request) {
  const auth = await requireTenantRoleIn(FINANCE_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const contractId = String(formData.get("contract_id") ?? "").trim();
  const file = formData.get("file");

  if (!contractId) {
    return NextResponse.json({ error: "contract_id is required" }, { status: 400 });
  }

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: existing, error: existingError } = await admin
    .from("service_contracts")
    .select("id")
    .eq("tenant_id", auth.tenantId)
    .eq("id", contractId)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 400 });
  }

  if (!existing) {
    return NextResponse.json({ error: "Service contract not found." }, { status: 404 });
  }

  const uploadResult = await uploadServiceContractDocument(
    admin,
    auth.tenantId,
    contractId,
    file,
  );

  if ("error" in uploadResult) {
    return NextResponse.json({ error: uploadResult.error }, { status: 400 });
  }

  const { error: updateError } = await admin
    .from("service_contracts")
    .update({
      document_url: uploadResult.storagePath,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", auth.tenantId)
    .eq("id", contractId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({
    document_url: uploadResult.storagePath,
    signed_url: uploadResult.signedUrl,
  });
}
