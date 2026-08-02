import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { resolveRentalApplicationLink } from "@/utils/rental-application-links";
import { submitRentalApplication } from "@/utils/rental-application-management";
import { notifyLandlordNewRentalApplication } from "@/utils/real-estate-staff-notifications";

type RouteParams = { params: Promise<{ token: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { token } = await params;
  const admin = createAdminClient();
  const resolved = await resolveRentalApplicationLink(admin, token);
  if (!resolved.ok) {
    return NextResponse.json(
      { error: resolved.error },
      { status: resolved.status },
    );
  }

  const ctx = resolved.context;
  return NextResponse.json({
    property_name: ctx.propertyName,
    unit_number: ctx.unitNumber,
    base_rent_ghs: ctx.baseRentGhs,
    unit_status: ctx.unitStatus,
    expires_at: ctx.expiresAt,
    accepting: ctx.unitStatus === "vacant",
  });
}

type SubmitBody = {
  full_name?: string;
  email?: string | null;
  phone?: string;
  national_id?: string | null;
  desired_move_in?: string | null;
  household_size?: number | string | null;
  has_pets?: boolean;
  pet_details?: string | null;
  employer_name?: string | null;
  job_title?: string | null;
  monthly_income_ghs?: number | string | null;
  employment_notes?: string | null;
  references_text?: string | null;
  id_document_urls?: string[];
  consent_accuracy?: boolean;
  consent_background_check?: boolean;
};

export async function POST(request: Request, { params }: RouteParams) {
  const { token } = await params;

  let body: SubmitBody;
  try {
    body = (await request.json()) as SubmitBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  let householdSize: number | null = null;
  if (body.household_size != null && body.household_size !== "") {
    const parsed = Number(body.household_size);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return NextResponse.json(
        { error: "household_size must be a positive whole number." },
        { status: 400 },
      );
    }
    householdSize = parsed;
  }

  let monthlyIncome: number | null = null;
  if (body.monthly_income_ghs != null && body.monthly_income_ghs !== "") {
    const parsed = Number(body.monthly_income_ghs);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return NextResponse.json(
        { error: "monthly_income_ghs must be a non-negative number." },
        { status: 400 },
      );
    }
    monthlyIncome = parsed;
  }

  const admin = createAdminClient();
  const result = await submitRentalApplication(admin, {
    rawToken: token,
    fullName: body.full_name ?? "",
    email: body.email,
    phone: body.phone ?? "",
    nationalId: body.national_id,
    desiredMoveIn: body.desired_move_in,
    householdSize,
    hasPets: Boolean(body.has_pets),
    petDetails: body.pet_details,
    employerName: body.employer_name,
    jobTitle: body.job_title,
    monthlyIncomeGhs: monthlyIncome,
    employmentNotes: body.employment_notes,
    referencesText: body.references_text,
    idDocumentUrls: Array.isArray(body.id_document_urls)
      ? body.id_document_urls.filter((u) => typeof u === "string")
      : [],
    consentAccuracy: Boolean(body.consent_accuracy),
    consentBackgroundCheck: Boolean(body.consent_background_check),
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // Best-effort notify (do not fail submit).
  try {
    const resolved = await resolveRentalApplicationLink(admin, token);
    if (resolved.ok) {
      await notifyLandlordNewRentalApplication({
        landlordTenantId: result.tenantId,
        applicationId: result.applicationId,
        applicantName: body.full_name?.trim() || "Applicant",
        propertyName: resolved.context.propertyName,
        unitNumber: resolved.context.unitNumber,
      });
    }
  } catch (error) {
    console.error(
      "[api/apply] notify failed:",
      error instanceof Error ? error.message : error,
    );
  }

  return NextResponse.json({
    success: true,
    application_id: result.applicationId,
  });
}
