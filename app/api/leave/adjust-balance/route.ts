import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireRoleIn } from "@/utils/admin-auth";
import { createClient } from "@/utils/supabase/server";
import { LEAVE_BALANCE_MANAGE_ROLES } from "@/utils/rbac-access";

type AdjustBalanceBody = {
  employee_id?: string;
  leave_type_id?: string;
  year?: number;
  entitled_days?: number;
};

export async function POST(request: Request) {
  const auth = await requireRoleIn(LEAVE_BALANCE_MANAGE_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  let body: AdjustBalanceBody;
  try {
    body = (await request.json()) as AdjustBalanceBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!body.employee_id || !body.leave_type_id || body.year == null) {
    return NextResponse.json(
      { error: "employee_id, leave_type_id, and year are required" },
      { status: 400 },
    );
  }

  if (body.entitled_days == null || Number.isNaN(Number(body.entitled_days))) {
    return NextResponse.json(
      { error: "entitled_days must be a valid number" },
      { status: 400 },
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("employee_leave_balances")
    .upsert(
      {
        employee_id: body.employee_id,
        leave_type_id: body.leave_type_id,
        year: body.year,
        entitled_days: body.entitled_days,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "employee_id,leave_type_id,year" },
    )
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ balanceId: data.id });
}
