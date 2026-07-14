import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireSuperAdmin } from "@/utils/admin-auth";
import { createClient } from "@/utils/supabase/server";

type ChangeApproverBody = {
  approver_auth_uid?: string;
  effective_from?: string;
  notes?: string | null;
};

export async function POST(request: Request) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

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
