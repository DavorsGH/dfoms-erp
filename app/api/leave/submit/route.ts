import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireRoleIn } from "@/utils/admin-auth";
import { createClient } from "@/utils/supabase/server";
import { SELF_SERVICE_SECTION_ROLES } from "@/utils/rbac-access";

type SubmitLeaveBody = {
  leave_type_id?: string;
  start_date?: string;
  end_date?: string;
  reason?: string | null;
};

export async function POST(request: Request) {
  const auth = await requireRoleIn(SELF_SERVICE_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  let body: SubmitLeaveBody;
  try {
    body = (await request.json()) as SubmitLeaveBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!body.leave_type_id || !body.start_date || !body.end_date) {
    return NextResponse.json(
      { error: "leave_type_id, start_date, and end_date are required" },
      { status: 400 },
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: requestId, error } = await supabase.rpc("submit_leave_request", {
    p_leave_type_id: body.leave_type_id,
    p_start_date: body.start_date,
    p_end_date: body.end_date,
    p_reason: body.reason ?? null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const { data: createdRequest } = await supabase
    .from("leave_requests")
    .select("exceeds_balance")
    .eq("id", requestId)
    .maybeSingle();

  return NextResponse.json({
    requestId,
    exceedsBalance: createdRequest?.exceeds_balance ?? false,
  });
}
