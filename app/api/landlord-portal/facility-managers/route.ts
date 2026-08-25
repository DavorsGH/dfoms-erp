import { NextResponse } from "next/server";
import { requireApprovedLandlordSession } from "@/utils/landlord-portal-auth";
import {
  assertPropertiesBelongToTenant,
  createAndSendFacilityManagerPortalInvite,
  DEFAULT_FACILITY_MANAGER_CAPABILITIES,
  fetchPendingFacilityManagerInviteExpiresAt,
  rejectDavorsManagedFacilityManagerCollectionCapabilities,
  type FacilityManagerCapabilityFlags,
} from "@/utils/facility-manager-portal-invite";
import {
  crossPersonaErrorMessage,
  findCrossPersonaConflictForEmail,
} from "@/lib/auth/cross-persona-guard";

export const runtime = "nodejs";

type InviteBody = {
  full_name?: string;
  email?: string;
  phone?: string | null;
  property_ids?: string[];
  can_manage_maintenance?: boolean;
  can_manage_complaints?: boolean;
  can_manage_inspections?: boolean;
  can_log_services?: boolean;
  can_collect_rent?: boolean;
  can_collect_charges?: boolean;
};

function parseCapabilities(
  body: InviteBody,
): FacilityManagerCapabilityFlags {
  return {
    can_manage_maintenance:
      typeof body.can_manage_maintenance === "boolean"
        ? body.can_manage_maintenance
        : DEFAULT_FACILITY_MANAGER_CAPABILITIES.can_manage_maintenance,
    can_manage_complaints:
      typeof body.can_manage_complaints === "boolean"
        ? body.can_manage_complaints
        : DEFAULT_FACILITY_MANAGER_CAPABILITIES.can_manage_complaints,
    can_manage_inspections:
      typeof body.can_manage_inspections === "boolean"
        ? body.can_manage_inspections
        : DEFAULT_FACILITY_MANAGER_CAPABILITIES.can_manage_inspections,
    can_log_services:
      typeof body.can_log_services === "boolean"
        ? body.can_log_services
        : DEFAULT_FACILITY_MANAGER_CAPABILITIES.can_log_services,
    can_collect_rent:
      typeof body.can_collect_rent === "boolean"
        ? body.can_collect_rent
        : DEFAULT_FACILITY_MANAGER_CAPABILITIES.can_collect_rent,
    can_collect_charges:
      typeof body.can_collect_charges === "boolean"
        ? body.can_collect_charges
        : DEFAULT_FACILITY_MANAGER_CAPABILITIES.can_collect_charges,
  };
}

/**
 * GET: list facility managers for this landlord tenant.
 */
export async function GET() {
  const auth = await requireApprovedLandlordSession();
  if (!auth.ok) {
    return auth.response;
  }

  const { data: managers, error } = await auth.admin
    .from("facility_managers")
    .select(
      "facility_manager_id, full_name, email, phone, status, can_manage_maintenance, can_manage_complaints, can_manage_inspections, can_log_services, can_collect_rent, can_collect_charges, invited_at, activated_at, revoked_at, auth_user_id",
    )
    .eq("tenant_id", auth.session.tenantId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const ids = (managers ?? []).map((m) => m.facility_manager_id as string);
  const { data: assignments } = ids.length
    ? await auth.admin
        .from("facility_manager_property_assignments")
        .select("facility_manager_id, property_id")
        .eq("tenant_id", auth.session.tenantId)
        .in("facility_manager_id", ids)
    : { data: [] as Array<{ facility_manager_id: string; property_id: string }> };

  const propertyIds = [
    ...new Set((assignments ?? []).map((a) => a.property_id as string)),
  ];
  const { data: properties } = propertyIds.length
    ? await auth.admin
        .from("properties")
        .select("property_id, name")
        .eq("tenant_id", auth.session.tenantId)
        .in("property_id", propertyIds)
    : { data: [] as Array<{ property_id: string; name: string }> };

  const propertyNameById = new Map(
    (properties ?? []).map((p) => [p.property_id as string, p.name as string]),
  );

  const assignmentsByFm = new Map<
    string,
    Array<{ property_id: string; name: string }>
  >();
  for (const row of assignments ?? []) {
    const fmId = row.facility_manager_id as string;
    const list = assignmentsByFm.get(fmId) ?? [];
    list.push({
      property_id: row.property_id as string,
      name: propertyNameById.get(row.property_id as string) ?? "Property",
    });
    assignmentsByFm.set(fmId, list);
  }

  const items = await Promise.all(
    (managers ?? []).map(async (m) => {
      const inviteExpiresAt =
        m.status === "invited" && !m.auth_user_id
          ? await fetchPendingFacilityManagerInviteExpiresAt(auth.admin, {
              tenantId: auth.session.tenantId,
              facilityManagerId: m.facility_manager_id,
            })
          : null;
      return {
        facility_manager_id: m.facility_manager_id,
        full_name: m.full_name,
        email: m.email,
        phone: m.phone,
        status: m.status,
        can_manage_maintenance: m.can_manage_maintenance,
        can_manage_complaints: m.can_manage_complaints,
        can_manage_inspections: m.can_manage_inspections,
        can_log_services: m.can_log_services,
        can_collect_rent: m.can_collect_rent,
        can_collect_charges: m.can_collect_charges,
        invited_at: m.invited_at,
        activated_at: m.activated_at,
        revoked_at: m.revoked_at,
        has_portal_account: Boolean(m.auth_user_id),
        invite_expires_at: inviteExpiresAt,
        properties: assignmentsByFm.get(m.facility_manager_id) ?? [],
      };
    }),
  );

  return NextResponse.json({ facility_managers: items });
}

/**
 * POST: create facility manager (invited) + property assignments + send invite email.
 */
export async function POST(request: Request) {
  const auth = await requireApprovedLandlordSession();
  if (!auth.ok) {
    return auth.response;
  }

  let body: InviteBody;
  try {
    body = (await request.json()) as InviteBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const fullName =
    typeof body.full_name === "string" ? body.full_name.trim() : "";
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const phone =
    typeof body.phone === "string" && body.phone.trim()
      ? body.phone.trim()
      : null;
  const propertyIds = Array.isArray(body.property_ids)
    ? body.property_ids.filter((id): id is string => typeof id === "string")
    : [];

  if (!fullName) {
    return NextResponse.json({ error: "full_name is required" }, { status: 400 });
  }
  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
  }

  const propertyCheck = await assertPropertiesBelongToTenant(auth.admin, {
    tenantId: auth.session.tenantId,
    propertyIds,
  });
  if (!propertyCheck.ok) {
    return NextResponse.json({ error: propertyCheck.error }, { status: 400 });
  }

  const crossPersona = await findCrossPersonaConflictForEmail(auth.admin, email, {
    targetPersona: "facility_manager",
  });
  if (crossPersona) {
    return NextResponse.json(
      { error: crossPersonaErrorMessage(crossPersona) },
      { status: 409 },
    );
  }

  const capabilities = parseCapabilities(body);
  const collectionCapabilityError =
    rejectDavorsManagedFacilityManagerCollectionCapabilities({
      landlordType: auth.session.landlordType,
      canCollectRent: capabilities.can_collect_rent,
      canCollectCharges: capabilities.can_collect_charges,
    });
  if (collectionCapabilityError) {
    return NextResponse.json({ error: collectionCapabilityError }, { status: 400 });
  }

  const nowIso = new Date().toISOString();

  const { data: created, error: createError } = await auth.admin
    .from("facility_managers")
    .insert({
      tenant_id: auth.session.tenantId,
      full_name: fullName,
      email,
      phone,
      status: "invited",
      ...capabilities,
      invited_by_auth_uid: auth.session.authUserId,
      invited_at: nowIso,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select("facility_manager_id")
    .single();

  if (createError || !created) {
    return NextResponse.json(
      { error: createError?.message ?? "Unable to create facility manager." },
      { status: 400 },
    );
  }

  const facilityManagerId = created.facility_manager_id as string;
  const uniquePropertyIds = [...new Set(propertyIds.map((id) => id.trim()))];

  const { error: assignError } = await auth.admin
    .from("facility_manager_property_assignments")
    .insert(
      uniquePropertyIds.map((propertyId) => ({
        tenant_id: auth.session.tenantId,
        facility_manager_id: facilityManagerId,
        property_id: propertyId,
        created_by_auth_uid: auth.session.authUserId,
        created_at: nowIso,
      })),
    );

  if (assignError) {
    await auth.admin
      .from("facility_managers")
      .delete()
      .eq("tenant_id", auth.session.tenantId)
      .eq("facility_manager_id", facilityManagerId);
    return NextResponse.json({ error: assignError.message }, { status: 400 });
  }

  const inviteResult = await createAndSendFacilityManagerPortalInvite(
    auth.admin,
    {
      tenantId: auth.session.tenantId,
      facilityManagerId,
      landlordName: auth.session.fullName,
    },
  );

  if (!inviteResult.ok) {
    await auth.admin
      .from("facility_managers")
      .delete()
      .eq("tenant_id", auth.session.tenantId)
      .eq("facility_manager_id", facilityManagerId);
    return NextResponse.json({ error: inviteResult.error }, { status: 400 });
  }

  if (inviteResult.status === "skipped") {
    await auth.admin
      .from("facility_managers")
      .delete()
      .eq("tenant_id", auth.session.tenantId)
      .eq("facility_manager_id", facilityManagerId);
    return NextResponse.json(
      { error: inviteResult.reason, skipped: true },
      { status: 409 },
    );
  }

  return NextResponse.json({
    ok: true,
    facility_manager_id: facilityManagerId,
    status: "sent",
    existing_auth_account: inviteResult.existingAuthAccount,
  });
}
