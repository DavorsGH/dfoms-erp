import { NextResponse } from "next/server";
import { requirePlatformOnlyLandlordSession } from "@/utils/landlord-portal-auth";
import { createLeaseForLandlord } from "@/utils/lease-create";
import { isLateFeeType } from "@/app/dashboard/real-estate/leases-utils";

type Body = {
  application_id?: string;
  start_date?: string;
  end_date?: string;
  rent_amount_ghs?: number | string;
  deposit_amount_ghs?: number | string;
  deposit_date_collected?: string;
  escalation_percent?: number | string | null;
  escalation_frequency_months?: number | string | null;
  late_fee_enabled?: boolean;
  late_fee_type?: string | null;
  late_fee_amount?: number | string | null;
};

/**
 * platform_only: convert approved application → lease (pre-filled applicant as new lessee).
 * davors_managed must use staff ERP lease create with application prefill.
 */
export async function POST(request: Request) {
  const auth = await requirePlatformOnlyLandlordSession();
  if (!auth.ok) {
    return auth.response;
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const applicationId = body.application_id?.trim() ?? "";
  if (!applicationId) {
    return NextResponse.json(
      { error: "application_id is required" },
      { status: 400 },
    );
  }

  const { data: application, error: appError } = await auth.admin
    .from("rental_applications")
    .select(
      "application_id, unit_id, status, lease_id, full_name, phone, email",
    )
    .eq("tenant_id", auth.session.tenantId)
    .eq("application_id", applicationId)
    .maybeSingle();

  if (appError) {
    return NextResponse.json({ error: appError.message }, { status: 400 });
  }
  if (!application) {
    return NextResponse.json({ error: "Application not found." }, { status: 404 });
  }
  if (application.status !== "approved") {
    return NextResponse.json(
      { error: "Only approved applications can be converted to a lease." },
      { status: 400 },
    );
  }

  const rent = Number(body.rent_amount_ghs);
  const deposit = Number(body.deposit_amount_ghs);
  if (!Number.isFinite(rent) || rent < 0) {
    return NextResponse.json(
      { error: "rent_amount_ghs must be a non-negative number." },
      { status: 400 },
    );
  }
  if (!Number.isFinite(deposit) || deposit < 0) {
    return NextResponse.json(
      { error: "deposit_amount_ghs must be a non-negative number." },
      { status: 400 },
    );
  }

  let escalationPercent: number | null = null;
  let escalationFrequency: number | null = null;
  if (body.escalation_percent != null && body.escalation_percent !== "") {
    escalationPercent = Number(body.escalation_percent);
    if (!Number.isFinite(escalationPercent) || escalationPercent < 0) {
      return NextResponse.json(
        { error: "escalation_percent must be a non-negative number." },
        { status: 400 },
      );
    }
  }
  if (
    body.escalation_frequency_months != null &&
    body.escalation_frequency_months !== ""
  ) {
    escalationFrequency = Number(body.escalation_frequency_months);
    if (!Number.isInteger(escalationFrequency) || escalationFrequency < 1) {
      return NextResponse.json(
        { error: "escalation_frequency_months must be a positive whole number." },
        { status: 400 },
      );
    }
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
    lateFeeAmount = Number(body.late_fee_amount);
    if (!Number.isFinite(lateFeeAmount) || lateFeeAmount < 0) {
      return NextResponse.json(
        { error: "late_fee_amount is required" },
        { status: 400 },
      );
    }
  }

  const result = await createLeaseForLandlord(auth.admin, {
    tenantId: auth.session.tenantId,
    unitId: application.unit_id,
    newLessee: {
      fullName: application.full_name,
      phone: application.phone,
      email: application.email,
    },
    startDate: body.start_date ?? "",
    endDate: body.end_date ?? "",
    rentAmountGhs: rent,
    escalationPercent,
    escalationFrequencyMonths: escalationFrequency,
    lateFeeEnabled,
    lateFeeType,
    lateFeeAmount,
    depositAmountGhs: deposit,
    depositDateCollected: body.deposit_date_collected ?? "",
    applicationId,
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
