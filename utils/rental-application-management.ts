import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isRentalApplicationStatus,
  type RentalApplicationDetail,
  type RentalApplicationListRow,
  type RentalApplicationStatus,
} from "@/app/dashboard/real-estate/applications-utils";
import { resolveRentalApplicationLink } from "@/utils/rental-application-links";

function toNumber(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseIdUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

type ApplicationDbRow = {
  application_id: string;
  tenant_id: string;
  property_id: string;
  unit_id: string;
  full_name: string;
  email: string | null;
  phone: string;
  national_id: string | null;
  desired_move_in: string | null;
  household_size: number | null;
  has_pets: boolean;
  pet_details: string | null;
  employer_name: string | null;
  job_title: string | null;
  monthly_income_ghs: number | string | null;
  employment_notes: string | null;
  references_text: string | null;
  id_document_urls: unknown;
  consent_accuracy: boolean;
  consent_background_check: boolean;
  consented_at: string | null;
  status: string;
  landlord_notes: string | null;
  info_request_message: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  lessee_id: string | null;
  lease_id: string | null;
  created_at: string;
  updated_at: string;
};

export type SubmitRentalApplicationInput = {
  rawToken: string;
  fullName: string;
  email?: string | null;
  phone: string;
  nationalId?: string | null;
  desiredMoveIn?: string | null;
  householdSize?: number | null;
  hasPets: boolean;
  petDetails?: string | null;
  employerName?: string | null;
  jobTitle?: string | null;
  monthlyIncomeGhs?: number | null;
  employmentNotes?: string | null;
  referencesText?: string | null;
  idDocumentUrls?: string[];
  consentAccuracy: boolean;
  consentBackgroundCheck: boolean;
};

/**
 * Public submit: validates link + unit vacant, inserts application.
 * Does NOT soft-hold the unit.
 */
export async function submitRentalApplication(
  admin: SupabaseClient,
  input: SubmitRentalApplicationInput,
): Promise<
  | { ok: true; applicationId: string; tenantId: string }
  | { ok: false; error: string; status: number }
> {
  const resolved = await resolveRentalApplicationLink(admin, input.rawToken);
  if (!resolved.ok) {
    return resolved;
  }

  const ctx = resolved.context;
  if (ctx.unitStatus !== "vacant") {
    return {
      ok: false,
      error:
        "This unit is no longer available for applications. Please contact the landlord.",
      status: 400,
    };
  }

  const fullName = input.fullName.trim();
  const phone = input.phone.trim();
  if (!fullName || !phone) {
    return {
      ok: false,
      error: "full_name and phone are required.",
      status: 400,
    };
  }
  if (!input.consentAccuracy || !input.consentBackgroundCheck) {
    return {
      ok: false,
      error: "You must consent to accuracy and background screening.",
      status: 400,
    };
  }

  const now = new Date().toISOString();
  const applicationId = crypto.randomUUID();

  const { error } = await admin.from("rental_applications").insert({
    application_id: applicationId,
    tenant_id: ctx.tenantId,
    property_id: ctx.propertyId,
    unit_id: ctx.unitId,
    link_id: ctx.linkId,
    full_name: fullName,
    email: input.email?.trim() || null,
    phone,
    national_id: input.nationalId?.trim() || null,
    desired_move_in: input.desiredMoveIn?.trim() || null,
    household_size: input.householdSize ?? null,
    has_pets: Boolean(input.hasPets),
    pet_details: input.petDetails?.trim() || null,
    employer_name: input.employerName?.trim() || null,
    job_title: input.jobTitle?.trim() || null,
    monthly_income_ghs: input.monthlyIncomeGhs ?? null,
    employment_notes: input.employmentNotes?.trim() || null,
    references_text: input.referencesText?.trim() || null,
    id_document_urls: input.idDocumentUrls ?? [],
    consent_accuracy: true,
    consent_background_check: true,
    consented_at: now,
    status: "submitted",
    landlord_notes: null,
    info_request_message: null,
    decided_at: null,
    decided_by: null,
    decision_reason: null,
    lessee_id: null,
    lease_id: null,
    created_at: now,
    updated_at: now,
  });

  if (error) {
    return { ok: false, error: error.message, status: 400 };
  }

  return { ok: true, applicationId, tenantId: ctx.tenantId };
}

export type ApplicationDecision =
  | { decision: "approve"; landlordNotes?: string | null }
  | { decision: "reject"; decisionReason?: string | null; landlordNotes?: string | null }
  | {
      decision: "request_info";
      infoRequestMessage: string;
      landlordNotes?: string | null;
    }
  | { decision: "under_review"; landlordNotes?: string | null };

/**
 * Landlord decision. Approve soft-holds the unit (application_hold).
 * Reject / request_info do not change unit status.
 * Both landlord types may decide (caller enforces approved session).
 */
export async function decideRentalApplication(
  admin: SupabaseClient,
  args: {
    tenantId: string;
    applicationId: string;
    decidedBy: string | null;
    body: ApplicationDecision;
  },
): Promise<
  | { ok: true; status: RentalApplicationStatus }
  | { ok: false; error: string; status: number }
> {
  const { data: application, error: fetchError } = await admin
    .from("rental_applications")
    .select("application_id, unit_id, status, lease_id")
    .eq("tenant_id", args.tenantId)
    .eq("application_id", args.applicationId)
    .maybeSingle();

  if (fetchError) {
    return { ok: false, error: fetchError.message, status: 400 };
  }
  if (!application) {
    return { ok: false, error: "Application not found.", status: 404 };
  }

  const current = application.status;
  if (
    current === "approved" ||
    current === "rejected" ||
    current === "withdrawn" ||
    current === "closed"
  ) {
    return {
      ok: false,
      error: `Application is already ${current.replace(/_/g, " ")}.`,
      status: 400,
    };
  }

  const now = new Date().toISOString();
  let nextStatus: RentalApplicationStatus;
  const patch: Record<string, unknown> = {
    updated_at: now,
    landlord_notes: args.body.landlordNotes?.trim() || null,
  };

  if (args.body.decision === "approve") {
    // Soft-hold: prevent double-approve on same vacant unit.
    const { data: unit, error: unitError } = await admin
      .from("property_units")
      .select("unit_id, status")
      .eq("tenant_id", args.tenantId)
      .eq("unit_id", application.unit_id)
      .maybeSingle();

    if (unitError) {
      return { ok: false, error: unitError.message, status: 400 };
    }
    if (!unit) {
      return { ok: false, error: "Unit not found.", status: 404 };
    }
    if (unit.status !== "vacant") {
      return {
        ok: false,
        error:
          "Unit is no longer vacant. Cannot approve this application.",
        status: 400,
      };
    }

    // Ensure no other approved hold on this unit.
    const { data: otherApproved } = await admin
      .from("rental_applications")
      .select("application_id")
      .eq("tenant_id", args.tenantId)
      .eq("unit_id", application.unit_id)
      .eq("status", "approved")
      .neq("application_id", args.applicationId)
      .limit(1)
      .maybeSingle();

    if (otherApproved) {
      return {
        ok: false,
        error:
          "Another approved application already holds this unit.",
        status: 400,
      };
    }

    const { data: heldRows, error: holdError } = await admin
      .from("property_units")
      .update({ status: "application_hold", updated_at: now })
      .eq("tenant_id", args.tenantId)
      .eq("unit_id", application.unit_id)
      .eq("status", "vacant")
      .select("unit_id");

    if (holdError) {
      return { ok: false, error: holdError.message, status: 400 };
    }
    if (!heldRows?.length) {
      return {
        ok: false,
        error:
          "Could not place unit on application hold (no longer vacant).",
        status: 409,
      };
    }

    nextStatus = "approved";
    patch.status = nextStatus;
    patch.decided_at = now;
    patch.decided_by = args.decidedBy;
    patch.decision_reason = null;
    patch.info_request_message = null;
  } else if (args.body.decision === "reject") {
    nextStatus = "rejected";
    patch.status = nextStatus;
    patch.decided_at = now;
    patch.decided_by = args.decidedBy;
    patch.decision_reason = args.body.decisionReason?.trim() || null;
  } else if (args.body.decision === "request_info") {
    const message = args.body.infoRequestMessage.trim();
    if (!message) {
      return {
        ok: false,
        error: "info_request_message is required.",
        status: 400,
      };
    }
    nextStatus = "info_requested";
    patch.status = nextStatus;
    patch.info_request_message = message;
  } else {
    nextStatus = "under_review";
    patch.status = nextStatus;
  }

  const { error: updateError } = await admin
    .from("rental_applications")
    .update(patch)
    .eq("tenant_id", args.tenantId)
    .eq("application_id", args.applicationId);

  if (updateError) {
    return { ok: false, error: updateError.message, status: 400 };
  }

  return { ok: true, status: nextStatus };
}

export async function fetchRentalApplicationsForTenant(
  admin: SupabaseClient,
  tenantId: string,
  options?: { landlordName?: string },
): Promise<{ rows: RentalApplicationListRow[]; error: string | null }> {
  const [
    { data: applications, error },
    { data: properties },
    { data: units },
  ] = await Promise.all([
    admin
      .from("rental_applications")
      .select(
        "application_id, tenant_id, property_id, unit_id, full_name, email, phone, status, desired_move_in, monthly_income_ghs, created_at, decided_at, lease_id",
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false }),
    admin
      .from("properties")
      .select("property_id, name")
      .eq("tenant_id", tenantId),
    admin
      .from("property_units")
      .select("unit_id, unit_number")
      .eq("tenant_id", tenantId),
  ]);

  if (error) {
    return { rows: [], error: error.message };
  }

  const propertyNameById = new Map(
    ((properties as Array<{ property_id: string; name: string }> | null) ?? []).map(
      (row) => [row.property_id, row.name],
    ),
  );
  const unitNumberById = new Map(
    (
      (units as Array<{ unit_id: string; unit_number: string }> | null) ?? []
    ).map((row) => [row.unit_id, row.unit_number]),
  );

  const rows: RentalApplicationListRow[] = (
    (applications as Array<{
      application_id: string;
      tenant_id: string;
      property_id: string;
      unit_id: string;
      full_name: string;
      email: string | null;
      phone: string;
      status: string;
      desired_move_in: string | null;
      monthly_income_ghs: number | string | null;
      created_at: string;
      decided_at: string | null;
      lease_id: string | null;
    }> | null) ?? []
  )
    .filter((row) => isRentalApplicationStatus(row.status))
    .map((row) => ({
      applicationId: row.application_id,
      tenantId: row.tenant_id,
      landlordName: options?.landlordName ?? "—",
      propertyId: row.property_id,
      propertyName: propertyNameById.get(row.property_id) ?? "—",
      unitId: row.unit_id,
      unitNumber: unitNumberById.get(row.unit_id) ?? "—",
      fullName: row.full_name,
      email: row.email,
      phone: row.phone,
      status: row.status as RentalApplicationStatus,
      desiredMoveIn: row.desired_move_in,
      monthlyIncomeGhs: toNumber(row.monthly_income_ghs),
      createdAt: row.created_at,
      decidedAt: row.decided_at,
      leaseId: row.lease_id,
    }));

  return { rows, error: null };
}

export async function fetchRentalApplicationDetail(
  admin: SupabaseClient,
  tenantId: string,
  applicationId: string,
  options?: { landlordName?: string; landlordType?: string | null },
): Promise<{ detail: RentalApplicationDetail | null; error: string | null }> {
  const { data, error } = await admin
    .from("rental_applications")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("application_id", applicationId)
    .maybeSingle();

  if (error) {
    return { detail: null, error: error.message };
  }
  if (!data) {
    return { detail: null, error: null };
  }

  const row = data as ApplicationDbRow;
  if (!isRentalApplicationStatus(row.status)) {
    return { detail: null, error: "Invalid application status." };
  }

  const [{ data: property }, { data: unit }] = await Promise.all([
    admin
      .from("properties")
      .select("name")
      .eq("tenant_id", tenantId)
      .eq("property_id", row.property_id)
      .maybeSingle(),
    admin
      .from("property_units")
      .select("unit_number, status, base_rent_ghs")
      .eq("tenant_id", tenantId)
      .eq("unit_id", row.unit_id)
      .maybeSingle(),
  ]);

  return {
    detail: {
      applicationId: row.application_id,
      tenantId: row.tenant_id,
      landlordName: options?.landlordName ?? "—",
      landlordType: options?.landlordType ?? null,
      propertyId: row.property_id,
      propertyName: property?.name?.trim() || "—",
      unitId: row.unit_id,
      unitNumber: unit?.unit_number?.trim() || "—",
      unitStatus: unit?.status ?? null,
      baseRentGhs: toNumber(unit?.base_rent_ghs),
      fullName: row.full_name,
      email: row.email,
      phone: row.phone,
      nationalId: row.national_id,
      desiredMoveIn: row.desired_move_in,
      householdSize: row.household_size,
      hasPets: Boolean(row.has_pets),
      petDetails: row.pet_details,
      employerName: row.employer_name,
      jobTitle: row.job_title,
      monthlyIncomeGhs: toNumber(row.monthly_income_ghs),
      employmentNotes: row.employment_notes,
      referencesText: row.references_text,
      idDocumentUrls: parseIdUrls(row.id_document_urls),
      consentAccuracy: Boolean(row.consent_accuracy),
      consentBackgroundCheck: Boolean(row.consent_background_check),
      consentedAt: row.consented_at,
      status: row.status,
      landlordNotes: row.landlord_notes,
      infoRequestMessage: row.info_request_message,
      decidedAt: row.decided_at,
      decisionReason: row.decision_reason,
      lesseeId: row.lessee_id,
      leaseId: row.lease_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    error: null,
  };
}

/**
 * Staff list: applications for davors_managed landlords only.
 */
export async function fetchDavorsManagedRentalApplications(
  admin: SupabaseClient,
): Promise<{ rows: RentalApplicationListRow[]; error: string | null }> {
  const { data: landlords, error: landlordsError } = await admin
    .from("landlords")
    .select("tenant_id")
    .eq("landlord_type", "davors_managed");

  if (landlordsError) {
    return { rows: [], error: landlordsError.message };
  }

  const tenantIds = (landlords ?? [])
    .map((row) => row.tenant_id as string)
    .filter(Boolean);

  if (tenantIds.length === 0) {
    return { rows: [], error: null };
  }

  const { data: tenants } = await admin
    .from("tenants")
    .select("id, name")
    .in("id", tenantIds);

  const nameById = new Map(
    ((tenants as Array<{ id: string; name: string }> | null) ?? []).map(
      (row) => [row.id, row.name],
    ),
  );

  const { data: applications, error } = await admin
    .from("rental_applications")
    .select(
      "application_id, tenant_id, property_id, unit_id, full_name, email, phone, status, desired_move_in, monthly_income_ghs, created_at, decided_at, lease_id",
    )
    .in("tenant_id", tenantIds)
    .order("created_at", { ascending: false });

  if (error) {
    return { rows: [], error: error.message };
  }

  const propertyIds = [
    ...new Set(
      (applications ?? []).map((row) => row.property_id as string).filter(Boolean),
    ),
  ];
  const unitIds = [
    ...new Set(
      (applications ?? []).map((row) => row.unit_id as string).filter(Boolean),
    ),
  ];

  const [{ data: properties }, { data: units }] = await Promise.all([
    propertyIds.length
      ? admin
          .from("properties")
          .select("tenant_id, property_id, name")
          .in("property_id", propertyIds)
      : Promise.resolve({ data: [] }),
    unitIds.length
      ? admin
          .from("property_units")
          .select("tenant_id, unit_id, unit_number")
          .in("unit_id", unitIds)
      : Promise.resolve({ data: [] }),
  ]);

  const propertyNameByKey = new Map(
    (
      (properties as Array<{
        tenant_id: string;
        property_id: string;
        name: string;
      }> | null) ?? []
    ).map((row) => [`${row.tenant_id}:${row.property_id}`, row.name]),
  );
  const unitNumberByKey = new Map(
    (
      (units as Array<{
        tenant_id: string;
        unit_id: string;
        unit_number: string;
      }> | null) ?? []
    ).map((row) => [`${row.tenant_id}:${row.unit_id}`, row.unit_number]),
  );

  const rows: RentalApplicationListRow[] = (
    (applications as Array<{
      application_id: string;
      tenant_id: string;
      property_id: string;
      unit_id: string;
      full_name: string;
      email: string | null;
      phone: string;
      status: string;
      desired_move_in: string | null;
      monthly_income_ghs: number | string | null;
      created_at: string;
      decided_at: string | null;
      lease_id: string | null;
    }> | null) ?? []
  )
    .filter((row) => isRentalApplicationStatus(row.status))
    .map((row) => ({
      applicationId: row.application_id,
      tenantId: row.tenant_id,
      landlordName: nameById.get(row.tenant_id) ?? "—",
      propertyId: row.property_id,
      propertyName:
        propertyNameByKey.get(`${row.tenant_id}:${row.property_id}`) ?? "—",
      unitId: row.unit_id,
      unitNumber:
        unitNumberByKey.get(`${row.tenant_id}:${row.unit_id}`) ?? "—",
      fullName: row.full_name,
      email: row.email,
      phone: row.phone,
      status: row.status as RentalApplicationStatus,
      desiredMoveIn: row.desired_move_in,
      monthlyIncomeGhs: toNumber(row.monthly_income_ghs),
      createdAt: row.created_at,
      decidedAt: row.decided_at,
      leaseId: row.lease_id,
    }));

  return { rows, error: null };
}
