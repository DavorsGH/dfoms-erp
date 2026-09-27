import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { FINANCE_SECTION_ROLES } from "@/utils/rbac-access";
import {
  assertServerRowWriteAccess,
  getServerAuthUid,
} from "@/utils/business-unit-access.server";
import { createClient } from "@/utils/supabase/server";
import type { DirectorsLoanLedgerEntryType } from "@/app/dashboard/finance/directors-loan-ledger-utils";

type PatchBody = {
  action?: "reverse" | "update";
  reversal_reason?: string;
  entry_date?: string;
  entry_type?: DirectorsLoanLedgerEntryType;
  amount?: number;
  description?: string;
  reference?: string | null;
  notes?: string | null;
  linked_expense_id?: string | null;
};

async function getSupabase() {
  const cookieStore = await cookies();
  return createClient(cookieStore);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireTenantRoleIn(FINANCE_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const supabase = await getSupabase();
  const authUid = await getServerAuthUid(supabase);
  if (!authUid.ok) {
    return NextResponse.json({ error: authUid.error }, { status: authUid.status });
  }

  const access = await assertServerRowWriteAccess({
    supabase,
    tenantId: auth.tenantId,
    authUid: authUid.authUid,
    table: "directors_loan_entries",
    rowId: id,
  });
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { data: existing, error: loadError } = await supabase
    .from("directors_loan_entries")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .maybeSingle();

  if (loadError) {
    return NextResponse.json({ error: loadError.message }, { status: 400 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Entry not found." }, { status: 404 });
  }
  if (existing.reversed_at) {
    return NextResponse.json({ error: "Entry is already reversed." }, { status: 400 });
  }

  if (body.action === "reverse") {
    const reason = body.reversal_reason?.trim() ?? "";
    if (reason.length < 5) {
      return NextResponse.json(
        { error: "reversal_reason is required (at least 5 characters)." },
        { status: 400 },
      );
    }
    const { data, error } = await supabase
      .from("directors_loan_entries")
      .update({
        reversed_at: new Date().toISOString(),
        reversed_by: authUid.authUid,
        reversal_reason: reason,
      })
      .eq("id", id)
      .eq("tenant_id", auth.tenantId)
      .select("*")
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ entry: data });
  }

  const amount = Number(body.amount ?? existing.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "amount must be greater than zero." }, { status: 400 });
  }
  const description = (body.description ?? existing.description)?.trim();
  if (!description) {
    return NextResponse.json({ error: "description is required." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("directors_loan_entries")
    .update({
      entry_date: (body.entry_date ?? existing.entry_date).slice(0, 10),
      entry_type: body.entry_type ?? existing.entry_type,
      amount,
      description,
      reference:
        body.reference !== undefined ? body.reference?.trim() || null : existing.reference,
      notes: body.notes !== undefined ? body.notes?.trim() || null : existing.notes,
      linked_expense_id:
        body.linked_expense_id !== undefined
          ? body.linked_expense_id?.trim() || null
          : existing.linked_expense_id,
    })
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ entry: data });
}
