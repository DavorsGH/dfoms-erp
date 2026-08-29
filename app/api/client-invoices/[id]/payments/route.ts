import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireAuthenticated, requireTenantRoleIn } from "@/utils/admin-auth";
import { recordClientInvoicePayment } from "@/utils/client-invoice-payments-api";
import { validateRecordPaymentBody, type RecordClientInvoicePaymentBody } from "@/utils/client-receipts-types";
import { FINANCE_SECTION_ROLES } from "@/utils/rbac-access";
import { createClient } from "@/utils/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireTenantRoleIn(FINANCE_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const session = await requireAuthenticated();
  if (!session.ok) {
    return session.response;
  }

  const { id: invoiceId } = await context.params;

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

  const body = rawBody as RecordClientInvoicePaymentBody;
  const validationError = validateRecordPaymentBody(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const result = await recordClientInvoicePayment(
    supabase,
    auth.tenantId,
    invoiceId,
    body,
    session.userId,
  );

  if (result.error && !result.payment) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    payment: result.payment,
    receipt: result.receipt,
    client_invoice: result.invoice,
    warning: result.error && result.payment ? result.error : undefined,
  });
}
