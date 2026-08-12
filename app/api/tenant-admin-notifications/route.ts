import { NextResponse } from "next/server";
import { requireAuthenticated } from "@/utils/admin-auth";
import { getCurrentUserNotificationLabel } from "@/utils/current-user";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import { notifyTenantAdminsAndDirectors } from "@/utils/tenant-admin-director-notifications";

const MAX_TITLE_LENGTH = 200;
const MAX_DETAIL_LENGTH = 500;
const MAX_ACTION_URL_LENGTH = 500;

/**
 * Authenticated trigger for client-side record creation flows.
 * Server paths should call notifyTenantAdminsAndDirectors directly.
 */
export async function POST(request: Request) {
  const auth = await requireAuthenticated();
  if (!auth.ok) {
    return auth.response;
  }

  const tenantId = await getCurrentUserTenantId();
  if (!tenantId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    title?: string;
    detail?: string;
    actionUrl?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const title = body.title?.trim() ?? "";
  const detail = body.detail?.trim() ?? "";
  const actionUrl = body.actionUrl?.trim() || null;

  if (!title || !detail) {
    return NextResponse.json(
      { error: "title and detail are required." },
      { status: 400 },
    );
  }
  if (title.length > MAX_TITLE_LENGTH || detail.length > MAX_DETAIL_LENGTH) {
    return NextResponse.json({ error: "title or detail is too long." }, { status: 400 });
  }
  if (actionUrl && actionUrl.length > MAX_ACTION_URL_LENGTH) {
    return NextResponse.json({ error: "actionUrl is too long." }, { status: 400 });
  }

  const recordedBy = await getCurrentUserNotificationLabel();
  const notificationBody = `${detail} recorded by ${recordedBy}`;

  await notifyTenantAdminsAndDirectors(
    tenantId,
    title,
    notificationBody,
    actionUrl,
  );

  return NextResponse.json({ ok: true });
}
