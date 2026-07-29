import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireAuthenticated } from "@/utils/admin-auth";
import { createClient } from "@/utils/supabase/server";

/** Mark all of the current user's unread notifications as read. */
export async function PATCH() {
  const auth = await requireAuthenticated();
  if (!auth.ok) {
    return auth.response;
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const now = new Date().toISOString();

  // RLS limits the update to the caller's own rows.
  const { data, error } = await supabase
    .from("employee_notifications")
    .update({ read_at: now })
    .is("read_at", null)
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    updatedCount: data?.length ?? 0,
  });
}
