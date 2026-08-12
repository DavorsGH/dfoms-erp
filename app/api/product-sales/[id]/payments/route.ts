import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireAuthenticated, requireTenantRoleIn } from "@/utils/admin-auth";
import { recordProductSalePayment } from "@/utils/product-sale-payments-api";
import {
  validateRecordProductSalePaymentBody,
  type RecordProductSalePaymentBody,
} from "@/utils/product-sale-payments-types";
import { CRM_SECTION_ROLES } from "@/utils/rbac-access";
import { createClient } from "@/utils/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireTenantRoleIn(CRM_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const session = await requireAuthenticated();
  if (!session.ok) {
    return session.response;
  }

  const { id: incomeId } = await context.params;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (rawBody !== null && typeof rawBody === "object" && "tenant_id" in rawBody) {
    return NextResponse.json(
      { error: "tenant_id cannot be set by client" },
      { status: 400 },
    );
  }

  const body = rawBody as RecordProductSalePaymentBody;
  const validationError = validateRecordProductSalePaymentBody(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const result = await recordProductSalePayment(
    supabase,
    auth.tenantId,
    incomeId,
    body,
    session.userId,
  );

  if (result.error || !result.payment) {
    return NextResponse.json(
      { error: result.error ?? "Unable to record payment." },
      { status: 400 },
    );
  }

  return NextResponse.json({
    payment: result.payment,
    income: result.income,
  });
}
