import { NextResponse } from "next/server";
import { requireDavorsPlatformSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { assertDavorsManagedLandlord } from "@/utils/maintenance-management";
import { uploadPropertyPhoto } from "@/utils/property-photo";

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
  const expenseId = String(formData.get("expense_id") ?? "").trim();
  const file = formData.get("file");

  if (!expenseId) {
    return NextResponse.json(
      { error: "expense_id is required" },
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
    .from("property_expenses")
    .select("expense_id")
    .eq("tenant_id", landlord.tenantId)
    .eq("expense_id", expenseId)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 400 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Expense not found." }, { status: 404 });
  }

  const uploadResult = await uploadPropertyPhoto(
    admin,
    landlord.tenantId,
    "expense",
    expenseId,
    file,
  );
  if ("error" in uploadResult) {
    return NextResponse.json({ error: uploadResult.error }, { status: 400 });
  }

  const { error: updateError } = await admin
    .from("property_expenses")
    .update({
      receipt_url: uploadResult.publicUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", landlord.tenantId)
    .eq("expense_id", expenseId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    receipt_url: uploadResult.publicUrl,
  });
}
