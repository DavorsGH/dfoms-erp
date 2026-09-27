import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { FINANCE_SECTION_ROLES } from "@/utils/rbac-access";
import {
  getServerAuthUid,
  resolveServerWriteBusinessUnitId,
} from "@/utils/business-unit-access.server";
import { createClient } from "@/utils/supabase/server";
import type { DirectorsLoanLedgerEntryType } from "@/app/dashboard/finance/directors-loan-ledger-utils";

const ENTRY_TYPES: DirectorsLoanLedgerEntryType[] = [
  "director_lent_company",
  "company_repaid_director",
  "company_paid_for_director",
  "director_repaid_company",
];

type CreateBody = {
  entry_date?: string;
  entry_type?: DirectorsLoanLedgerEntryType;
  amount?: number;
  description?: string;
  reference?: string | null;
  notes?: string | null;
  linked_expense_id?: string | null;
  remove_linked_expense?: boolean;
};

async function getSupabase() {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

function validateCreateBody(body: CreateBody): string | null {
  if (!body.entry_date?.trim()) {
    return "entry_date is required.";
  }
  if (!body.entry_type || !ENTRY_TYPES.includes(body.entry_type)) {
    return "entry_type is invalid.";
  }
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return "amount must be greater than zero.";
  }
  if (!body.description?.trim()) {
    return "description is required.";
  }
  return null;
}

export async function POST(request: Request) {
  const auth = await requireTenantRoleIn(FINANCE_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const validationError = validateCreateBody(body);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const supabase = await getSupabase();
  const authUid = await getServerAuthUid(supabase);
  if (!authUid.ok) {
    return NextResponse.json({ error: authUid.error }, { status: authUid.status });
  }

  const bu = await resolveServerWriteBusinessUnitId({
    supabase,
    tenantId: auth.tenantId,
    authUid: authUid.authUid,
  });
  if (!bu.ok) {
    return NextResponse.json({ error: bu.error }, { status: bu.status });
  }

  const linkedExpenseId = body.linked_expense_id?.trim() || null;
  if (
    body.entry_type === "company_paid_for_director" &&
    linkedExpenseId &&
    body.remove_linked_expense
  ) {
    const { error: deleteError } = await supabase
      .from("expense_register")
      .delete()
      .eq("id", linkedExpenseId)
      .eq("tenant_id", auth.tenantId);
    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 400 });
    }
  }

  const { data, error } = await supabase
    .from("directors_loan_entries")
    .insert({
      tenant_id: auth.tenantId,
      business_unit_id: bu.businessUnitId,
      entry_date: body.entry_date!.slice(0, 10),
      entry_type: body.entry_type,
      amount: Number(body.amount),
      description: body.description!.trim(),
      reference: body.reference?.trim() || null,
      notes: body.notes?.trim() || null,
      linked_expense_id: linkedExpenseId,
      created_by: authUid.authUid,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ entry: data });
}
