import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { getServerAuthUid } from "@/utils/business-unit-access.server";
import { FINANCE_SECTION_ROLES } from "@/utils/rbac-access";
import { createClient } from "@/utils/supabase/server";

type ReplacementBody = {
  service_date?: string;
  replacement_name?: string;
  amount?: number;
  payment_method?: string;
  notes?: string | null;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireTenantRoleIn(FINANCE_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  const { id } = await context.params;
  let body: ReplacementBody;
  try {
    body = (await request.json()) as ReplacementBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const serviceDate = body.service_date?.trim() ?? "";
  const replacementName = body.replacement_name?.trim() ?? "";
  const amount = Number(body.amount);
  if (!serviceDate || !replacementName || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "service_date, replacement_name, and positive amount are required." },
      { status: 400 },
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const authUser = await getServerAuthUid(supabase);
  if (!authUser.ok) {
    return NextResponse.json({ error: authUser.error }, { status: authUser.status });
  }

  const { data, error } = await supabase.rpc(
    "record_supplier_contract_replacement_payment",
    {
      p_tenant_id: auth.tenantId,
      p_contract_id: id,
      p_created_by: authUser.authUid,
      p_service_date: serviceDate,
      p_replacement_name: replacementName,
      p_deduction_amount: amount,
      p_payment_method: body.payment_method?.trim() || "company_cash",
      p_notes: body.notes?.trim() || null,
    },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ result: data });
}
