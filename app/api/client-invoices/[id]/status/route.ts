import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import {
  loadClientInvoiceDetail,
  updateClientInvoiceStatus,
} from "@/utils/client-invoices-api";
import { normalizeStatus } from "@/utils/client-invoices-types";
import { FINANCE_SECTION_ROLES } from "@/utils/rbac-access";
import { createClient } from "@/utils/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const ALLOWED_STATUSES = new Set(["sent", "paid"]);

export async function PATCH(request: Request, context: RouteContext) {
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

  const status =
    rawBody !== null &&
    typeof rawBody === "object" &&
    "status" in rawBody &&
    typeof rawBody.status === "string"
      ? normalizeStatus(rawBody.status)
      : null;

  if (!status || !ALLOWED_STATUSES.has(status)) {
    return NextResponse.json({ error: "Invalid invoice status." }, { status: 400 });
  }

  const nextStatus = status as "sent" | "paid";

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const existing = await loadClientInvoiceDetail(supabase, auth.tenantId, id);
  if (existing.error || !existing.invoice) {
    return NextResponse.json(
      { error: existing.error ?? "Invoice not found." },
      { status: 404 },
    );
  }

  const { invoice, error } = await updateClientInvoiceStatus(
    supabase,
    auth.tenantId,
    id,
    nextStatus,
  );

  if (error || !invoice) {
    return NextResponse.json(
      { error: error ?? "Unable to update invoice status." },
      { status: 400 },
    );
  }

  if (nextStatus === "sent") {
    void Promise.all([
      import("@/utils/client-document-notifications"),
      import("@/utils/tenant-admin-director-tier2-notifications"),
    ]).then(
      ([
        { notifyClientInvoiceSent, shouldFireInvoiceSentNotification },
        { notifyAdminsDirectorsInvoiceSent },
      ]) => {
        if (
          !shouldFireInvoiceSentNotification(
            existing.invoice!.status,
            invoice.status,
          )
        ) {
          return;
        }

        void notifyClientInvoiceSent({
          tenantId: auth.tenantId,
          clientId: invoice.client_id,
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoice_number,
          customerName: invoice.bill_to_name?.trim() || invoice.client_id,
          amount: String(invoice.total_amount_due ?? ""),
          dueDate: invoice.due_date ?? "",
        });

        void notifyAdminsDirectorsInvoiceSent(
          auth.tenantId,
          invoice.invoice_number,
          invoice.bill_to_name,
          Number(invoice.total_amount_due) || 0,
        );
      },
    );
  }

  return NextResponse.json({ client_invoice: invoice });
}
