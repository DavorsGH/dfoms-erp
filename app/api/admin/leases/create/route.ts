import { NextResponse } from "next/server";
import { requireDavorsPlatformSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { createLeaseForLandlord } from "@/utils/lease-create";
import { isLateFeeType } from "@/app/dashboard/real-estate/leases-utils";

type CreateLeaseBody = {
  tenant_id?: string;
  unit_id?: string;
  lessee_id?: string;
  new_lessee?: {
    full_name?: string;
    phone?: string;
    email?: string | null;
  } | null;
  start_date?: string;
  end_date?: string;
  rent_amount_ghs?: number | string;
  advance_rent_amount_ghs?: number | string | null;
  termination_notice_months?: number | string | null;
  escalation_percent?: number | string | null;
  escalation_frequency_months?: number | string | null;
  late_fee_enabled?: boolean;
  late_fee_type?: string | null;
  late_fee_amount?: number | string | null;
  deposit_amount_ghs?: number | string;
  deposit_date_collected?: string;
  /** Optional: convert approved rental application (allows application_hold unit). */
  application_id?: string | null;
};

function parseNonNegativeNumber(
  value: number | string | null | undefined,
  field: string,
  required: boolean,
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value == null || value === "") {
    if (required) {
      return { ok: false, error: `${field} is required` };
    }
    return { ok: true, value: null };
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { ok: false, error: `${field} must be a non-negative number.` };
  }
  return { ok: true, value: parsed };
}

function parseOptionalInteger(
  value: number | string | null | undefined,
  field: string,
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (value == null || value === "") {
    return { ok: true, value: null };
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return {
      ok: false,
      error: `${field} must be a positive whole number.`,
    };
  }
  return { ok: true, value: parsed };
}

export async function POST(request: Request) {
  const auth = await requireDavorsPlatformSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  let body: CreateLeaseBody;
  try {
    body = (await request.json()) as CreateLeaseBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const rent = parseNonNegativeNumber(body.rent_amount_ghs, "rent_amount_ghs", true);
  if (!rent.ok || rent.value == null) {
    return NextResponse.json(
      { error: !rent.ok ? rent.error : "rent_amount_ghs is required" },
      { status: 400 },
    );
  }

  const advanceRent = parseNonNegativeNumber(
    body.advance_rent_amount_ghs,
    "advance_rent_amount_ghs",
    false,
  );
  if (!advanceRent.ok) {
    return NextResponse.json({ error: advanceRent.error }, { status: 400 });
  }

  const noticeMonths = parseOptionalInteger(
    body.termination_notice_months,
    "termination_notice_months",
  );
  if (!noticeMonths.ok) {
    return NextResponse.json({ error: noticeMonths.error }, { status: 400 });
  }

  const escalationPercent = parseNonNegativeNumber(
    body.escalation_percent,
    "escalation_percent",
    false,
  );
  if (!escalationPercent.ok) {
    return NextResponse.json({ error: escalationPercent.error }, { status: 400 });
  }
  const escalationFrequency = parseOptionalInteger(
    body.escalation_frequency_months,
    "escalation_frequency_months",
  );
  if (!escalationFrequency.ok) {
    return NextResponse.json({ error: escalationFrequency.error }, { status: 400 });
  }

  const lateFeeEnabled = Boolean(body.late_fee_enabled);
  let lateFeeType: string | null = null;
  let lateFeeAmount: number | null = null;
  if (lateFeeEnabled) {
    lateFeeType = body.late_fee_type?.trim() ?? "";
    if (!lateFeeType || !isLateFeeType(lateFeeType)) {
      return NextResponse.json(
        { error: "late_fee_type must be fixed or percent when late fees are enabled." },
        { status: 400 },
      );
    }
    const amount = parseNonNegativeNumber(
      body.late_fee_amount,
      "late_fee_amount",
      true,
    );
    if (!amount.ok || amount.value == null) {
      return NextResponse.json(
        { error: !amount.ok ? amount.error : "late_fee_amount is required" },
        { status: 400 },
      );
    }
    lateFeeAmount = amount.value;
  }

  const depositAmount = parseNonNegativeNumber(
    body.deposit_amount_ghs,
    "deposit_amount_ghs",
    true,
  );
  if (!depositAmount.ok || depositAmount.value == null) {
    return NextResponse.json(
      {
        error: !depositAmount.ok
          ? depositAmount.error
          : "deposit_amount_ghs is required",
      },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const result = await createLeaseForLandlord(admin, {
    tenantId: body.tenant_id ?? "",
    unitId: body.unit_id ?? "",
    lesseeId: body.lessee_id,
    newLessee: body.new_lessee
      ? {
          fullName: body.new_lessee.full_name,
          phone: body.new_lessee.phone,
          email: body.new_lessee.email,
        }
      : null,
    startDate: body.start_date ?? "",
    endDate: body.end_date ?? "",
    rentAmountGhs: rent.value,
    advanceRentAmountGhs: advanceRent.value,
    terminationNoticeMonths: noticeMonths.value,
    escalationPercent: escalationPercent.value,
    escalationFrequencyMonths: escalationFrequency.value,
    lateFeeEnabled,
    lateFeeType,
    lateFeeAmount,
    depositAmountGhs: depositAmount.value,
    depositDateCollected: body.deposit_date_collected ?? "",
    applicationId: body.application_id,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    success: true,
    lease_id: result.leaseId,
    deposit_id: result.depositId,
    lessee_id: result.lesseeId,
    portal_invite: result.portalInvite,
  });
}
