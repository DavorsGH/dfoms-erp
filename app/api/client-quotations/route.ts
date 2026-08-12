import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import {
  createClientQuotation,
  getNextQuotationSequence,
  peekNextQuotationNumber,
} from "@/utils/client-quotations-api";
import {
  CLIENT_QUOTATION_LIST_SELECT,
  validateClientQuotationBody,
  type ClientQuotationListRow,
  type ClientQuotationWriteBody,
} from "@/utils/client-quotations-types";
import { CRM_QUOTATIONS_EDIT_ROLES } from "@/utils/rbac-access";
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
  const auth = await requireTenantRoleIn(CRM_QUOTATIONS_EDIT_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const supabase = await getTenantSupabase();
  const { data, error } = await supabase
    .from("client_quotations")
    .select(CLIENT_QUOTATION_LIST_SELECT)
    .eq("tenant_id", auth.tenantId)
    .order("issue_date", { ascending: false })
    .order("quotation_sequence", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const [{ sequence, error: sequenceError }, peekResult] = await Promise.all([
    getNextQuotationSequence(supabase, auth.tenantId),
    peekNextQuotationNumber(supabase, auth.tenantId),
  ]);

  if (sequenceError) {
    return NextResponse.json({ error: sequenceError }, { status: 500 });
  }

  if (peekResult.error) {
    return NextResponse.json({ error: peekResult.error }, { status: 500 });
  }

  return NextResponse.json({
    client_quotations: (data as ClientQuotationListRow[] | null) ?? [],
    next_quotation_sequence: sequence,
    next_quotation_number: peekResult.quotationNumber,
  });
}

export async function POST(request: Request) {
  const auth = await requireTenantRoleIn(CRM_QUOTATIONS_EDIT_ROLES);
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

  const body = rawBody as ClientQuotationWriteBody;
  const validationError = validateClientQuotationBody(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const supabase = await getTenantSupabase();
  const { quotation, error } = await createClientQuotation(
    supabase,
    auth.tenantId,
    body,
  );

  if (error || !quotation) {
    return NextResponse.json(
      { error: error ?? "Unable to create quotation." },
      { status: 400 },
    );
  }

  void import("@/utils/tenant-admin-director-tier2-notifications").then(
    ({ notifyAdminsDirectorsNewQuotation }) => {
      void notifyAdminsDirectorsNewQuotation(
        auth.tenantId,
        quotation.bill_to_name,
        Number(quotation.total_amount_due) || 0,
      );
    },
  );

  return NextResponse.json({ client_quotation: quotation });
}
