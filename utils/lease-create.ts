import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { assertRealEstateLandlordTenant } from "@/utils/property-management";
import {
  DEFAULT_TERMINATION_NOTICE_MONTHS,
  isLateFeeType,
  suggestAdvanceRentAmountGhs,
} from "@/app/dashboard/real-estate/leases-utils";
import { voidNotifySecurityDepositCollected } from "@/utils/real-estate-document-notifications";

export type CreateLeaseInput = {
  tenantId: string;
  unitId: string;
  lesseeId?: string | null;
  newLessee?: {
    fullName?: string;
    phone?: string;
    email?: string | null;
  } | null;
  startDate: string;
  endDate: string;
  rentAmountGhs: number;
  /** When omitted, defaults to rent × term months. */
  advanceRentAmountGhs?: number | null;
  /** When omitted, defaults to 3. */
  terminationNoticeMonths?: number | null;
  escalationPercent?: number | null;
  escalationFrequencyMonths?: number | null;
  lateFeeEnabled: boolean;
  lateFeeType?: string | null;
  lateFeeAmount?: number | null;
  depositAmountGhs: number;
  depositDateCollected: string;
  /**
   * When set, unit may be `application_hold` (approved packet) in addition to vacant.
   * On success, links rental_applications.lease_id / lessee_id.
   */
  applicationId?: string | null;
};

export type CreateLeaseResult =
  | {
      ok: true;
      leaseId: string;
      depositId: string;
      lesseeId: string;
      portalInvite:
        | { status: "sent" }
        | { status: "skipped"; reason: string }
        | { status: "failed"; error: string }
        | undefined;
    }
  | { ok: false; error: string; status: number };

/**
 * Shared lease creation used by staff admin API and landlord portal
 * (platform_only convert-from-application).
 */
export async function createLeaseForLandlord(
  admin: SupabaseClient,
  input: CreateLeaseInput,
): Promise<CreateLeaseResult> {
  const landlord = await assertRealEstateLandlordTenant(admin, input.tenantId);
  if (!landlord.ok) {
    return { ok: false, error: landlord.error, status: landlord.status };
  }

  const unitId = input.unitId.trim();
  if (!unitId) {
    return { ok: false, error: "unit_id is required", status: 400 };
  }

  const startDate = input.startDate.trim();
  const endDate = input.endDate.trim();
  if (!startDate || !endDate) {
    return {
      ok: false,
      error: "start_date and end_date are required",
      status: 400,
    };
  }
  if (endDate < startDate) {
    return {
      ok: false,
      error: "end_date must be on or after start_date.",
      status: 400,
    };
  }

  if (!Number.isFinite(input.rentAmountGhs) || input.rentAmountGhs < 0) {
    return {
      ok: false,
      error: "rent_amount_ghs must be a non-negative number.",
      status: 400,
    };
  }

  let advanceRentAmountGhs: number;
  if (
    input.advanceRentAmountGhs != null &&
    Number.isFinite(input.advanceRentAmountGhs)
  ) {
    if (input.advanceRentAmountGhs < 0) {
      return {
        ok: false,
        error: "advance_rent_amount_ghs must be a non-negative number.",
        status: 400,
      };
    }
    advanceRentAmountGhs = input.advanceRentAmountGhs;
  } else {
    advanceRentAmountGhs = suggestAdvanceRentAmountGhs(
      input.rentAmountGhs,
      startDate,
      endDate,
    );
  }

  let terminationNoticeMonths: number;
  if (
    input.terminationNoticeMonths != null &&
    Number.isFinite(input.terminationNoticeMonths)
  ) {
    if (
      !Number.isInteger(input.terminationNoticeMonths) ||
      input.terminationNoticeMonths < 1
    ) {
      return {
        ok: false,
        error: "termination_notice_months must be a positive whole number.",
        status: 400,
      };
    }
    terminationNoticeMonths = input.terminationNoticeMonths;
  } else {
    terminationNoticeMonths = DEFAULT_TERMINATION_NOTICE_MONTHS;
  }

  if (!Number.isFinite(input.depositAmountGhs) || input.depositAmountGhs < 0) {
    return {
      ok: false,
      error: "deposit_amount_ghs must be a non-negative number.",
      status: 400,
    };
  }
  const depositDateCollected = input.depositDateCollected.trim();
  if (!depositDateCollected) {
    return {
      ok: false,
      error: "deposit_date_collected is required",
      status: 400,
    };
  }

  const escalationPercent = input.escalationPercent ?? null;
  const escalationFrequency = input.escalationFrequencyMonths ?? null;
  if (
    (escalationPercent != null && escalationFrequency == null) ||
    (escalationPercent == null && escalationFrequency != null)
  ) {
    return {
      ok: false,
      error:
        "escalation_percent and escalation_frequency_months must both be set or both empty.",
      status: 400,
    };
  }

  let lateFeeType: string | null = null;
  let lateFeeAmount: number | null = null;
  if (input.lateFeeEnabled) {
    lateFeeType = input.lateFeeType?.trim() ?? "";
    if (!lateFeeType || !isLateFeeType(lateFeeType)) {
      return {
        ok: false,
        error:
          "late_fee_type must be fixed or percent when late fees are enabled.",
        status: 400,
      };
    }
    if (
      input.lateFeeAmount == null ||
      !Number.isFinite(input.lateFeeAmount) ||
      input.lateFeeAmount < 0
    ) {
      return {
        ok: false,
        error: "late_fee_amount is required",
        status: 400,
      };
    }
    lateFeeAmount = input.lateFeeAmount;
  }

  const applicationId = input.applicationId?.trim() || null;
  if (applicationId) {
    const { data: application, error: appError } = await admin
      .from("rental_applications")
      .select("application_id, unit_id, status, lease_id, full_name, phone, email")
      .eq("tenant_id", landlord.tenantId)
      .eq("application_id", applicationId)
      .maybeSingle();

    if (appError) {
      return { ok: false, error: appError.message, status: 400 };
    }
    if (!application) {
      return { ok: false, error: "Application not found.", status: 404 };
    }
    if (application.status !== "approved") {
      return {
        ok: false,
        error: "Only approved applications can be converted to a lease.",
        status: 400,
      };
    }
    if (application.lease_id) {
      return {
        ok: false,
        error: "This application already has a lease.",
        status: 400,
      };
    }
    if (application.unit_id !== unitId) {
      return {
        ok: false,
        error: "Unit must match the approved application.",
        status: 400,
      };
    }
  }

  const { data: unit, error: unitError } = await admin
    .from("property_units")
    .select("unit_id, status")
    .eq("tenant_id", landlord.tenantId)
    .eq("unit_id", unitId)
    .maybeSingle();

  if (unitError) {
    return { ok: false, error: unitError.message, status: 400 };
  }
  if (!unit) {
    return { ok: false, error: "Unit not found.", status: 404 };
  }

  const allowedStatuses = applicationId
    ? ["vacant", "application_hold"]
    : ["vacant"];
  if (!allowedStatuses.includes(unit.status)) {
    return {
      ok: false,
      error: applicationId
        ? "Selected unit must be vacant or on application hold."
        : "Selected unit must be vacant.",
      status: 400,
    };
  }

  let lesseeId = input.lesseeId?.trim() ?? "";
  if (!lesseeId) {
    const newLessee = input.newLessee;
    const fullName = newLessee?.fullName?.trim() ?? "";
    const phone = newLessee?.phone?.trim() ?? "";
    const email = newLessee?.email?.trim() || null;
    if (!fullName || !phone) {
      return {
        ok: false,
        error:
          "Select an existing tenant or provide new tenant full_name and phone.",
        status: 400,
      };
    }
    lesseeId = crypto.randomUUID();
    const now = new Date().toISOString();
    const { error: lesseeError } = await admin.from("lessees").insert({
      tenant_id: landlord.tenantId,
      lessee_id: lesseeId,
      auth_user_id: null,
      full_name: fullName,
      phone,
      email,
      status: "active",
      private_notes: null,
      created_at: now,
      updated_at: now,
    });
    if (lesseeError) {
      return { ok: false, error: lesseeError.message, status: 400 };
    }
  } else {
    const { data: lessee, error: lesseeError } = await admin
      .from("lessees")
      .select("lessee_id")
      .eq("tenant_id", landlord.tenantId)
      .eq("lessee_id", lesseeId)
      .maybeSingle();
    if (lesseeError) {
      return { ok: false, error: lesseeError.message, status: 400 };
    }
    if (!lessee) {
      return { ok: false, error: "Tenant not found.", status: 404 };
    }
  }

  const now = new Date().toISOString();
  const leaseId = crypto.randomUUID();
  const depositId = crypto.randomUUID();

  const { error: leaseError } = await admin.from("leases").insert({
    tenant_id: landlord.tenantId,
    lease_id: leaseId,
    unit_id: unitId,
    lessee_id: lesseeId,
    start_date: startDate,
    end_date: endDate,
    rent_amount_ghs: input.rentAmountGhs,
    advance_rent_amount_ghs: advanceRentAmountGhs,
    termination_notice_months: terminationNoticeMonths,
    pending_rent_amount_ghs: null,
    rent_change_status: null,
    pending_termination_reason: null,
    termination_request_status: null,
    escalation_percent: escalationPercent,
    escalation_frequency_months: escalationFrequency,
    late_fee_enabled: input.lateFeeEnabled,
    late_fee_type: lateFeeType,
    late_fee_amount: lateFeeAmount,
    status: "active",
    terminated_at: null,
    termination_reason: null,
    signature_status: "unsigned",
    landlord_acknowledged_at: null,
    tenant_acknowledged_at: null,
    landlord_acknowledged_by: null,
    tenant_acknowledged_by: null,
    created_at: now,
    updated_at: now,
  });

  if (leaseError) {
    return { ok: false, error: leaseError.message, status: 400 };
  }

  const { error: unitUpdateError } = await admin
    .from("property_units")
    .update({
      status: "occupied",
      updated_at: now,
    })
    .eq("tenant_id", landlord.tenantId)
    .eq("unit_id", unitId);

  if (unitUpdateError) {
    return { ok: false, error: unitUpdateError.message, status: 400 };
  }

  const { error: depositError } = await admin.from("security_deposits").insert({
    tenant_id: landlord.tenantId,
    deposit_id: depositId,
    lease_id: leaseId,
    amount_ghs: input.depositAmountGhs,
    status: "held",
    amount_returned_ghs: null,
    date_collected: depositDateCollected,
    date_resolved: null,
    resolution_notes: null,
    created_at: now,
    updated_at: now,
  });

  if (depositError) {
    return { ok: false, error: depositError.message, status: 400 };
  }

  voidNotifySecurityDepositCollected({
    tenantId: landlord.tenantId,
    depositId,
    leaseId,
  });

  if (applicationId) {
    await admin
      .from("rental_applications")
      .update({
        lessee_id: lesseeId,
        lease_id: leaseId,
        status: "closed",
        updated_at: now,
      })
      .eq("tenant_id", landlord.tenantId)
      .eq("application_id", applicationId);
  }

  let portalInvite:
    | { status: "sent" }
    | { status: "skipped"; reason: string }
    | { status: "failed"; error: string }
    | undefined;
  try {
    const { createAndSendLesseePortalInvite } = await import(
      "@/utils/lessee-portal-invite"
    );
    const inviteResult = await createAndSendLesseePortalInvite(admin, {
      tenantId: landlord.tenantId,
      lesseeId,
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

  return {
    ok: true,
    leaseId,
    depositId,
    lesseeId,
    portalInvite,
  };
}
