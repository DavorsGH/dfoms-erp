import { NextResponse } from "next/server";
import { requirePlatformOnlyLandlordSession } from "@/utils/landlord-portal-auth";
import { isLateFeeType } from "@/app/dashboard/real-estate/leases-utils";

type UpdateLeaseBody = {
  lease_id?: string;
  start_date?: string;
  end_date?: string;
  rent_amount_ghs?: number | string | null;
  escalation_percent?: number | string | null;
  escalation_frequency_months?: number | string | null;
  late_fee_enabled?: boolean;
  late_fee_type?: string | null;
  late_fee_amount?: number | string | null;
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

/**
 * platform_only: edit lease terms and set rent directly (no staff approval queue).
 */
export async function POST(request: Request) {
  const auth = await requirePlatformOnlyLandlordSession();
  if (!auth.ok) {
    return auth.response;
  }

  let body: UpdateLeaseBody;
  try {
    body = (await request.json()) as UpdateLeaseBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const leaseId = body.lease_id?.trim() ?? "";
  if (!leaseId) {
    return NextResponse.json({ error: "lease_id is required" }, { status: 400 });
  }

  const { data: existing, error: existingError } = await auth.admin
    .from("leases")
    .select("lease_id, status")
    .eq("tenant_id", auth.session.tenantId)
    .eq("lease_id", leaseId)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 400 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Lease not found." }, { status: 404 });
  }

  const startDate = body.start_date?.trim() ?? "";
  const endDate = body.end_date?.trim() ?? "";
  if (!startDate || !endDate) {
    return NextResponse.json(
      { error: "start_date and end_date are required" },
      { status: 400 },
    );
  }
  if (endDate < startDate) {
    return NextResponse.json(
      { error: "end_date must be on or after start_date." },
      { status: 400 },
    );
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
  if (
    (escalationPercent.value != null && escalationFrequency.value == null) ||
    (escalationPercent.value == null && escalationFrequency.value != null)
  ) {
    return NextResponse.json(
      {
        error:
          "escalation_percent and escalation_frequency_months must both be set or both empty.",
      },
      { status: 400 },
    );
  }

  const lateFeeEnabled = Boolean(body.late_fee_enabled);
  let lateFeeType: string | null = null;
  let lateFeeAmount: number | null = null;
  if (lateFeeEnabled) {
    lateFeeType = body.late_fee_type?.trim() ?? "";
    if (!lateFeeType || !isLateFeeType(lateFeeType)) {
      return NextResponse.json(
        {
          error:
            "late_fee_type must be fixed or percent when late fees are enabled.",
        },
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

  const patch: Record<string, unknown> = {
    start_date: startDate,
    end_date: endDate,
    escalation_percent: escalationPercent.value,
    escalation_frequency_months: escalationFrequency.value,
    late_fee_enabled: lateFeeEnabled,
    late_fee_type: lateFeeType,
    late_fee_amount: lateFeeAmount,
    updated_at: new Date().toISOString(),
  };

  const rentRaw = body.rent_amount_ghs;
  if (rentRaw != null && rentRaw !== "") {
    const rent = parseNonNegativeNumber(rentRaw, "rent_amount_ghs", true);
    if (!rent.ok || rent.value == null) {
      return NextResponse.json(
        {
          error: !rent.ok ? rent.error : "rent_amount_ghs is required",
        },
        { status: 400 },
      );
    }
    patch.rent_amount_ghs = rent.value;
    // Clear any leftover staff-approval rent-change queue for self-managed landlords.
    patch.pending_rent_amount_ghs = null;
    patch.rent_change_status = null;
  }

  const { error } = await auth.admin
    .from("leases")
    .update(patch)
    .eq("tenant_id", auth.session.tenantId)
    .eq("lease_id", leaseId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
