import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireAuthenticated } from "@/utils/admin-auth";
import { createClient } from "@/utils/supabase/server";

type LeaveDecisionBody = {
  request_id?: string;
  decision_notes?: string | null;
};

export async function POST(request: Request) {
  const auth = await requireAuthenticated();
  if (!auth.ok) {
    return auth.response;
  }

  let body: LeaveDecisionBody;
  try {
    body = (await request.json()) as LeaveDecisionBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!body.request_id) {
    return NextResponse.json({ error: "request_id is required" }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { error } = await supabase.rpc("approve_leave_request", {
    p_request_id: body.request_id,
    p_decision_notes: body.decision_notes ?? null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
