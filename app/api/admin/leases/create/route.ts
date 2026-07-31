import { NextResponse } from "next/server";
import { requireDavorsPlatformSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { assertRealEstateLandlordTenant } from "@/utils/property-management";
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
  escalation_percent?: number | string | null;
  escalation_frequency_months?: number | string | null;
  late_fee_enabled?: boolean;
  late_fee_type?: string | null;
  late_fee_amount?: number | string | null;
  deposit_amount_ghs?: number | string;
  deposit_date_collected?: string;
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

  const admin = createAdminClient();
  const landlord = await assertRealEstateLandlordTenant(
    admin,
    body.tenant_id ?? "",
  );
  if (!landlord.ok) {
    return NextResponse.json(
      { error: landlord.error },
      { status: landlord.status },
    );
  }

  const unitId = body.unit_id?.trim() ?? "";
  if (!unitId) {
    return NextResponse.json({ error: "unit_id is required" }, { status: 400 });
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

  const rent = parseNonNegativeNumber(body.rent_amount_ghs, "rent_amount_ghs", true);
  if (!rent.ok || rent.value == null) {
    return NextResponse.json(
      { error: !rent.ok ? rent.error : "rent_amount_ghs is required" },
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
  const depositDateCollected = body.deposit_date_collected?.trim() ?? "";
  if (!depositDateCollected) {
    return NextResponse.json(
      { error: "deposit_date_collected is required" },
      { status: 400 },
    );
  }

  const { data: unit, error: unitError } = await admin
    .from("property_units")
    .select("unit_id, status")
    .eq("tenant_id", landlord.tenantId)
    .eq("unit_id", unitId)
    .maybeSingle();

  if (unitError) {
    return NextResponse.json({ error: unitError.message }, { status: 400 });
  }
  if (!unit) {
    return NextResponse.json({ error: "Unit not found." }, { status: 404 });
  }
  if (unit.status !== "vacant") {
    return NextResponse.json(
      { error: "Selected unit must be vacant." },
      { status: 400 },
    );
  }

  let lesseeId = body.lessee_id?.trim() ?? "";
  if (!lesseeId) {
    const newLessee = body.new_lessee;
    const fullName = newLessee?.full_name?.trim() ?? "";
    const phone = newLessee?.phone?.trim() ?? "";
    const email = newLessee?.email?.trim() || null;
    if (!fullName || !phone) {
      return NextResponse.json(
        { error: "Select an existing tenant or provide new tenant full_name and phone." },
        { status: 400 },
      );
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
      return NextResponse.json({ error: lesseeError.message }, { status: 400 });
    }
  } else {
    const { data: lessee, error: lesseeError } = await admin
      .from("lessees")
      .select("lessee_id")
      .eq("tenant_id", landlord.tenantId)
      .eq("lessee_id", lesseeId)
      .maybeSingle();
    if (lesseeError) {
      return NextResponse.json({ error: lesseeError.message }, { status: 400 });
    }
    if (!lessee) {
      return NextResponse.json({ error: "Tenant not found." }, { status: 404 });
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
    rent_amount_ghs: rent.value,
    pending_rent_amount_ghs: null,
    rent_change_status: null,
    escalation_percent: escalationPercent.value,
    escalation_frequency_months: escalationFrequency.value,
    late_fee_enabled: lateFeeEnabled,
    late_fee_type: lateFeeType,
    late_fee_amount: lateFeeAmount,
    status: "active",
    terminated_at: null,
    termination_reason: null,
    created_at: now,
    updated_at: now,
  });

  if (leaseError) {
    return NextResponse.json({ error: leaseError.message }, { status: 400 });
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
    return NextResponse.json({ error: unitUpdateError.message }, { status: 400 });
  }

  const { error: depositError } = await admin.from("security_deposits").insert({
    tenant_id: landlord.tenantId,
    deposit_id: depositId,
    lease_id: leaseId,
    amount_ghs: depositAmount.value,
    status: "held",
    amount_returned_ghs: null,
    date_collected: depositDateCollected,
    date_resolved: null,
    resolution_notes: null,
    created_at: now,
    updated_at: now,
  });

  if (depositError) {
    return NextResponse.json({ error: depositError.message }, { status: 400 });
  }

  return NextResponse.json({
    success: true,
    lease_id: leaseId,
    deposit_id: depositId,
    lessee_id: lesseeId,
  });
}
