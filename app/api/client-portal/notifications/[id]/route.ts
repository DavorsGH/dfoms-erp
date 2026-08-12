import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getClientPortalSession } from "@/utils/client-portal-auth";
import {
  CLIENT_NOTIFICATION_SELECT,
  normalizeClientNotificationRow,
  type ClientNotificationRow,
} from "@/utils/client-notifications-types";
import { createClient } from "@/utils/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(_request: Request, context: RouteContext) {
  const session = await getClientPortalSession();
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
    .from("client_notifications")
    .select("id, read_at")
    .eq("id", id)
    .eq("tenant_id", session.tenantId)
    .eq("recipient_user_id", session.authUserId)
    .eq("client_id", session.clientId)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 400 });
  }
  if (!existing) {
    return NextResponse.json(
      { error: "Notification not found." },
      { status: 404 },
    );
  }

  if (existing.read_at) {
    const { data: current } = await supabase
      .from("client_notifications")
      .select(CLIENT_NOTIFICATION_SELECT)
      .eq("id", id)
      .eq("tenant_id", session.tenantId)
      .eq("recipient_user_id", session.authUserId)
      .eq("client_id", session.clientId)
      .maybeSingle();

    return NextResponse.json({
      notification: current
        ? normalizeClientNotificationRow(current as ClientNotificationRow)
        : null,
    });
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("client_notifications")
    .update({ read_at: now })
    .eq("id", id)
    .eq("tenant_id", session.tenantId)
    .eq("recipient_user_id", session.authUserId)
    .eq("client_id", session.clientId)
    .select(CLIENT_NOTIFICATION_SELECT)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    notification: normalizeClientNotificationRow(data as ClientNotificationRow),
  });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const session = await getClientPortalSession();
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

  const { data, error } = await supabase
    .from("client_notifications")
    .delete()
    .eq("id", id)
    .eq("tenant_id", session.tenantId)
    .eq("recipient_user_id", session.authUserId)
    .eq("client_id", session.clientId)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (!data) {
    return NextResponse.json(
      { error: "Notification not found." },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, id: data.id });
}
