import { NextResponse } from "next/server";
import { requireAuthenticated } from "@/utils/admin-auth";
import { getCurrentUserNotificationLabel } from "@/utils/current-user";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import {
  loadProductSaleNotificationThreshold,
  notifyTenantAdminsAndDirectors,
} from "@/utils/tenant-admin-director-notifications";

const MAX_TITLE_LENGTH = 200;
const MAX_DETAIL_LENGTH = 500;
const MAX_BODY_LENGTH = 500;
const MAX_ACTION_URL_LENGTH = 500;

type NotificationBodyFormat = "recorded_by" | "added_by" | "plain";

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
    body?: string;
    actionUrl?: string | null;
    bodyFormat?: NotificationBodyFormat;
    thresholdAmount?: number;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const title = body.title?.trim() ?? "";
  const detail = body.detail?.trim() ?? "";
  const fullBody = body.body?.trim() ?? "";
  const actionUrl = body.actionUrl?.trim() || null;
  const bodyFormat: NotificationBodyFormat = body.bodyFormat ?? "recorded_by";

  if (!title || (!detail && !fullBody)) {
    return NextResponse.json(
      { error: "title and detail (or body) are required." },
      { status: 400 },
    );
  }
  if (
    title.length > MAX_TITLE_LENGTH ||
    detail.length > MAX_DETAIL_LENGTH ||
    fullBody.length > MAX_BODY_LENGTH
  ) {
    return NextResponse.json({ error: "title, detail, or body is too long." }, { status: 400 });
  }
  if (actionUrl && actionUrl.length > MAX_ACTION_URL_LENGTH) {
    return NextResponse.json({ error: "actionUrl is too long." }, { status: 400 });
  }

  if (body.thresholdAmount != null) {
    const saleAmount = Number(body.thresholdAmount);
    if (!Number.isFinite(saleAmount) || saleAmount <= 0) {
      return NextResponse.json({ ok: true, skipped: true });
    }
    const threshold = await loadProductSaleNotificationThreshold(tenantId);
    if (saleAmount < threshold) {
      return NextResponse.json({ ok: true, skipped: true });
    }
  }

  let notificationBody = fullBody;
  if (!notificationBody) {
    const recordedBy = await getCurrentUserNotificationLabel();
    if (bodyFormat === "added_by") {
      notificationBody = `${detail} added by ${recordedBy}`;
    } else if (bodyFormat === "plain") {
      notificationBody = detail;
    } else {
      notificationBody = `${detail} recorded by ${recordedBy}`;
    }
  }

  await notifyTenantAdminsAndDirectors(
    tenantId,
    title,
    notificationBody,
    actionUrl,
  );

  return NextResponse.json({ ok: true });
}
