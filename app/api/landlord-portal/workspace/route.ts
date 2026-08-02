import { NextResponse } from "next/server";
import {
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import { createAdminClient } from "@/utils/supabase/admin";

type UpdateBody = {
  name?: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
};

/**
 * Landlord updates own tenants row (workspace/profile).
 * Service-role after session check — landlords have SELECT-only RLS on tenants.
 * SCHEMA FLAG: no UPDATE policy for landlord JWT; app uses admin client.
 * Also writes landlords.notification_phone when phone changes so Workspace Phone
 * and Notification phone stay equal (same dual-column sync as staff update).
 */
export async function POST(request: Request) {
  const session = await getLandlordPortalSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!landlordPortalHasDataAccess(session)) {
    return NextResponse.json(
      {
        error:
          "Your landlord account is pending approval. Workspace updates are unavailable until Davors staff approves your account.",
      },
      { status: 403 },
    );
  }

  let body: UpdateBody;
  try {
    body = (await request.json()) as UpdateBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const email =
    typeof body.email === "string" ? body.email.trim() || null : null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: "email must be a valid email address." },
      { status: 400 },
    );
  }

  const phone =
    typeof body.phone === "string" ? body.phone.trim() || null : null;
  const address =
    typeof body.address === "string" ? body.address.trim() || null : null;

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const { error } = await admin
    .from("tenants")
    .update({
      name,
      email,
      phone,
      address,
      updated_at: nowIso,
    })
    .eq("id", session.tenantId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Keep landlords.notification_phone aligned with tenants.phone.
  const { error: landlordError } = await admin
    .from("landlords")
    .update({
      notification_phone: phone,
      updated_at: nowIso,
    })
    .eq("tenant_id", session.tenantId);

  if (landlordError) {
    return NextResponse.json({ error: landlordError.message }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    name,
    email,
    phone,
    address,
  });
}
