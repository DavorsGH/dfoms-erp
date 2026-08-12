import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getClientPortalSession } from "@/utils/client-portal-auth";
import { createClient } from "@/utils/supabase/server";

export async function DELETE() {
  const session = await getClientPortalSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("client_notifications")
    .delete()
    .eq("tenant_id", session.tenantId)
    .eq("recipient_user_id", session.authUserId)
    .eq("client_id", session.clientId)
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
