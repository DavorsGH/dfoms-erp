import { NextResponse } from "next/server";
import { requirePlatformOnlyLandlordSession } from "@/utils/landlord-portal-auth";
import { uploadPropertyPhoto } from "@/utils/property-photo";

/**
 * Platform-only landlords upload expense receipts for their own tenant_id.
 * Mirrors staff /api/admin/expenses/upload-receipt using property-photo util.
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

  const { data: existing, error: existingError } = await auth.admin
    .from("property_expenses")
    .select("expense_id")
    .eq("tenant_id", auth.session.tenantId)
    .eq("expense_id", expenseId)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 400 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Expense not found." }, { status: 404 });
  }

  const uploadResult = await uploadPropertyPhoto(
    auth.admin,
    auth.session.tenantId,
    "expense",
    expenseId,
    file,
  );
  if ("error" in uploadResult) {
    return NextResponse.json({ error: uploadResult.error }, { status: 400 });
  }

  const { error: updateError } = await auth.admin
    .from("property_expenses")
    .update({
      receipt_url: uploadResult.storagePath,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", auth.session.tenantId)
    .eq("expense_id", expenseId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    receipt_url: uploadResult.storagePath,
  });
}
