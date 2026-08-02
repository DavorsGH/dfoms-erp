import { NextResponse } from "next/server";
import { requirePlatformOnlyLandlordSession } from "@/utils/landlord-portal-auth";

type CreateBody = {
  property_id?: string;
  category?: string;
  amount_ghs?: number | string;
  expense_date?: string;
  description?: string | null;
};

/**
 * Platform-only landlords log property_expenses for their own tenant_id.
 * Uses service role after session checks (no landlord JWT write RLS yet —
 * SCHEMA FLAG: optional SELECT/INSERT policies on property_expenses).
 */
export async function POST(request: Request) {
  const auth = await requirePlatformOnlyLandlordSession();
  if (!auth.ok) {
    return auth.response;
  }

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const propertyId = body.property_id?.trim() ?? "";
  const category = body.category?.trim() ?? "";
  const expenseDate = body.expense_date?.trim() ?? "";
  const description = body.description?.trim() || null;
  const amount = Number(body.amount_ghs);

  if (!propertyId) {
    return NextResponse.json(
      { error: "property_id is required" },
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

  const { data: property, error: propertyError } = await auth.admin
    .from("properties")
    .select("property_id")
    .eq("tenant_id", auth.session.tenantId)
    .eq("property_id", propertyId)
    .maybeSingle();

  if (propertyError) {
    return NextResponse.json({ error: propertyError.message }, { status: 400 });
  }
  if (!property) {
    return NextResponse.json({ error: "Property not found." }, { status: 404 });
  }

  const nowIso = new Date().toISOString();
  const expenseId = crypto.randomUUID();

  const { error: insertError } = await auth.admin.from("property_expenses").insert({
    tenant_id: auth.session.tenantId,
    expense_id: expenseId,
    property_id: propertyId,
    category,
    amount_ghs: amount,
    expense_date: expenseDate,
    description,
    receipt_url: null,
    created_at: nowIso,
    updated_at: nowIso,
  });

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    expense_id: expenseId,
  });
}
