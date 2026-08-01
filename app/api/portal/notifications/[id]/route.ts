import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getPortalLesseeSession } from "@/utils/lessee-portal-auth";
import {
  LESSEE_NOTIFICATION_SELECT,
  normalizeLesseeNotificationRow,
  type LesseeNotificationRow,
} from "@/utils/lessee-notifications-types";
import { createClient } from "@/utils/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/** Mark a single portal notification as read. */
export async function PATCH(_request: Request, context: RouteContext) {
  const session = await getPortalLesseeSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json(
      { error: "Notification id is required." },
      { status: 400 },
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: existing, error: fetchError } = await supabase
    .from("lessee_notifications")
    .select("id, read_at")
    .eq("id", id)
    .eq("tenant_id", session.tenantId)
    .eq("recipient_user_id", session.authUserId)
    .eq("lessee_id", session.lesseeId)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 400 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Notification not found." }, { status: 404 });
  }

  if (existing.read_at) {
    const { data: current } = await supabase
      .from("lessee_notifications")
      .select(LESSEE_NOTIFICATION_SELECT)
      .eq("id", id)
      .eq("tenant_id", session.tenantId)
      .eq("recipient_user_id", session.authUserId)
      .eq("lessee_id", session.lesseeId)
      .maybeSingle();

    return NextResponse.json({
      notification: current
        ? normalizeLesseeNotificationRow(current as LesseeNotificationRow)
        : null,
    });
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("lessee_notifications")
    .update({ read_at: now })
    .eq("id", id)
    .eq("tenant_id", session.tenantId)
    .eq("recipient_user_id", session.authUserId)
    .eq("lessee_id", session.lesseeId)
    .select(LESSEE_NOTIFICATION_SELECT)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    notification: normalizeLesseeNotificationRow(
      data as LesseeNotificationRow,
    ),
  });
}
