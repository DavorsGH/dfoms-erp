import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import {
  loadClientInvoiceDetail,
  updateClientInvoice,
} from "@/utils/client-invoices-api";
import {
  validateClientInvoiceBody,
  type ClientInvoiceWriteBody,
} from "@/utils/client-invoices-types";
import { FINANCE_SECTION_ROLES } from "@/utils/rbac-access";
import { PAYMENT_ACCOUNT_SELECT, type PaymentAccountRow } from "@/utils/payment-accounts-types";
import { createClient } from "@/utils/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

async function getTenantSupabase() {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

function rejectClientTenantId(body: unknown): NextResponse | null {
  if (body !== null && typeof body === "object" && "tenant_id" in body) {
    return NextResponse.json(
      { error: "tenant_id cannot be set by client" },
      { status: 400 },
    );
  }

  return null;
}

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireTenantRoleIn(FINANCE_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  const supabase = await getTenantSupabase();
  const detail = await loadClientInvoiceDetail(supabase, auth.tenantId, id);

  if (detail.error || !detail.invoice) {
    return NextResponse.json(
      { error: detail.error ?? "Invoice not found." },
      { status: detail.error === "Invoice not found." ? 404 : 500 },
    );
  }

  let paymentAccounts: PaymentAccountRow[] = [];

  if (detail.payment_account_ids.length > 0) {
    const { data, error: paymentAccountsError } = await supabase
      .from("payment_accounts")
      .select(PAYMENT_ACCOUNT_SELECT)
      .eq("tenant_id", auth.tenantId)
      .in("id", detail.payment_account_ids);

    if (paymentAccountsError) {
      return NextResponse.json(
        { error: paymentAccountsError.message },
        { status: 500 },
      );
    }

    paymentAccounts = (data as PaymentAccountRow[] | null) ?? [];
  }

  return NextResponse.json({
    client_invoice: detail.invoice,
    line_items: detail.line_items,
    payment_account_ids: detail.payment_account_ids,
    payment_accounts: paymentAccounts,
  });
}

export async function PUT(request: Request, context: RouteContext) {
  const auth = await requireTenantRoleIn(FINANCE_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const tenantRejection = rejectClientTenantId(rawBody);
  if (tenantRejection) {
    return tenantRejection;
  }

  const body = rawBody as ClientInvoiceWriteBody;
  const validationError = validateClientInvoiceBody(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const supabase = await getTenantSupabase();
  const existing = await loadClientInvoiceDetail(supabase, auth.tenantId, id);

  if (existing.error || !existing.invoice) {
    return NextResponse.json(
      { error: existing.error ?? "Invoice not found." },
      { status: 404 },
    );
  }

  const { invoice, error } = await updateClientInvoice(
    supabase,
    auth.tenantId,
    id,
    body,
    existing.invoice.invoice_sequence,
    existing.invoice.invoice_number,
  );

  if (error || !invoice) {
    return NextResponse.json(
      { error: error ?? "Unable to update invoice." },
      { status: 400 },
    );
  }

  return NextResponse.json({ client_invoice: invoice });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireTenantRoleIn(FINANCE_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  const supabase = await getTenantSupabase();

  const existing = await loadClientInvoiceDetail(supabase, auth.tenantId, id);
  if (existing.error || !existing.invoice) {
    return NextResponse.json(
      { error: existing.error ?? "Invoice not found." },
      { status: 404 },
    );
  }

  const { error } = await supabase
    .from("client_invoices")
    .delete()
    .eq("id", id)
    .eq("tenant_id", auth.tenantId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
