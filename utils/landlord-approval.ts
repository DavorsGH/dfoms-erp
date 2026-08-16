import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ensurePlatformOnlyLandlordTrialSubscription } from "@/utils/platform-only-unit-billing";

export type ApproveLandlordResult =
  | { ok: true; transitioned: boolean; approvalStatus: "approved" }
  | { ok: false; error: string; status: number };

/**
 * Sets landlords.approval_status to approved and seeds platform-only trial
 * subscription when missing. Idempotent when already approved.
 */
export async function approveLandlordTenant(
  admin: SupabaseClient,
  tenantId: string,
  options?: { requirePending?: boolean },
): Promise<ApproveLandlordResult> {
  const requirePending = options?.requirePending ?? false;

  const { data: landlord, error: landlordError } = await admin
    .from("landlords")
    .select("tenant_id, approval_status")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (landlordError) {
    return { ok: false, error: landlordError.message, status: 400 };
  }
  if (!landlord) {
    return { ok: false, error: "Landlord record not found.", status: 404 };
  }

  if (landlord.approval_status === "approved") {
    return { ok: true, transitioned: false, approvalStatus: "approved" };
  }

  if (requirePending && landlord.approval_status !== "pending") {
    return {
      ok: false,
      error: "Only pending landlords can be approved or rejected.",
      status: 400,
    };
  }

  if (landlord.approval_status === "rejected") {
    return {
      ok: false,
      error: "Rejected landlords cannot be approved.",
      status: 400,
    };
  }

  const { error: updateError } = await admin
    .from("landlords")
    .update({
      approval_status: "approved",
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId);

  if (updateError) {
    return { ok: false, error: updateError.message, status: 400 };
  }

  try {
    await ensurePlatformOnlyLandlordTrialSubscription(admin, tenantId);
  } catch (error) {
    console.warn(
      "[landlord-approval] trial subscription seed failed:",
      error instanceof Error ? error.message : error,
    );
  }

  return { ok: true, transitioned: true, approvalStatus: "approved" };
}
