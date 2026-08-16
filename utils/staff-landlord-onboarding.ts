import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { approveLandlordTenant } from "@/utils/landlord-approval";
import { createAndSendLandlordPortalInvite } from "@/utils/landlord-portal-invite";
import { notifyStaffLandlordCreatedByStaff } from "@/utils/real-estate-staff-notifications";

export type StaffLandlordOnboardingResult =
  | {
      ok: true;
      approvalStatus: "approved";
      portalInvite:
        | { status: "sent" }
        | { status: "skipped"; reason: string }
        | { status: "failed"; error: string };
    }
  | { ok: false; error: string; status: number };

/**
 * Staff-created landlords: approve immediately, send portal invite, notify staff (FYI).
 */
export async function onboardStaffCreatedLandlord(
  admin: SupabaseClient,
  input: {
    tenantId: string;
    landlordType: string;
    landlordName?: string | null;
  },
): Promise<StaffLandlordOnboardingResult> {
  const approval = await approveLandlordTenant(admin, input.tenantId);
  if (!approval.ok) {
    return { ok: false, error: approval.error, status: approval.status };
  }

  let portalInvite:
    | { status: "sent" }
    | { status: "skipped"; reason: string }
    | { status: "failed"; error: string };

  try {
    const inviteResult = await createAndSendLandlordPortalInvite(admin, {
      tenantId: input.tenantId,
    });
    if (inviteResult.ok) {
      portalInvite =
        inviteResult.status === "sent"
          ? { status: "sent" }
          : { status: "skipped", reason: inviteResult.reason };
    } else {
      portalInvite = { status: "failed", error: inviteResult.error };
    }
  } catch (error) {
    portalInvite = {
      status: "failed",
      error: error instanceof Error ? error.message : "Invite failed.",
    };
  }

  await notifyStaffLandlordCreatedByStaff({
    landlordTenantId: input.tenantId,
    landlordType: input.landlordType,
    landlordName: input.landlordName,
  });

  return {
    ok: true,
    approvalStatus: "approved",
    portalInvite,
  };
}
