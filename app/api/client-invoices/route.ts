import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import {
  createClientInvoice,
  getNextInvoiceSequence,
} from "@/utils/client-invoices-api";
import {
  CLIENT_INVOICE_LIST_SELECT,
  validateClientInvoiceBody,
  type ClientInvoiceListRow,
  type ClientInvoiceWriteBody,
} from "@/utils/client-invoices-types";
import { FINANCE_SECTION_ROLES } from "@/utils/rbac-access";
import { createClient } from "@/utils/supabase/server";

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

export async function GET() {
  const auth = await requireTenantRoleIn(FINANCE_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const supabase = await getTenantSupabase();
  const { data, error } = await supabase
    .from("client_invoices")
    .select(CLIENT_INVOICE_LIST_SELECT)
    .eq("tenant_id", auth.tenantId)
    .order("invoice_date", { ascending: false })
    .order("invoice_sequence", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { sequence, error: sequenceError } = await getNextInvoiceSequence(
    supabase,
    auth.tenantId,
  );

  if (sequenceError) {
    return NextResponse.json({ error: sequenceError }, { status: 500 });
  }

  return NextResponse.json({
    client_invoices: (data as ClientInvoiceListRow[] | null) ?? [],
    next_invoice_sequence: sequence,
  });
}

export async function POST(request: Request) {
  const auth = await requireTenantRoleIn(FINANCE_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

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
  const { invoice, error } = await createClientInvoice(
    supabase,
    auth.tenantId,
    body,
  );

  if (error || !invoice) {
    return NextResponse.json(
      { error: error ?? "Unable to create invoice." },
      { status: 400 },
    );
  }

  return NextResponse.json({ client_invoice: invoice });
}
