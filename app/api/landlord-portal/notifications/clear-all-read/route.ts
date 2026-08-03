import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getLandlordPortalSession } from "@/utils/landlord-portal-auth";
import { createClient } from "@/utils/supabase/server";

/** Delete all read landlord portal notifications for the current user. */
export async function DELETE() {
  const session = await getLandlordPortalSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("landlord_notifications")
    .delete()
    .eq("tenant_id", session.tenantId)
    .eq("recipient_user_id", session.authUserId)
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
