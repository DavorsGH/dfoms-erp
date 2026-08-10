import { NextResponse } from "next/server";
import { requireDavorsPlatformRealEstateStaff } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { assertDavorsManagedLandlord } from "@/utils/maintenance-management";

type UpdateBody = {
  tenant_id?: string;
  expense_id?: string;
  category?: string;
  amount_ghs?: number | string;
  expense_date?: string;
  description?: string | null;
  receipt_url?: string | null;
};

export async function POST(request: Request) {
  const auth = await requireDavorsPlatformRealEstateStaff();
  if (!auth.ok) {
    return auth.response;
  }

  let body: UpdateBody;
  try {
    body = (await request.json()) as UpdateBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const expenseId = body.expense_id?.trim() ?? "";
  const category = body.category?.trim() ?? "";
  const expenseDate = body.expense_date?.trim() ?? "";
  const description = body.description?.trim() || null;
  const receiptUrl =
    body.receipt_url == null || String(body.receipt_url).trim() === ""
      ? null
      : String(body.receipt_url).trim();
  const amount = Number(body.amount_ghs);

  if (!expenseId) {
    return NextResponse.json(
      { error: "expense_id is required" },
      { status: 400 },
    );
  }
  if (!category) {
    return NextResponse.json(
      { error: "category is required" },
      { status: 400 },
    );
  }
  if (!Number.isFinite(amount) || amount < 0) {
    return NextResponse.json(
      { error: "amount_ghs must be a non-negative number." },
      { status: 400 },
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) {
    return NextResponse.json(
      { error: "expense_date must be YYYY-MM-DD." },
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

  const { error: updateError } = await admin
    .from("property_expenses")
    .update({
      category,
      amount_ghs: amount,
      expense_date: expenseDate,
      description,
      receipt_url: receiptUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", landlord.tenantId)
    .eq("expense_id", expenseId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
