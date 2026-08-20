import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import {
  loadClientQuotationDetail,
  updateClientQuotationStatus,
} from "@/utils/client-quotations-api";
import { normalizeQuotationStatus } from "@/utils/client-quotations-types";
import { CRM_QUOTATIONS_EDIT_ROLES } from "@/utils/rbac-access";
import { createClient } from "@/utils/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

const ALLOWED_STATUSES = new Set(["sent", "accepted", "declined"]);

export async function PATCH(request: Request, context: RouteContext) {
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

  const status =
    rawBody !== null &&
    typeof rawBody === "object" &&
    "status" in rawBody &&
    typeof rawBody.status === "string"
      ? normalizeQuotationStatus(rawBody.status)
      : null;

  if (!status || !ALLOWED_STATUSES.has(status)) {
    return NextResponse.json({ error: "Invalid quotation status." }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const existing = await loadClientQuotationDetail(supabase, auth.tenantId, id);
  if (existing.error || !existing.quotation) {
    return NextResponse.json(
      { error: existing.error ?? "Quotation not found." },
      { status: 404 },
    );
  }

  const { quotation, error } = await updateClientQuotationStatus(
    supabase,
    auth.tenantId,
    id,
    status,
  );

  if (error || !quotation) {
    return NextResponse.json(
      { error: error ?? "Unable to update quotation status." },
      { status: 400 },
    );
  }

  void import("@/utils/client-document-notifications").then(
    ({ notifyClientQuotationSent, shouldFireQuotationSentNotification }) => {
      if (
        shouldFireQuotationSentNotification(existing.quotation!.status, quotation.status)
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

        void import("@/utils/tenant-admin-director-tier2-notifications").then(
          ({ notifyAdminsDirectorsQuotationSent }) => {
            void notifyAdminsDirectorsQuotationSent(
              auth.tenantId,
              quotation.quotation_number,
              quotation.bill_to_name,
              Number(quotation.total_amount_due) || 0,
            );
          },
        );
      }
    },
  );

  return NextResponse.json({ client_quotation: quotation });
}
