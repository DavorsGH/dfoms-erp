import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getLandlordPortalSession } from "@/utils/landlord-portal-auth";
import { createClient } from "@/utils/supabase/server";

/** Mark all of the current landlord's unread notifications as read. */
export async function PATCH() {
  const session = await getLandlordPortalSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("landlord_notifications")
    .update({ read_at: now })
    .eq("tenant_id", session.tenantId)
    .eq("recipient_user_id", session.authUserId)
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
