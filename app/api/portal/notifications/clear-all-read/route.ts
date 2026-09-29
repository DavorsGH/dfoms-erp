import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getPortalLesseeSession } from "@/utils/lessee-portal-auth";
import { createClient } from "@/utils/supabase/server";

import { ROUTE_HANDLER_AUTH_OPTS } from "@/lib/middleware-trust-policy";
/** Delete all read tenant portal notifications for the current user. */
export async function DELETE() {
  const session = await getPortalLesseeSession(ROUTE_HANDLER_AUTH_OPTS);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("lessee_notifications")
    .delete()
    .eq("tenant_id", session.tenantId)
    .eq("recipient_user_id", session.authUserId)
    .eq("lessee_id", session.lesseeId)
    .not("read_at", "is", null)
    .select("id");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    deletedCount: data?.length ?? 0,
  });
}
