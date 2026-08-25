import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireRoleIn, requireTenantRoleIn } from "@/utils/admin-auth";
import { deleteTaxLedgerEntriesForSource } from "@/app/dashboard/finance/tax-ledger-sync";
import {
  findClientInvoiceIncomeRegisterId,
  loadClientInvoiceDetail,
  updateClientInvoice,
} from "@/utils/client-invoices-api";
import {
  validateClientInvoiceBody,
  type ClientInvoiceWriteBody,
} from "@/utils/client-invoices-types";
import {
  CLIENT_PORTAL_SECTION_ROLES,
  FINANCE_SECTION_ROLES,
} from "@/utils/rbac-access";
import { PAYMENT_ACCOUNT_SELECT, type PaymentAccountRow } from "@/utils/payment-accounts-types";
import { loadClientReceiptsForInvoice } from "@/utils/client-invoice-payments-api";
import { createClient } from "@/utils/supabase/server";
import {
  getCurrentUserClientId,
  getCurrentUserTenantId,
} from "@/utils/dashboard-auth";

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

async function authorizeInvoiceReadAccess() {
  const staffAuth = await requireTenantRoleIn(FINANCE_SECTION_ROLES);
  if (staffAuth.ok) {
    return {
      ok: true as const,
      tenantId: staffAuth.tenantId,
      isClientPortal: false,
      clientId: null as string | null,
    };
  }

  const clientAuth = await requireRoleIn(CLIENT_PORTAL_SECTION_ROLES);
  if (!clientAuth.ok) {
    return { ok: false as const, response: clientAuth.response };
  }

  const tenantId = await getCurrentUserTenantId();
  const clientId = await getCurrentUserClientId();
  if (!tenantId || !clientId) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return {
    ok: true as const,
    tenantId,
    isClientPortal: true,
    clientId,
  };
}

export async function GET(_request: Request, context: RouteContext) {
  const auth = await authorizeInvoiceReadAccess();
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

  if (auth.isClientPortal) {
    if (detail.invoice.client_id !== auth.clientId) {
      return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    }
    if (detail.invoice.status === "draft") {
      return NextResponse.json({ error: "Invoice not found." }, { status: 404 });
    }
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

  const receiptsResult = await loadClientReceiptsForInvoice(
    supabase,
    auth.tenantId,
    id,
  );

  if (receiptsResult.error) {
    return NextResponse.json({ error: receiptsResult.error }, { status: 500 });
  }

  return NextResponse.json({
    client_invoice: detail.invoice,
    line_items: detail.line_items,
    payment_account_ids: detail.payment_account_ids,
    payment_accounts: paymentAccounts,
    receipts: receiptsResult.receipts,
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

  if (existing.invoice.status === "voided") {
    return NextResponse.json(
      { error: "Voided invoices cannot be edited." },
      { status: 400 },
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

  if (existing.invoice.status !== "draft") {
    return NextResponse.json(
      {
        error:
          "Only draft invoices can be deleted. Use Void for sent or later invoices.",
      },
      { status: 400 },
    );
  }

  // Drafts should not have income_register rows; clear tax legs if a stray
  // row exists, then hard-delete. Linked income_register rows cascade via
  // client_invoice_id when that FK is populated.
  const { incomeId } = await findClientInvoiceIncomeRegisterId(
    supabase,
    auth.tenantId,
    existing.invoice.invoice_number,
    existing.invoice.id,
  );

  const { error } = await supabase
    .from("client_invoices")
    .delete()
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .eq("status", "draft");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (incomeId) {
    const { error: ledgerError } = await deleteTaxLedgerEntriesForSource(
      supabase,
      "income_register",
      incomeId,
    );

    if (ledgerError) {
      return NextResponse.json({
        success: true,
        warning: `Invoice deleted, but its tax ledger entries could not be removed: ${ledgerError}`,
      });
    }

    await supabase
      .from("income_register")
      .delete()
      .eq("id", incomeId)
      .eq("tenant_id", auth.tenantId);
  }

  return NextResponse.json({ success: true });
}
