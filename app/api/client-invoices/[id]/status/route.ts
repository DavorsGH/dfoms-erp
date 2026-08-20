import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { updateClientInvoiceStatus } from "@/utils/client-invoices-api";
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

  return NextResponse.json({ client_invoice: invoice });
}
