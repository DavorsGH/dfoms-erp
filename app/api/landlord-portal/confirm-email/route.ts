import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { syncAuthUserPortalMetadata } from "@/lib/auth/portal-metadata";
import { approveLandlordTenant } from "@/utils/landlord-approval";
import { sendLandlordSelfSignupWelcomeEmail } from "@/utils/landlord-signup-emails";
import { notifyStaffLandlordSelfSignupApproved } from "@/utils/real-estate-staff-notifications";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";

/**
 * Called after the landlord verifies their email. Auto-approves the landlord,
 * sends welcome + staff informational notifications (first transition only).
 */
export async function POST() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  if (!user.email_confirmed_at) {
    return NextResponse.json(
      { error: "Email address is not confirmed yet." },
      { status: 400 },
    );
  }

  if (user.user_metadata?.portal !== "landlord") {
    return NextResponse.json(
      { error: "This account is not registered for the Landlord Portal." },
      { status: 403 },
    );
  }

  const admin = createAdminClient();

  const { data: landlord, error: landlordError } = await admin
    .from("landlords")
    .select("tenant_id, approval_status, landlord_type")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (landlordError) {
    return NextResponse.json({ error: landlordError.message }, { status: 400 });
  }
  if (!landlord) {
    return NextResponse.json(
      { error: "Landlord record not found for this account." },
      { status: 404 },
    );
  }

  const approval = await approveLandlordTenant(admin, landlord.tenant_id);
  if (!approval.ok) {
    return NextResponse.json(
      { error: approval.error },
      { status: approval.status },
    );
  }

  if (approval.transitioned) {
    const { data: tenant } = await admin
      .from("tenants")
      .select("name, email")
      .eq("id", landlord.tenant_id)
      .maybeSingle();

    const landlordName =
      typeof tenant?.name === "string" ? tenant.name.trim() : "";
    const contactEmail =
      typeof tenant?.email === "string" ? tenant.email.trim() : user.email ?? "";

    if (contactEmail) {
      void sendLandlordSelfSignupWelcomeEmail({
        email: contactEmail,
        name: landlordName,
      });
    }

    void notifyStaffLandlordSelfSignupApproved({
      landlordTenantId: landlord.tenant_id,
      landlordType: landlord.landlord_type ?? "platform_only",
      landlordName,
    });
  }

  await syncAuthUserPortalMetadata(user.id, "landlord");

  return NextResponse.json({
    success: true,
    approval_status: approval.approvalStatus,
    newly_approved: approval.transitioned,
  });
}
