import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { isEligibleLeaveApprover } from "@/lib/leave-approver-options";

type ChangeApproverBody = {
  approver_auth_uid?: string;
  effective_from?: string;
  notes?: string | null;
};

export async function POST(request: Request) {
  const auth = await requireTenantRoleIn(["super_admin"]);
  if (!auth.ok) {
    return auth.response;
  }

  const { tenantId } = auth;

  let body: ChangeApproverBody;
  try {
    body = (await request.json()) as ChangeApproverBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!body.approver_auth_uid) {
    return NextResponse.json(
      { error: "approver_auth_uid is required" },
      { status: 400 },
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const admin = createAdminClient();
  const { data: approverAccount, error: accountError } = await admin
    .from("user_accounts")
    .select("auth_uid, employee_id, is_active, role")
    .eq("auth_uid", body.approver_auth_uid)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (accountError) {
    return NextResponse.json({ error: accountError.message }, { status: 500 });
  }

  const { data: employee, error: employeeError } = approverAccount?.employee_id
    ? await admin
        .from("employees")
        .select("employment_status")
        .eq("tenant_id", tenantId)
        .eq("employee_id", approverAccount.employee_id)
        .maybeSingle()
    : { data: null, error: null };

  if (employeeError) {
    return NextResponse.json({ error: employeeError.message }, { status: 500 });
  }

  if (
    !isEligibleLeaveApprover({
      account: approverAccount,
      employmentStatus: employee?.employment_status ?? null,
    })
  ) {
    return NextResponse.json(
      {
        error:
          "Choose an active employee who has a staff login. Create one under User Accounts first.",
      },
      { status: 400 },
    );
  }

  const { data: configId, error } = await supabase.rpc("change_leave_approver", {
    p_approver_auth_uid: body.approver_auth_uid,
    p_effective_from: body.effective_from ?? null,
    p_notes: body.notes ?? null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ configId });
}
