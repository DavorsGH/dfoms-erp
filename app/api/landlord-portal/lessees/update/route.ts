import { NextResponse } from "next/server";
import { isLesseeStatus } from "@/app/dashboard/real-estate/lessees-utils";
import {
  crossPersonaErrorMessage,
  findCrossPersonaConflictForEmail,
} from "@/lib/auth/cross-persona-guard";
import { requirePlatformOnlyLandlordSession } from "@/utils/landlord-portal-auth";

type UpdateLesseeBody = {
  lessee_id?: string;
  full_name?: string;
  phone?: string;
  email?: string | null;
  status?: string;
  private_notes?: string | null;
};

/**
 * platform_only: update contact/profile fields for a lessee in the landlord's tenant.
 */
export async function POST(request: Request) {
  const auth = await requirePlatformOnlyLandlordSession();
  if (!auth.ok) {
    return auth.response;
  }

  let body: UpdateLesseeBody;
  try {
    body = (await request.json()) as UpdateLesseeBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const lesseeId = body.lessee_id?.trim() ?? "";
  if (!lesseeId) {
    return NextResponse.json({ error: "lessee_id is required" }, { status: 400 });
  }

  const fullName = body.full_name?.trim() ?? "";
  const phone = body.phone?.trim() ?? "";
  const email = body.email?.trim() || null;

  if (!fullName) {
    return NextResponse.json({ error: "full_name is required" }, { status: 400 });
  }
  if (!phone) {
    return NextResponse.json({ error: "phone is required" }, { status: 400 });
  }

  const { data: existing, error: lookupError } = await auth.admin
    .from("lessees")
    .select("lessee_id, email, auth_user_id, status, private_notes")
    .eq("tenant_id", auth.session.tenantId)
    .eq("lessee_id", lesseeId)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json({ error: lookupError.message }, { status: 400 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Tenant not found." }, { status: 404 });
  }

  const existingEmail =
    typeof existing.email === "string" ? existing.email.trim().toLowerCase() : "";
  const nextEmail = email?.trim().toLowerCase() ?? "";

  if (nextEmail && nextEmail !== existingEmail) {
    const crossPersona = await findCrossPersonaConflictForEmail(
      auth.admin,
      nextEmail,
      {
        targetPersona: "lessee",
        excludeLesseeId: lesseeId,
      },
    );
    if (crossPersona) {
      return NextResponse.json(
        { error: crossPersonaErrorMessage(crossPersona) },
        { status: 409 },
      );
    }
  }

  const updatePayload: {
    full_name: string;
    phone: string;
    email: string | null;
    updated_at: string;
    status?: string;
    private_notes?: string | null;
  } = {
    full_name: fullName,
    phone,
    email,
    updated_at: new Date().toISOString(),
  };

  if (body.status !== undefined) {
    const status = body.status.trim();
    if (!isLesseeStatus(status)) {
      return NextResponse.json(
        { error: "status must be active or former." },
        { status: 400 },
      );
    }
    updatePayload.status = status;
  }

  if (body.private_notes !== undefined) {
    updatePayload.private_notes = body.private_notes?.trim() || null;
  }

  const { data, error } = await auth.admin
    .from("lessees")
    .update(updatePayload)
    .eq("tenant_id", auth.session.tenantId)
    .eq("lessee_id", lesseeId)
    .select("lessee_id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (!data) {
    return NextResponse.json({ error: "Tenant not found." }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
