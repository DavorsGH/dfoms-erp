import { NextResponse } from "next/server";
import { requireDavorsPlatformSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { assertDavorsManagedLandlord } from "@/utils/maintenance-management";

type DeleteBody = {
  tenant_id?: string;
  expense_id?: string;
};

export async function POST(request: Request) {
  const auth = await requireDavorsPlatformSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  let body: DeleteBody;
  try {
    body = (await request.json()) as DeleteBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const expenseId = body.expense_id?.trim() ?? "";
  if (!expenseId) {
    return NextResponse.json(
      { error: "expense_id is required" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const landlord = await assertDavorsManagedLandlord(admin, body.tenant_id ?? "");
  if (!landlord.ok) {
    return NextResponse.json(
      { error: landlord.error },
      { status: landlord.status },
    );
  }

  const { data, error } = await admin
    .from("property_expenses")
    .delete()
    .eq("tenant_id", landlord.tenantId)
    .eq("expense_id", expenseId)
    .select("expense_id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (!data) {
    return NextResponse.json({ error: "Expense not found." }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
