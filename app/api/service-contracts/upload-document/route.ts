import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import {
  assertServerRowWriteAccess,
  getServerAuthUid,
} from "@/utils/business-unit-access.server";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";
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

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const authUser = await getServerAuthUid(supabase);
  if (!authUser.ok) {
    return NextResponse.json({ error: authUser.error }, { status: authUser.status });
  }

  const rowAccess = await assertServerRowWriteAccess({
    supabase,
    tenantId: auth.tenantId,
    authUid: authUser.authUid,
    table: "service_contracts",
    rowId: contractId,
  });
  if (!rowAccess.ok) {
    return NextResponse.json({ error: rowAccess.error }, { status: rowAccess.status });
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
