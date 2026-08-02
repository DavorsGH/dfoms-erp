import { NextResponse } from "next/server";
import { requirePlatformOnlyLandlordSession } from "@/utils/landlord-portal-auth";

type UpdateBody = {
  notification_phone?: string | null;
  notification_email?: string | null;
};

/**
 * Platform-only landlord self-service for landlords.notification_phone + tenants.email.
 * Mutations use service role after session + landlord_type checks (RLS is SELECT-only).
 * No schema change — columns already exist from script 136.
 */
export async function POST(request: Request) {
  const auth = await requirePlatformOnlyLandlordSession();
  if (!auth.ok) {
    return auth.response;
  }

  let body: UpdateBody;
  try {
    body = (await request.json()) as UpdateBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const notificationPhone =
    typeof body.notification_phone === "string"
      ? body.notification_phone.trim() || null
      : null;

  let notificationEmail: string | null = null;
  if (typeof body.notification_email === "string") {
    const trimmed = body.notification_email.trim();
    if (trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return NextResponse.json(
        { error: "notification_email must be a valid email address." },
        { status: 400 },
      );
    }
    notificationEmail = trimmed || null;
  }

  const nowIso = new Date().toISOString();
  const { error: landlordError } = await auth.admin
    .from("landlords")
    .update({
      notification_phone: notificationPhone,
      updated_at: nowIso,
    })
    .eq("tenant_id", auth.session.tenantId);

  if (landlordError) {
    return NextResponse.json({ error: landlordError.message }, { status: 400 });
  }

  const { error: tenantError } = await auth.admin
    .from("tenants")
    .update({
      email: notificationEmail,
      updated_at: nowIso,
    })
    .eq("id", auth.session.tenantId);

  if (tenantError) {
    return NextResponse.json({ error: tenantError.message }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    notification_phone: notificationPhone,
    notification_email: notificationEmail,
  });
}
