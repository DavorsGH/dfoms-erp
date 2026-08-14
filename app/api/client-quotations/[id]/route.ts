import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireRoleIn, requireTenantRoleIn } from "@/utils/admin-auth";
import {
  loadClientQuotationDetail,
  updateClientQuotation,
} from "@/utils/client-quotations-api";
import {
  validateClientQuotationBody,
  type ClientQuotationWriteBody,
} from "@/utils/client-quotations-types";
import {
  CLIENT_PORTAL_SECTION_ROLES,
  CRM_QUOTATIONS_EDIT_ROLES,
} from "@/utils/rbac-access";
import { PAYMENT_ACCOUNT_SELECT, type PaymentAccountRow } from "@/utils/payment-accounts-types";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";

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

async function authorizeQuotationAccess() {
  const staffAuth = await requireTenantRoleIn(CRM_QUOTATIONS_EDIT_ROLES);
  if (staffAuth.ok) {
    return { ok: true as const, tenantId: staffAuth.tenantId, isClientPortal: false };
  }

  const clientAuth = await requireRoleIn(CLIENT_PORTAL_SECTION_ROLES);
  if (!clientAuth.ok) {
    return { ok: false as const, response: clientAuth.response };
  }

  const tenantId = await getCurrentUserTenantId();
  if (!tenantId) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { ok: true as const, tenantId, isClientPortal: true };
}

export async function GET(_request: Request, context: RouteContext) {
  const auth = await authorizeQuotationAccess();
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  const supabase = await getTenantSupabase();
  const detail = await loadClientQuotationDetail(supabase, auth.tenantId, id);

  if (detail.error || !detail.quotation) {
    return NextResponse.json(
      { error: detail.error ?? "Quotation not found." },
      { status: detail.error === "Quotation not found." ? 404 : 500 },
    );
  }

  if (auth.isClientPortal && detail.quotation.status === "draft") {
    return NextResponse.json({ error: "Quotation not found." }, { status: 404 });
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
    client_quotation: auth.isClientPortal
      ? (({ internal_notes: _internalNotes, ...clientSafeQuotation }) =>
          clientSafeQuotation)(detail.quotation)
      : detail.quotation,
    line_items: detail.line_items,
    payment_account_ids: detail.payment_account_ids,
    payment_accounts: paymentAccounts,
  });
}

export async function PUT(request: Request, context: RouteContext) {
  const auth = await requireTenantRoleIn(CRM_QUOTATIONS_EDIT_ROLES);
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

  const body = rawBody as ClientQuotationWriteBody;
  const validationError = validateClientQuotationBody(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const supabase = await getTenantSupabase();
  const existing = await loadClientQuotationDetail(supabase, auth.tenantId, id);

  if (existing.error || !existing.quotation) {
    return NextResponse.json(
      { error: existing.error ?? "Quotation not found." },
      { status: 404 },
    );
  }

  if (existing.quotation.converted_invoice_id) {
    return NextResponse.json(
      { error: "Converted quotations cannot be edited." },
      { status: 400 },
    );
  }

  const { quotation, error } = await updateClientQuotation(
    supabase,
    auth.tenantId,
    id,
    body,
    existing.quotation.quotation_sequence,
    existing.quotation.quotation_number,
  );

  if (error || !quotation) {
    return NextResponse.json(
      { error: error ?? "Unable to update quotation." },
      { status: 400 },
    );
  }

  void import("@/utils/client-document-notifications").then(
    ({ notifyClientQuotationSent, shouldFireQuotationSentNotification }) => {
      if (
        shouldFireQuotationSentNotification(
          existing.quotation.status,
          quotation.status,
        )
      ) {
        void notifyClientQuotationSent({
          tenantId: auth.tenantId,
          clientId: quotation.client_id,
          quotationId: quotation.id,
          quotationNumber: quotation.quotation_number,
          customerName: quotation.bill_to_name?.trim() || quotation.client_id,
          amount: String(quotation.total_amount_due ?? ""),
          validUntil: quotation.valid_until ?? "",
        });
      }
    },
  );

  return NextResponse.json({ client_quotation: quotation });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireTenantRoleIn(CRM_QUOTATIONS_EDIT_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  const supabase = await getTenantSupabase();

  const existing = await loadClientQuotationDetail(supabase, auth.tenantId, id);
  if (existing.error || !existing.quotation) {
    return NextResponse.json(
      { error: existing.error ?? "Quotation not found." },
      { status: 404 },
    );
  }

  if (existing.quotation.converted_invoice_id) {
    return NextResponse.json(
      { error: "Converted quotations cannot be deleted." },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from("client_quotations")
    .delete()
    .eq("id", id)
    .eq("tenant_id", auth.tenantId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
