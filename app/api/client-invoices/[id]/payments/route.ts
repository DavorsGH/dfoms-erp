import { NextResponse } from "next/server";
import { requireAuthenticated, requireTenantRoleIn } from "@/utils/admin-auth";
import { validateRecordPaymentBody, type RecordClientInvoicePaymentBody } from "@/utils/client-receipts-types";
import { FINANCE_SECTION_ROLES } from "@/utils/rbac-access";
import { createAdminClient } from "@/utils/supabase/admin";
import type { ClientInvoiceHeaderRow } from "@/utils/client-invoices-types";
import type { ClientReceiptHeaderRow } from "@/utils/client-receipts-types";

type RouteContext = {
  params: Promise<{ id: string }>;
};

type RecordClientInvoicePaymentRpcResult = {
  payment?: { id: string };
  receipt?: ClientReceiptHeaderRow;
  invoice?: ClientInvoiceHeaderRow;
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

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("record_client_invoice_payment", {
    p_tenant_id: auth.tenantId,
    p_invoice_id: invoiceId,
    p_payment_date: body.payment_date,
    p_amount: body.amount,
    p_payment_method: body.payment_method ?? null,
    p_notes: body.notes ?? null,
    p_recorded_by: session.userId,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const result = (data ?? {}) as RecordClientInvoicePaymentRpcResult;

  if (result.receipt?.id) {
    void import("@/utils/client-document-notifications").then(
      ({ notifyClientReceiptIssued }) => {
        void notifyClientReceiptIssued({
          tenantId: auth.tenantId,
          clientId: result.invoice!.client_id,
          receiptId: result.receipt!.id,
          receiptNumber: result.receipt!.receipt_number,
          invoiceNumber: result.invoice!.invoice_number,
          customerName:
            result.invoice!.bill_to_name?.trim() || result.invoice!.client_id,
          amount: String(result.receipt!.amount ?? ""),
          paymentDate: result.receipt!.receipt_date ?? "",
          invoiceTotalDue: result.invoice!.total_amount_due,
          whtRate: result.invoice!.wht_rate,
          whtAmount: result.invoice!.wht_amount,
        });
      },
    );
  }

  return NextResponse.json({
    payment: result.payment ?? null,
    receipt: result.receipt ?? null,
    client_invoice: result.invoice ?? null,
  });
}
