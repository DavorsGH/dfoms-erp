import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireRoleIn } from "@/utils/admin-auth";
import { createClient } from "@/utils/supabase/server";
import { SELF_SERVICE_SECTION_ROLES } from "@/utils/rbac-access";

type CancelLeaveBody = {
  request_id?: string;
};

export async function POST(request: Request) {
  const auth = await requireRoleIn(SELF_SERVICE_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  let body: CancelLeaveBody;
  try {
    body = (await request.json()) as CancelLeaveBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!body.request_id) {
    return NextResponse.json({ error: "request_id is required" }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { error } = await supabase.rpc("cancel_leave_request", {
    p_request_id: body.request_id,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
